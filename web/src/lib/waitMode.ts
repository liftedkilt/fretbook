import { barTicks } from "./durations";
import type { PitchEvent } from "./listen";
import { playedBars } from "./playback";
import type { ScoreDocument } from "./types";

/*
 * Wait mode: the cursor stops on each note until the player plays it. The expected notes come
 * from the score (string tuning + capo + fret), so the only question per beat is "did the
 * detector hear that note?". This file is pure: it turns a track into steps, and a controller
 * turns synth positions and detector events into pause, resume and seek calls.
 *
 * Clocks: detector events are stamped on the microphone's AudioContext clock, the synth reports
 * ticks. The two are never compared. Onsets are only compared with other detector times, and
 * "the cursor reached the step" is remembered as the latest detector time at that moment.
 */

/** One beat the player has to play. Rests, tied notes, grace notes and empty beats make no step. */
export interface WaitStep {
  /** Ticks from the start of the song as played (repeats and jumps expanded). */
  tick: number;
  /** Played bar index. */
  bar: number;
  /** MIDI pitches that satisfy the step: any one of them counts. Empty means a dead note: any attack. */
  pitches: number[];
  /** The lowest pitched note, for the hint: 0 is the highest string. */
  string: number;
  fret: number;
}

/** Pitch of a fretted note; frets are written relative to the nut, so the capo adds to them. */
export function notePitch(tuning: number[], capo: number, string: number, fret: number): number {
  return (tuning[string] ?? 0) + capo + fret;
}

/** First tick of each played bar, plus the end of the song as the last entry. */
export function barStartTicks(document: ScoreDocument): number[] {
  const order = playedBars(document.bars);
  const starts: number[] = [];
  let tick = 0;
  for (const written of order) {
    starts.push(tick);
    tick += barTicks(document.bars[written].signature);
  }
  starts.push(tick);
  return starts;
}

/** The expected notes of one track, in playing order. Uses voice 0 only. */
export function buildSteps(document: ScoreDocument, trackId: string): WaitStep[] {
  const track = document.tracks.find((item) => item.id === trackId);
  if (!track) return [];
  const order = playedBars(document.bars);
  const starts = barStartTicks(document);
  const steps: WaitStep[] = [];
  order.forEach((written, bar) => {
    const beats = track.bars[written]?.voices[0]?.beats ?? [];
    for (const beat of beats) {
      if (beat.grace) continue;
      // A tied note sounds on from the last beat, so there is nothing new to play.
      const fresh = beat.notes.filter((note) => !note.tie);
      if (fresh.length === 0) continue;
      const pitched = fresh.filter((note) => !note.dead);
      const pitches = pitched.map((note) =>
        notePitch(track.tuning_midi, track.capo, note.string, note.fret),
      );
      // The lowest note names the step in the hint and steers the detector.
      const lowest = pitched.reduce<(typeof pitched)[number] | undefined>(
        (best, note) =>
          !best ||
          notePitch(track.tuning_midi, track.capo, note.string, note.fret) <
            notePitch(track.tuning_midi, track.capo, best.string, best.fret)
            ? note
            : best,
        undefined,
      );
      const shown = lowest ?? fresh[0];
      steps.push({
        tick: starts[bar] + beat.position,
        bar,
        pitches,
        string: shown.string,
        fret: shown.fret,
      });
    }
  });
  return steps;
}

export interface WaitOptions {
  /** `any`: the right note in any octave counts. */
  octave: "any" | "exact";
  /** How far from the expected pitch a reading may be, in cents. */
  toleranceCents: number;
  /** Seconds of waiting before the hint appears. */
  hintAfter: number;
  /** Play the other tracks with the synth while waiting; off keeps the synth silent. */
  backing: boolean;
}

export function defaultWaitOptions(): WaitOptions {
  return { octave: "any", toleranceCents: 45, hintAfter: 4, backing: true };
}

export const HINT_CHOICES = [2, 4, 8, 15];
const STORAGE_KEY = "fretbook.wait";

/** Reads stored options, keeping every valid field and defaulting the rest. */
export function parseWaitOptions(raw: unknown): WaitOptions {
  const result = defaultWaitOptions();
  if (typeof raw !== "object" || raw === null) return result;
  const value = raw as Record<string, unknown>;
  if (value.octave === "any" || value.octave === "exact") result.octave = value.octave;
  if (typeof value.toleranceCents === "number" && Number.isFinite(value.toleranceCents)) {
    result.toleranceCents = Math.min(50, Math.max(10, value.toleranceCents));
  }
  if (typeof value.hintAfter === "number" && HINT_CHOICES.includes(value.hintAfter)) {
    result.hintAfter = value.hintAfter;
  }
  if (typeof value.backing === "boolean") result.backing = value.backing;
  return result;
}

export function loadWaitOptions(): WaitOptions {
  try {
    return parseWaitOptions(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
  } catch {
    return defaultWaitOptions();
  }
}

export function saveWaitOptions(options: WaitOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
    // Private mode or a full disk: the options just are not remembered.
  }
}

const EARLY = 0.25; // seconds an attack may come before the cursor reaches the beat
const CONFIRM = 0.45; // seconds after an attack in which its pitch must read as the right note
const REFRACTORY = 0.05; // attacks closer than this to a consumed one are the same attack
const BACK_JUMP = 120; // ticks the moving position may fall back before it counts as a jump
const FORWARD_JUMP = 1920; // ...or move on in one event
const SEEK_SLACK = 20; // ticks: a seek to a bar line may land a hair after the first beat

/** Whether a reading is the expected pitch, folding octaves when asked. */
export function pitchMatches(
  reading: { midi: number; cents: number },
  expected: number,
  options: Pick<WaitOptions, "octave" | "toleranceCents">,
): boolean {
  let distance = (reading.midi - expected) * 100 + reading.cents;
  if (options.octave === "any") distance = ((((distance + 600) % 1200) + 1200) % 1200) - 600;
  return Math.abs(distance) <= options.toleranceCents;
}

export type WaitPhase = "idle" | "playing" | "waiting" | "done";

export interface WaitState {
  phase: WaitPhase;
  /** Index into the steps of the note being waited for or approached. */
  index: number;
  step: WaitStep | null;
  /** True once the player has been stuck on the step for `hintAfter` seconds. */
  hint: boolean;
  /** Increases on every hit, for animating the feedback. */
  hits: number;
  /** Notes played right, for the end summary. */
  total: number;
}

export interface WaitHost {
  pause(): void;
  play(): void;
  seek(tick: number): void;
  /** Tell the detector which note comes next (null for none). */
  expect(midi: number | null): void;
  /** Called after every state change. */
  changed(state: WaitState): void;
  /** Wall-clock milliseconds, for the hint. */
  now?(): number;
}

interface Attack {
  time: number;
  readings: { time: number; midi: number; cents: number }[];
}

export class WaitController {
  private steps: WaitStep[] = [];
  private index = 0;
  private phase: WaitPhase = "idle";
  private reached = false;
  private running = false;
  private hint = false;
  private hits = 0;
  private waitSince = 0;
  private micNow = 0;
  private reachedAt = 0;
  private consumed = -Infinity;
  private attacks: Attack[] = [];
  private lastTick: number | null = null;
  private range: { start: number; end: number; loop: boolean } = {
    start: 0,
    end: Infinity,
    loop: false,
  };

  constructor(
    private readonly host: WaitHost,
    private options: WaitOptions = defaultWaitOptions(),
  ) {}

  get state(): WaitState {
    return {
      phase: this.phase,
      index: this.index,
      step: this.phase === "done" ? null : (this.steps[this.index] ?? null),
      hint: this.hint,
      hits: this.hits,
      total: this.steps.length,
    };
  }

  setOptions(options: WaitOptions): void {
    this.options = options;
  }

  /** Load the steps and start at `tick`, within the loop range if there is one. */
  start(steps: WaitStep[], tick: number, range?: { start: number; end: number } | null): void {
    this.steps = steps;
    this.range = range ? { ...range, loop: true } : { start: 0, end: Infinity, loop: false };
    this.hits = 0;
    this.consumed = -Infinity;
    this.reposition(tick);
  }

  stop(): void {
    this.phase = "idle";
    this.host.expect(null);
    this.emit();
  }

  /** The cursor jumped (a bar button, the scrubber, a click on the score). */
  reposition(tick: number): void {
    const from = this.range.loop && tick >= this.range.end ? this.range.start : tick;
    this.lastTick = null;
    this.index = this.firstFrom(from);
    this.phase = this.index < this.limit() ? "playing" : "done";
    this.reached = false;
    this.hint = false;
    this.attacks = [];
    this.arm();
    this.emit();
  }

  /** Replace the steps (a track switch) and keep the position. */
  retarget(steps: WaitStep[], tick: number): void {
    this.steps = steps;
    this.reposition(tick);
  }

  /** Give up on the current note and move on. */
  skip(): void {
    if (this.phase === "waiting" || this.phase === "playing") this.advance(false);
  }

  /** Whether the synth is playing. The cursor only waits while it moves; a stopped synth reports ticks too. */
  setRunning(running: boolean): void {
    this.running = running;
  }

  /**
   * The synth's position, from its position events. Seek events are ignored: they also report where
   * the synth was a moment ago, so only moving ticks are trusted. A jump in the moving ticks (the
   * player clicked the score) repositions the steps.
   */
  onTick(tick: number, isSeek = false): void {
    if (isSeek || this.phase === "idle" || this.phase === "done") return;
    if (!this.running || this.phase !== "playing") return;
    const last = this.lastTick;
    this.lastTick = tick;
    if (last !== null && (tick < last - BACK_JUMP || tick > last + FORWARD_JUMP)) {
      this.reposition(tick);
      this.lastTick = tick;
    }
    if (this.reached) return;
    const step = this.steps[this.index];
    if (!step || tick < step.tick) return;
    this.reached = true;
    this.reachedAt = this.micNow;
    this.attacks = this.attacks.filter((attack) => attack.time >= this.micNow - EARLY);
    if (this.satisfied()) return this.advance(true);
    this.phase = "waiting";
    this.waitSince = this.wall();
    this.hint = false;
    this.host.pause();
    this.seek(step.tick);
    this.emit();
  }

  /** Detector events, in order. */
  onPitch(event: PitchEvent): void {
    this.micNow = event.time;
    if (this.phase === "idle" || this.phase === "done") return;
    if (event.onset) {
      const time = event.onsetTime ?? event.time;
      if (time > this.consumed + REFRACTORY) this.attacks.push({ time, readings: [] });
    }
    if (event.midi !== null && event.cents !== null) {
      const reading = { time: event.time, midi: event.midi, cents: event.cents };
      for (const attack of this.attacks) {
        if (event.time >= attack.time && event.time <= attack.time + CONFIRM) {
          attack.readings.push(reading);
        }
      }
    }
    // While approaching, keep only the attacks that can still count as "a little early".
    if (this.phase === "playing" || !this.reached) {
      this.attacks = this.attacks.filter((attack) => attack.time >= event.time - EARLY - CONFIRM);
    } else {
      this.attacks = this.attacks.filter((attack) => attack.time >= this.reachedAt - EARLY);
    }
    if (this.phase === "waiting" && this.satisfied()) this.advance(true);
  }

  /** Call a few times a second: shows the hint once the player has been stuck for a while. */
  poll(): void {
    if (this.phase !== "waiting" || this.hint) return;
    if (this.wall() - this.waitSince >= this.options.hintAfter * 1000) {
      this.hint = true;
      this.emit();
    }
  }

  private wall(): number {
    return this.host.now ? this.host.now() : Date.now();
  }

  private limit(): number {
    let end = this.steps.length;
    while (end > 0 && this.steps[end - 1].tick >= this.range.end) end -= 1;
    return end;
  }

  private firstFrom(tick: number): number {
    const found = this.steps.findIndex((step) => step.tick >= tick - SEEK_SLACK);
    return found < 0 ? this.steps.length : found;
  }

  private seek(tick: number): void {
    this.lastTick = null;
    this.host.seek(tick);
  }

  private satisfied(): boolean {
    const step = this.steps[this.index];
    if (!step) return false;
    return this.attacks.some((attack) => {
      if (attack.time <= this.consumed + REFRACTORY) return false;
      if (step.pitches.length === 0) return true;
      return attack.readings.some((reading) =>
        step.pitches.some((pitch) => pitchMatches(reading, pitch, this.options)),
      );
    });
  }

  private arm(): void {
    const step = this.steps[this.index];
    const lowest = step && step.pitches.length > 0 ? Math.min(...step.pitches) : null;
    this.host.expect(this.phase === "done" ? null : lowest);
  }

  /** Move past the current step, resuming the synth if it was waiting. */
  private advance(played: boolean): void {
    const wasWaiting = this.phase === "waiting";
    if (played) {
      this.hits += 1;
      // Everything heard so far belongs to this note; the next one needs a fresh attack.
      this.consumed = Math.max(this.consumed, this.micNow - 0.01);
    }
    this.attacks = [];
    this.lastTick = null;
    this.index += 1;
    this.reached = false;
    this.hint = false;
    if (this.index >= this.limit()) {
      if (this.range.loop) {
        this.index = this.firstFrom(this.range.start);
        this.phase = this.index < this.limit() ? "playing" : "done";
        if (this.phase === "playing") {
          this.seek(this.range.start);
          this.host.play();
        }
      } else {
        this.phase = "done";
        if (wasWaiting) this.host.pause();
      }
    } else {
      this.phase = "playing";
      if (wasWaiting) this.host.play();
    }
    this.arm();
    this.emit();
  }

  private emit(): void {
    this.host.changed(this.state);
  }
}
