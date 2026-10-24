import { playedBars } from "./playback";
import { measureStarts, playedSeconds } from "./sync";
import type { AutoSyncProposal, ScoreDocument } from "./types";

export interface Click {
  /** Seconds in the audio. */
  time: number;
  /** The first beat of a bar. */
  accent: boolean;
  /** The played bar this click is in. */
  bar: number;
}

/** Clicks per bar: one a beat, and in compound time (6/8, 9/8, 12/8) one a dotted quarter. */
export function pulses(signature: [number, number]): number {
  const [numerator, denominator] = signature;
  return denominator === 8 && numerator >= 6 && numerator % 3 === 0 ? numerator / 3 : numerator;
}

/** Bar-start times for the played bars (plus the end) if the proposal's anchors are applied. */
export function proposedStarts(document: ScoreDocument, anchors: Record<string, number>): number[] {
  const numeric: Record<number, number> = {};
  for (const [key, value] of Object.entries(anchors)) numeric[Number(key)] = value;
  return measureStarts(playedSeconds(document), numeric);
}

/** The click track to hear over the audio: an accent on each bar start, a click on each beat after it. */
export function previewClicks(document: ScoreDocument, anchors: Record<string, number>): Click[] {
  const starts = proposedStarts(document, anchors);
  const order = playedBars(document.bars);
  const clicks: Click[] = [];
  order.forEach((written, bar) => {
    const count = pulses(document.bars[written].signature);
    const length = starts[bar + 1] - starts[bar];
    for (let beat = 0; beat < count; beat += 1) {
      clicks.push({ time: starts[bar] + (length * beat) / count, accent: beat === 0, bar });
    }
  });
  return clicks.filter((click) => click.time >= 0);
}

/** Index of the first click at or after `time`. */
export function firstClickAt(clicks: Click[], time: number): number {
  let low = 0;
  let high = clicks.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (clicks[middle].time < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * The clicks to schedule now, from `cursor`: those starting before `now + ahead`. Clicks already behind
 * `now` by more than `late` seconds are skipped (a seek or a stalled timer), not played in a burst.
 */
export function dueClicks(
  clicks: Click[],
  cursor: number,
  now: number,
  ahead = 0.15,
  late = 0.05,
): { due: Click[]; cursor: number } {
  const due: Click[] = [];
  let next = cursor;
  while (next < clicks.length && clicks[next].time < now + ahead) {
    if (clicks[next].time >= now - late) due.push(clicks[next]);
    next += 1;
  }
  return { due, cursor: next };
}

export function confidencePercent(proposal: AutoSyncProposal): number {
  return Math.round(Math.min(1, Math.max(0, proposal.overall)) * 100);
}

/** Played bars (1-based, for display) whose marks are worth checking, in order. */
export function barsToCheck(proposal: AutoSyncProposal): number[] {
  return [...proposal.low_confidence].sort((left, right) => left - right).map((bar) => bar + 1);
}

/** The bar a preview starts from: the one given, or bar 1; always within the proposal's bars. */
export function clampBar(bar: number, barCount: number): number {
  if (!Number.isFinite(bar)) return 0;
  return Math.min(Math.max(Math.round(bar) - 1, 0), Math.max(0, barCount - 1));
}
