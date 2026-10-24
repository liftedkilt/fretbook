/*
 * Ear training: the synth plays an interval or a chord, and the player names it. Pure question
 * and answer logic; playing the sound lives in `audio.ts`.
 */

import type { Rng } from "./fretboardGame";
import { randomInt } from "./fretboardGame";

export interface IntervalChoice {
  id: string;
  semitones: number;
  /** Key under `trainer.intervals` in the locale files. */
  labelKey: string;
}

export const INTERVALS: readonly IntervalChoice[] = [
  { id: "m2", semitones: 1, labelKey: "trainer.intervals.m2" },
  { id: "M2", semitones: 2, labelKey: "trainer.intervals.M2" },
  { id: "m3", semitones: 3, labelKey: "trainer.intervals.m3" },
  { id: "M3", semitones: 4, labelKey: "trainer.intervals.M3" },
  { id: "P4", semitones: 5, labelKey: "trainer.intervals.P4" },
  { id: "TT", semitones: 6, labelKey: "trainer.intervals.TT" },
  { id: "P5", semitones: 7, labelKey: "trainer.intervals.P5" },
  { id: "m6", semitones: 8, labelKey: "trainer.intervals.m6" },
  { id: "M6", semitones: 9, labelKey: "trainer.intervals.M6" },
  { id: "m7", semitones: 10, labelKey: "trainer.intervals.m7" },
  { id: "M7", semitones: 11, labelKey: "trainer.intervals.M7" },
  { id: "P8", semitones: 12, labelKey: "trainer.intervals.P8" },
];

export type EarLevel = "easy" | "all";

/** The easy set is the intervals that are most distinct to the ear. */
const EASY_INTERVALS = ["m3", "M3", "P4", "P5", "P8"];

export function intervalPool(level: EarLevel): IntervalChoice[] {
  return level === "easy" ? INTERVALS.filter((i) => EASY_INTERVALS.includes(i.id)) : [...INTERVALS];
}

export type Direction = "up" | "down";

export interface IntervalQuestion {
  /** Lower note's MIDI number for "up", higher for "down": the note that sounds first. */
  root: number;
  interval: IntervalChoice;
  direction: Direction;
  /** The second note that sounds. */
  target: number;
}

const ROOT_LOW = 52;
const ROOT_HIGH = 67;

export function nextInterval(
  rng: Rng,
  level: EarLevel,
  directions: readonly Direction[] = ["up"],
  previous?: IntervalQuestion | null,
): IntervalQuestion {
  const pool = intervalPool(level);
  let question: IntervalQuestion | null = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const interval = pool[randomInt(rng, pool.length)];
    const direction = directions[randomInt(rng, directions.length)] ?? "up";
    const root = ROOT_LOW + randomInt(rng, ROOT_HIGH - ROOT_LOW + 1);
    question = {
      root,
      interval,
      direction,
      target: direction === "up" ? root + interval.semitones : root - interval.semitones,
    };
    if (!previous || previous.interval.id !== interval.id || previous.direction !== direction)
      return question;
  }
  return question!;
}

export function checkInterval(question: IntervalQuestion, answerId: string): boolean {
  return question.interval.id === answerId;
}

/**
 * Playing the answer back: the player plays the second note. The octave is the player's to pick
 * (on a guitar the same note sits in several places), so only the pitch class has to match.
 */
export function checkPlayedTarget(question: IntervalQuestion, midi: number): boolean {
  return (((midi - question.target) % 12) + 12) % 12 === 0;
}

export interface ChordQuality {
  id: string;
  labelKey: string;
  /** Semitones above the root. */
  tones: number[];
}

export const CHORD_QUALITIES: readonly ChordQuality[] = [
  { id: "major", labelKey: "trainer.chords.major", tones: [0, 4, 7] },
  { id: "minor", labelKey: "trainer.chords.minor", tones: [0, 3, 7] },
  { id: "dim", labelKey: "trainer.chords.dim", tones: [0, 3, 6] },
  { id: "aug", labelKey: "trainer.chords.aug", tones: [0, 4, 8] },
  { id: "sus4", labelKey: "trainer.chords.sus4", tones: [0, 5, 7] },
  { id: "dom7", labelKey: "trainer.chords.dom7", tones: [0, 4, 7, 10] },
  { id: "maj7", labelKey: "trainer.chords.maj7", tones: [0, 4, 7, 11] },
  { id: "min7", labelKey: "trainer.chords.min7", tones: [0, 3, 7, 10] },
];

const EASY_CHORDS = ["major", "minor", "dom7", "maj7"];

export function chordPool(level: EarLevel): ChordQuality[] {
  return level === "easy"
    ? CHORD_QUALITIES.filter((c) => EASY_CHORDS.includes(c.id))
    : [...CHORD_QUALITIES];
}

export interface ChordQuestion {
  root: number;
  quality: ChordQuality;
  /** MIDI notes, lowest first. */
  notes: number[];
}

export function nextChord(
  rng: Rng,
  level: EarLevel,
  previous?: ChordQuestion | null,
): ChordQuestion {
  const pool = chordPool(level);
  let question: ChordQuestion | null = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const quality = pool[randomInt(rng, pool.length)];
    const root = 48 + randomInt(rng, 12);
    question = { root, quality, notes: quality.tones.map((tone) => root + tone) };
    if (!previous || previous.quality.id !== quality.id) return question;
  }
  return question!;
}

export function checkChord(question: ChordQuestion, answerId: string): boolean {
  return question.quality.id === answerId;
}

/** A round of any game, as the session summary needs it. */
export interface RoundResult {
  correct: boolean;
  ms: number;
}

export interface SessionSummary {
  rounds: number;
  correct: number;
  /** 0 to 100, one decimal, or null with no rounds. */
  score: number | null;
  meanMs: number | null;
  bestStreak: number;
}

export function summarize(results: readonly RoundResult[]): SessionSummary {
  let correct = 0;
  let streak = 0;
  let bestStreak = 0;
  let totalMs = 0;
  for (const result of results) {
    if (result.correct) {
      correct += 1;
      streak += 1;
      totalMs += result.ms;
      bestStreak = Math.max(bestStreak, streak);
    } else streak = 0;
  }
  return {
    rounds: results.length,
    correct,
    score: results.length ? Math.round((correct / results.length) * 1000) / 10 : null,
    meanMs: correct ? totalMs / correct : null,
    bestStreak,
  };
}
