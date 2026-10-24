import { playedBarTicks } from "../fretboard";
import { highwayStarts, timeAtBarPosition } from "../highway";
import { playedBars } from "../playback";
import type { ScoreDocument, Track } from "../types";
import type { PitchEvent } from "./engine";
import { buildWaitSteps, pitchMatches, type WaitStep } from "./wait";

/*
 * Scored play-along: the music keeps playing and every expected note of the chosen track is
 * graded. Everything here is pure. The run wrapper (scoredRun.ts) converts the microphone's clock
 * to the song's clock, so all times below are seconds on the playback clock, speed and calibrated
 * latency already taken out.
 */

export type NoteGrade = "hit" | "early" | "late" | "wrong" | "missed";

export interface ScoredStep extends WaitStep {
  /** Seconds on the playback clock (the highway's clock) at which the note is due. */
  time: number;
}

export interface ScoreOptions {
  /** An attack this close to the due time is a hit, seconds. */
  hitWindow: number;
  /** An attack up to this far from the due time is early or late; beyond it, the note is missed. */
  outerWindow: number;
  /** How far from the note's centre a reading may be, in cents. */
  centsTolerance: number;
  /** How long after an attack the pitch may settle, seconds. */
  settleSeconds: number;
  /** Count the right note in any octave. */
  anyOctave: boolean;
}

export const DEFAULT_SCORE_OPTIONS: ScoreOptions = {
  hitWindow: 0.1,
  outerWindow: 0.3,
  centsTolerance: 40,
  settleSeconds: 0.3,
  anyOctave: true,
};

/** Share of a note's credit that each grade earns. Extra notes do not lower the score. */
export const GRADE_CREDIT: Record<NoteGrade, number> = {
  hit: 1,
  early: 0.5,
  late: 0.5,
  wrong: 0,
  missed: 0,
};

/** The expected notes of a track with the time each one is due. */
export function buildScoredSteps(
  document: ScoreDocument,
  track: Track,
  hasAudio: boolean,
): ScoredStep[] {
  const starts = highwayStarts(document, hasAudio);
  return buildWaitSteps(document, track, { chords: false }).map((step) => ({
    ...step,
    time: timeAtBarPosition(starts, step.bar, step.position, playedBarTicks(document, step.bar)),
  }));
}

export interface BarScore {
  credit: number;
  total: number;
}

export interface ScoreSummary {
  counts: Record<NoteGrade, number>;
  /** Notes played that matched nothing. */
  extras: number;
  /** Notes graded so far. */
  graded: number;
  /** Notes in the pass. */
  total: number;
  /** 0 to 1 over the notes graded so far. */
  accuracy: number;
  streak: number;
  bestStreak: number;
  /** Per played bar, null where the bar has no notes in the pass. */
  bars: (BarScore | null)[];
}

export function starsFor(accuracy: number, graded: number): 0 | 1 | 2 | 3 {
  if (graded === 0) return 0;
  if (accuracy >= 0.9) return 3;
  if (accuracy >= 0.75) return 2;
  if (accuracy >= 0.5) return 1;
  return 0;
}

interface Pending {
  at: number;
  candidates: number[];
  heard: boolean;
}

/**
 * Grades one pass over a range of the song. Feed it the detector's events (with a function that
 * turns their clock into song time) and advance it with the playback clock so notes that nobody
 * played are marked missed once their window has gone by.
 */
export class Scorer {
  private readonly grades: (NoteGrade | null)[];
  private readonly inRange: boolean[];
  private pending: Pending | null = null;
  private extras = 0;
  private streak = 0;
  private bestStreak = 0;
  /** Attacks inside the pass, and those far from any note of the track (for the bleed check). */
  attacks = 0;
  restAttacks = 0;

  constructor(
    private readonly steps: readonly ScoredStep[],
    private readonly barCount: number,
    private readonly range: { from: number; to: number },
    private readonly options: ScoreOptions = DEFAULT_SCORE_OPTIONS,
  ) {
    this.grades = steps.map(() => null);
    this.inRange = steps.map(
      (step) => step.time >= range.from - 1e-6 && step.time <= range.to + 1e-6,
    );
  }

  /** The grade of each step (null while it is still open or when it is outside the pass). */
  get stepGrades(): readonly (NoteGrade | null)[] {
    return this.grades;
  }

  /** True once every note of the pass has a grade. */
  get complete(): boolean {
    return this.grades.every((grade, index) => grade !== null || !this.inRange[index]);
  }

  /** Feed one detector event; `toSong` converts the event's clock to song seconds. */
  push(event: PitchEvent, toSong: (time: number) => number): number[] {
    const changed: number[] = [];
    const now = toSong(event.time);
    this.advance(now, changed);
    if (event.onset) this.attack(toSong(event.onsetTime ?? event.time), changed);
    const pending = this.pending;
    if (pending && event.midi !== null && event.cents !== null) {
      if (Math.abs(event.cents) <= this.options.centsTolerance) {
        const heard = event.midi;
        const match = pending.candidates
          .filter((index) => this.grades[index] === null)
          .filter((index) =>
            this.steps[index].midis.some((midi) =>
              pitchMatches(heard, midi, this.options.anyOctave),
            ),
          );
        if (match.length > 0) {
          this.resolve(this.nearest(match, pending.at), pending.at, changed);
          this.pending = null;
          return changed;
        }
      }
      pending.heard = true;
    }
    return changed;
  }

  /** The playback clock reached `now`: close what can no longer be played. */
  advance(now: number, changed: number[] = []): number[] {
    const pending = this.pending;
    if (pending && now - pending.at > this.options.settleSeconds) this.expirePending(changed);
    const held = new Set(this.pending?.candidates ?? []);
    for (let index = 0; index < this.steps.length; index += 1) {
      if (this.grades[index] !== null || !this.inRange[index] || held.has(index)) continue;
      if (this.steps[index].time + this.options.outerWindow < now)
        this.assign(index, "missed", changed);
    }
    return changed;
  }

  /** The attack waiting for its pitch got none that fits: wrong if a pitch was heard, else an extra. */
  private expirePending(changed: number[]): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    const open = pending.candidates.filter((index) => this.grades[index] === null);
    if (pending.heard && open.length > 0)
      this.assign(this.nearest(open, pending.at), "wrong", changed);
    else this.extras += 1;
  }

  /** The pass is over: everything still open was not played. */
  finish(): number[] {
    const changed: number[] = [];
    this.pending = null;
    for (let index = 0; index < this.steps.length; index += 1) {
      if (this.grades[index] === null && this.inRange[index]) this.assign(index, "missed", changed);
    }
    return changed;
  }

  summary(): ScoreSummary {
    const counts: Record<NoteGrade, number> = { hit: 0, early: 0, late: 0, wrong: 0, missed: 0 };
    const bars: (BarScore | null)[] = Array.from({ length: this.barCount }, () => null);
    let credit = 0;
    let graded = 0;
    let total = 0;
    this.steps.forEach((step, index) => {
      if (!this.inRange[index]) return;
      total += 1;
      const grade = this.grades[index];
      if (grade === null) return;
      graded += 1;
      counts[grade] += 1;
      credit += GRADE_CREDIT[grade];
      const bar = (bars[step.bar] ??= { credit: 0, total: 0 });
      bar.credit += GRADE_CREDIT[grade];
      bar.total += 1;
    });
    return {
      counts,
      extras: this.extras,
      graded,
      total,
      accuracy: graded > 0 ? credit / graded : 0,
      streak: this.streak,
      bestStreak: this.bestStreak,
      bars,
    };
  }

  private attack(at: number, changed: number[]): void {
    // A new attack ends the one still waiting for its pitch; nothing else is decided by it.
    this.expirePending(changed);
    if (
      at < this.range.from - this.options.outerWindow ||
      at > this.range.to + this.options.outerWindow
    )
      return;
    this.attacks += 1;
    const candidates: number[] = [];
    let nearestDistance = Infinity;
    this.steps.forEach((step, index) => {
      const distance = Math.abs(step.time - at);
      nearestDistance = Math.min(nearestDistance, distance);
      if (
        this.grades[index] === null &&
        this.inRange[index] &&
        distance <= this.options.outerWindow
      )
        candidates.push(index);
    });
    // Playing where the track rests, a second or more from its nearest note.
    if (nearestDistance > 1) this.restAttacks += 1;
    if (candidates.length === 0) {
      this.extras += 1;
      return;
    }
    // A dead (muted) note accepts any attack.
    const dead = candidates.filter((index) => this.steps[index].kind === "dead");
    if (dead.length > 0) {
      this.resolve(this.nearest(dead, at), at, changed);
      return;
    }
    this.pending = { at, candidates, heard: false };
  }

  private resolve(index: number, at: number, changed: number[]): void {
    const distance = at - this.steps[index].time;
    const grade: NoteGrade =
      Math.abs(distance) <= this.options.hitWindow + 1e-9 ? "hit" : distance < 0 ? "early" : "late";
    this.assign(index, grade, changed);
  }

  private assign(index: number, grade: NoteGrade, changed: number[]): void {
    this.grades[index] = grade;
    changed.push(index);
    if (grade === "hit" || grade === "early" || grade === "late") {
      this.streak += 1;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
    } else {
      this.streak = 0;
    }
  }

  private nearest(indexes: number[], at: number): number {
    return indexes.reduce((best, index) =>
      Math.abs(this.steps[index].time - at) < Math.abs(this.steps[best].time - at) ? index : best,
    );
  }
}

/**
 * Obvious bleed: with a recording playing, the microphone hears it, so notes show up where the
 * track rests. This is a heuristic; it warns, it never changes the score.
 */
export function bleedSuspected(restAttacks: number, attacks: number): boolean {
  return restAttacks >= 4 && restAttacks >= attacks * 0.5;
}

export interface SectionScore {
  /** The section's name, or null for bars before the first named section. */
  name: string | null;
  /** First and last played bar of the section. */
  from: number;
  to: number;
  accuracy: number;
  total: number;
}

/** Accuracy per named section (a section runs until the next name), over the graded notes. */
export function sectionScores(
  document: ScoreDocument,
  bars: readonly (BarScore | null)[],
): SectionScore[] {
  const sections: SectionScore[] = [];
  const credits: number[] = [];
  playedBars(document.bars).forEach((written, played) => {
    const name = document.bars[written]?.section ?? null;
    const last = sections[sections.length - 1];
    if (!last || (name && name !== last.name)) {
      sections.push({ name: name || null, from: played, to: played, accuracy: 0, total: 0 });
      credits.push(0);
    } else {
      last.to = played;
    }
    const bar = bars[played];
    if (bar) {
      sections[sections.length - 1].total += bar.total;
      credits[sections.length - 1] += bar.credit;
    }
  });
  return sections
    .map((section, index) => ({
      ...section,
      accuracy: section.total > 0 ? credits[index] / section.total : 0,
    }))
    .filter((section) => section.total > 0);
}

export function barAccuracy(bar: BarScore | null): number | null {
  return bar && bar.total > 0 ? bar.credit / bar.total : null;
}

/** The run of `size` consecutive bars that lost the most notes, for "practise this section". */
export function weakestSpan(
  bars: readonly (BarScore | null)[],
  size = 4,
): { from: number; to: number } | null {
  let best: { from: number; to: number; lost: number } | null = null;
  for (let from = 0; from < bars.length; from += 1) {
    const to = Math.min(bars.length - 1, from + size - 1);
    let lost = 0;
    for (let bar = from; bar <= to; bar += 1) {
      const score = bars[bar];
      if (score) lost += score.total - score.credit;
    }
    if (lost > 0 && (!best || lost > best.lost)) best = { from, to, lost };
    if (to === bars.length - 1) break;
  }
  return best ? { from: best.from, to: best.to } : null;
}
