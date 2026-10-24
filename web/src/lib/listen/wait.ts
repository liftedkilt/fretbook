import { barTicks } from "../durations";
import { playedBars } from "../playback";
import type { ScoreDocument, Track } from "../types";
import { chromaScore, type ChromaEvent } from "./chroma";
import type { PitchEvent } from "./engine";

/*
 * Wait mode: the cursor stops on each beat until the expected note is heard. The expected notes
 * come from the score (tuning + capo + fret), so this only has to check for one note. Everything
 * here is pure: the player feeds it the beats it reaches and the detector's events.
 */

export interface WaitStep {
  /** Played bar index (the written bars expanded through repeats and jumps). */
  bar: number;
  /** Ticks from the start of that bar. */
  position: number;
  /** Ticks from the start of the expanded song. */
  tick: number;
  /**
   * A dead (muted) note accepts any attack; a note needs its pitch; a chord needs its pitch
   * classes (`pcs`) to be heard together, checked on the chroma rather than note by note.
   */
  kind: "note" | "dead" | "chord";
  /** Pitches that satisfy a note step. A chord counted note by note accepts any one of them. */
  midis: number[];
  /** Pitch classes (C = 0) of a chord step. */
  pcs?: number[];
  /** What to show for a chord step that did not come from a tab, e.g. "Am7". */
  label?: string;
  /** Where to play the first of them (0 is the highest string), for the hint. */
  string: number;
  fret: number;
}

export interface WaitOptions {
  /** Count the right note in any octave. On by default, as on a bass the octave is easy to miss. */
  anyOctave: boolean;
  /** How far from the note's centre a reading may be, in cents. */
  centsTolerance: number;
  /** How long after an attack the pitch may settle, seconds. */
  settleSeconds: number;
  /** An attack this far before the cursor stopped still counts (latency), seconds. */
  earlySeconds: number;
  /** Lowest chroma match (0..1) that counts as the chord. Lenient: a missing string still passes. */
  chordThreshold: number;
  /** How long after a strum the chord may keep being checked, seconds. */
  chordSettleSeconds: number;
}

export const DEFAULT_WAIT_OPTIONS: WaitOptions = {
  anyOctave: true,
  centsTolerance: 40,
  settleSeconds: 0.3,
  earlySeconds: 0.08,
  chordThreshold: 0.6,
  chordSettleSeconds: 1.2,
};

export interface WaitStepOptions {
  /** Check a beat of two or more different notes as a chord by its pitch content. On by default. */
  chords?: boolean;
}

/** The beats of one track that the player has to play, in played order. */
export function buildWaitSteps(
  document: ScoreDocument,
  track: Track,
  options: WaitStepOptions = {},
): WaitStep[] {
  const chords = options.chords ?? true;
  const steps: WaitStep[] = [];
  let barStart = 0;
  playedBars(document.bars).forEach((written, played) => {
    const merged = new Map<number, WaitStep>();
    for (const voice of track.bars[written]?.voices ?? []) {
      for (const beat of voice.beats) {
        if (beat.grace) continue;
        // A tied note is already sounding, and a beat with no notes is a rest.
        const notes = beat.notes.filter((note) => !note.tie);
        if (notes.length === 0) continue;
        const midis = notes
          .filter((note) => !note.dead)
          .map((note) => (track.tuning_midi[note.string] ?? 0) + track.capo + note.fret);
        const first = notes[0];
        const existing = merged.get(beat.position);
        if (existing) {
          // Two voices on one beat: the pitched note wins over a dead one.
          if (existing.kind === "dead" && midis.length > 0) existing.kind = "note";
          existing.midis.push(...midis);
          continue;
        }
        merged.set(beat.position, {
          bar: played,
          position: beat.position,
          tick: barStart + beat.position,
          kind: midis.length > 0 ? "note" : "dead",
          midis,
          string: first.string,
          fret: first.fret,
        });
      }
    }
    for (const step of merged.values()) {
      const pcs = [...new Set(step.midis.map((midi) => midi % 12))].sort((a, b) => a - b);
      // An octave double is still one note; only different pitch classes make a chord.
      if (chords && step.kind === "note" && pcs.length >= 2) {
        step.kind = "chord";
        step.pcs = pcs;
      }
    }
    steps.push(...[...merged.values()].sort((a, b) => a.position - b.position));
    barStart += barTicks(document.bars[written].signature);
  });
  return steps;
}

/** Same pitch class, or the same note when `anyOctave` is off. */
export function pitchMatches(heard: number, expected: number, anyOctave: boolean): boolean {
  return anyOctave ? (((heard - expected) % 12) + 12) % 12 === 0 : heard === expected;
}

/**
 * Decides when the step the cursor is waiting on has been played. An attack that happens after
 * the cursor stopped arms it; a matching pitch within `settleSeconds` of that attack is a hit.
 * Requiring a fresh attack keeps a still-ringing previous note, or the same note twice in a row,
 * from counting for the next beat.
 */
export class WaitMatcher {
  private step: WaitStep | null = null;
  private since = 0;
  private clock = 0;
  private armedAt: number | null = null;
  private chordArmedAt: number | null = null;
  /** The best chord match since the strum that is being checked, 0..1. */
  chordScore = 0;
  /** Wrong notes heard while waiting on the current step. */
  wrong = 0;

  constructor(private readonly options: WaitOptions = DEFAULT_WAIT_OPTIONS) {}

  /** Start waiting on `step`. Attacks from before now do not count. */
  wait(step: WaitStep | null): void {
    this.step = step;
    this.since = this.clock;
    this.armedAt = null;
    this.chordArmedAt = null;
    this.chordScore = 0;
    this.wrong = 0;
  }

  get waiting(): WaitStep | null {
    return this.step;
  }

  /**
   * True when a chroma reading completes the chord being waited on. A strum arms it; readings
   * whose whole window came after the strum are scored against the chord's pitch classes.
   */
  pushChroma(event: ChromaEvent): boolean {
    this.clock = Math.max(this.clock, event.time);
    const step = this.step;
    if (!step || step.kind !== "chord") return false;
    if (event.onset) {
      const at = event.onsetTime ?? event.time;
      if (at < this.since - this.options.earlySeconds) return false;
      this.chordArmedAt = at;
      this.chordScore = 0;
    }
    const armedAt = this.chordArmedAt;
    if (armedAt === null) return false;
    if (event.time - armedAt > this.options.chordSettleSeconds) {
      // That strum was not the chord; wait for the next one.
      this.wrong += 1;
      this.chordArmedAt = null;
      return false;
    }
    // A window that still holds sound from before the strum would score the previous chord.
    if (event.time - event.span < armedAt - 0.03) return false;
    const score = chromaScore(event.bins, step.pcs ?? []);
    this.chordScore = Math.max(this.chordScore, score);
    return score >= this.options.chordThreshold;
  }

  /** True when `event` completes the step being waited on. */
  push(event: PitchEvent): boolean {
    this.clock = Math.max(this.clock, event.time);
    const step = this.step;
    // A chord is judged on the chroma, not on the single pitch the detector makes of it.
    if (!step || step.kind === "chord") return false;
    if (event.onset) {
      const at = event.onsetTime ?? event.time;
      if (at < this.since - this.options.earlySeconds) return false;
      if (step.kind === "dead") return true;
      this.armedAt = at;
    }
    if (step.kind === "dead" || this.armedAt === null) return false;
    if (event.time - this.armedAt > this.options.settleSeconds) {
      // The attack was something else; wait for the next one.
      if (event.midi !== null) this.wrong += 1;
      this.armedAt = null;
      return false;
    }
    if (event.midi === null || event.cents === null) return false;
    if (Math.abs(event.cents) > this.options.centsTolerance) return false;
    const heard = event.midi;
    return step.midis.some((midi) => pitchMatches(heard, midi, this.options.anyOctave));
  }
}

/** Index of the step that starts at this played bar and position, or -1 when it is not one. */
export function stepIndexAt(steps: readonly WaitStep[], bar: number, position: number): number {
  let low = 0;
  let high = steps.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const step = steps[mid];
    if (step.bar === bar && step.position === position) return mid;
    if (step.bar < bar || (step.bar === bar && step.position < position)) low = mid + 1;
    else high = mid - 1;
  }
  return -1;
}
