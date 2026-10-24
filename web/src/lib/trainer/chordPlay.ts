/*
 * Answering the chord-quality game by playing the chord: the chroma readings of a strum are
 * compared with every chord the game can ask, and the answer is right when the question's root
 * and quality fit the strum at least as well as any other chord. Pure; the component feeds it
 * readings from `ListenSession` and ignores the microphone while the question plays.
 */

import type { ChromaEvent } from "../listen/chroma";
import type { ChordQuality, ChordQuestion } from "./ear";

export interface ChordPlayOptions {
  /** A strum is judged by the readings within this long of its attack, seconds. */
  settleSeconds: number;
  /** An attack this long before the matcher started still counts (clock jitter), seconds. */
  earlySeconds: number;
  /** The best fit has to reach this, 0..1, or the sound is not a chord at all. */
  minFit: number;
  /** The question's chord may trail the best fit by this much and still count (equal notes). */
  tieMargin: number;
  /** Chroma bins weaker than this fraction of the strongest are overtone noise. */
  noiseFloor: number;
  /** Readings in a row that must agree before a strum is accepted. */
  agree: number;
  /** Readings in a row naming another chord before the strum is called wrong. */
  disagree: number;
}

export const DEFAULT_CHORD_PLAY: ChordPlayOptions = {
  settleSeconds: 1.2,
  earlySeconds: 0.08,
  minFit: 0.7,
  tieMargin: 0.02,
  noiseFloor: 0.2,
  agree: 2,
  disagree: 6,
};

/** Cosine similarity between a chroma reading and the notes of a chord, 0..1. */
export function chordFit(bins: readonly number[], pitchClasses: readonly number[]): number {
  const max = Math.max(...bins);
  if (!(max > 0)) return 0;
  return fitOf(bins, pitchClasses, max * DEFAULT_CHORD_PLAY.noiseFloor);
}

function fitOf(bins: readonly number[], pitchClasses: readonly number[], floor: number): number {
  let dot = 0;
  let norm = 0;
  for (let pc = 0; pc < 12; pc += 1) {
    const value = bins[pc] >= floor ? bins[pc] : 0;
    norm += value * value;
    if (pitchClasses.includes(pc)) dot += value;
  }
  if (norm <= 0 || pitchClasses.length === 0) return 0;
  return dot / Math.sqrt(norm * pitchClasses.length);
}

export function questionPitchClasses(question: ChordQuestion): number[] {
  return [...new Set(question.notes.map((note) => note % 12))];
}

export interface HeardChord {
  root: number;
  quality: ChordQuality;
  fit: number;
}

/**
 * The chord among `qualities` (on any root) that fits a reading best, or null when nothing fits
 * well enough. `expected` says whether the question's chord is among the best fits: chords that
 * share their notes (an augmented triad on any of its notes) are the same sound.
 */
export function identifyChord(
  bins: readonly number[],
  qualities: readonly ChordQuality[],
  question: ChordQuestion,
  options: ChordPlayOptions = DEFAULT_CHORD_PLAY,
): { best: HeardChord | null; expected: boolean } {
  const max = Math.max(...bins);
  if (!(max > 0)) return { best: null, expected: false };
  const floor = max * options.noiseFloor;
  let best: HeardChord | null = null;
  for (let root = 0; root < 12; root += 1) {
    for (const quality of qualities) {
      const fit = fitOf(
        bins,
        quality.tones.map((tone) => (root + tone) % 12),
        floor,
      );
      if (!best || fit > best.fit) best = { root, quality, fit };
    }
  }
  if (!best || best.fit < options.minFit) return { best: null, expected: false };
  const wanted = fitOf(bins, questionPitchClasses(question), floor);
  return { best, expected: wanted >= best.fit - options.tieMargin };
}

export type ChordVerdict = "right" | "wrong";

/**
 * Judges strums while a chord question is open. An attack arms it; readings whose whole window
 * came after the attack are matched, and the first strum that settles on a chord is the answer.
 * Call `listen` when the question has finished playing: attacks from before that, and the
 * question's own tail, are not answers.
 */
export class ChordAnswerMatcher {
  private question: ChordQuestion | null = null;
  private qualities: readonly ChordQuality[] = [];
  private since = 0;
  private clock = 0;
  private armedAt: number | null = null;
  private streak = 0;
  private against = 0;
  private heard = false;

  constructor(private readonly options: ChordPlayOptions = DEFAULT_CHORD_PLAY) {}

  /** Start listening for `question` among `qualities`; attacks from before now are ignored. */
  listen(question: ChordQuestion | null, qualities: readonly ChordQuality[] = []): void {
    this.question = question;
    this.qualities = qualities;
    this.since = this.clock;
    this.reset();
  }

  /** Keep the clock moving without judging (the question is playing). */
  tick(event: ChromaEvent): void {
    this.clock = Math.max(this.clock, event.time);
  }

  push(event: ChromaEvent): ChordVerdict | null {
    this.clock = Math.max(this.clock, event.time);
    const question = this.question;
    if (!question) return null;
    if (event.onset) {
      const at = event.onsetTime ?? event.time;
      if (at < this.since - this.options.earlySeconds) return null;
      this.reset();
      this.armedAt = at;
    }
    const armedAt = this.armedAt;
    if (armedAt === null) return null;
    if (event.time - armedAt > this.options.settleSeconds) {
      // The strum never settled on the chord that was asked for.
      const verdict = this.heard ? "wrong" : null;
      this.reset();
      return verdict;
    }
    // A window that still holds sound from before the attack would be judged as the old sound.
    if (event.time - event.span < armedAt - 0.03) return null;
    const { best, expected } = identifyChord(event.bins, this.qualities, question, this.options);
    if (!best) return null;
    this.heard = true;
    this.streak = expected ? this.streak + 1 : 0;
    this.against = expected ? 0 : this.against + 1;
    if (this.streak >= this.options.agree) return this.settle("right");
    if (this.against >= this.options.disagree) return this.settle("wrong");
    return null;
  }

  private settle(verdict: ChordVerdict): ChordVerdict {
    this.reset();
    this.question = null;
    return verdict;
  }

  private reset(): void {
    this.armedAt = null;
    this.streak = 0;
    this.against = 0;
    this.heard = false;
  }
}
