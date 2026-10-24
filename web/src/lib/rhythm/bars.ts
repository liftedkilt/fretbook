import { barTicks, TICKS_PER_QUARTER } from "../durations";
import type { ScoreDocument } from "../types";
import { cellCount, type RhythmPattern } from "./patterns";

export interface BarBreakdown {
  /** Zero-based bar within the scored bars. */
  bar: number;
  /** Per cell: the signed error in ms, `null` for a missed hit, `undefined` for a rest. */
  cells: (number | null | undefined)[];
  expected: number;
  hit: number;
  /** Mean signed error in ms (positive is late); `null` when no hit landed in the bar. */
  meanMs: number | null;
}

/**
 * Splits a run's per-hit errors (in expected-hit order, bar after bar) into one entry per bar,
 * so drift across the run shows up bar by bar.
 */
export function barBreakdown(
  pattern: RhythmPattern,
  bars: number,
  errors: (number | null)[],
): BarBreakdown[] {
  const result: BarBreakdown[] = [];
  let next = 0;
  for (let bar = 0; bar < bars; bar++) {
    const cells: (number | null | undefined)[] = [];
    const hits: number[] = [];
    let expected = 0;
    for (let cell = 0; cell < cellCount(pattern); cell++) {
      if (pattern.cells[cell] !== "x") {
        cells.push(undefined);
        continue;
      }
      const error = errors[next++] ?? null;
      expected++;
      cells.push(error);
      if (error !== null) hits.push(error);
    }
    const meanMs = hits.length ? hits.reduce((a, b) => a + b, 0) / hits.length : null;
    result.push({ bar, cells, expected, hit: hits.length, meanMs });
  }
  return result;
}

/** Colour class for one error, shared by the per-bar cells. */
export function errorTone(
  error: number | null | undefined,
): "" | "good" | "early" | "late" | "missed" {
  if (error === undefined) return "";
  if (error === null) return "missed";
  if (Math.abs(error) <= 25) return "good";
  return error < 0 ? "early" : "late";
}

export interface SongRhythm {
  pattern: RhythmPattern;
  /** First bar (1-based) of the song with this rhythm. */
  firstBar: number;
  /** How many bars of the track play this rhythm. */
  count: number;
}

/** How far from a grid line, in ticks, an onset may be and still sit on it. */
const SNAP_TICKS = 24;
const GRIDS = [1, 2, 3, 4];

/** The coarsest grid (quarters, eighths, triplets, sixteenths) all the onsets fit on, or `null`. */
function fitGrid(onsets: number[]): number | null {
  for (const grid of GRIDS) {
    const step = TICKS_PER_QUARTER / grid;
    if (onsets.every((t) => Math.abs(t - Math.round(t / step) * step) <= SNAP_TICKS)) return grid;
  }
  return null;
}

/**
 * The distinct rhythms of one track's bars, in order of first appearance: each bar's note onsets
 * snapped to a quarter, eighth, triplet or sixteenth grid. Bars with no notes, bars whose length is
 * not a whole number of quarters, and bars with faster or looser rhythms than the grid are left out.
 */
export function songRhythms(doc: ScoreDocument, trackIndex: number): SongRhythm[] {
  const track = doc.tracks[trackIndex];
  if (!track) return [];
  const found = new Map<string, SongRhythm>();
  track.bars.forEach((trackBar, index) => {
    const signature = doc.bars[index]?.signature;
    if (!signature) return;
    const quarters = barTicks(signature) / TICKS_PER_QUARTER;
    if (!Number.isInteger(quarters) || quarters < 1 || quarters > 8) return;
    const onsets = trackBar.voices
      .flatMap((voice) => voice.beats)
      .filter((beat) => !beat.grace && beat.notes.some((note) => !note.tie))
      .map((beat) => beat.position);
    if (!onsets.length) return;
    const grid = fitGrid(onsets);
    if (grid === null) return;
    const step = TICKS_PER_QUARTER / grid;
    const cells = Array.from({ length: quarters * grid }, () => ".");
    for (const t of onsets) {
      const cell = Math.round(t / step);
      if (cell < cells.length) cells[cell] = "x";
    }
    const text = cells.join("");
    const key = `${grid}:${text}`;
    const known = found.get(key);
    if (known) known.count++;
    else
      found.set(key, {
        firstBar: index + 1,
        count: 1,
        pattern: { id: `song:${key}`, labelKey: "", beats: quarters, grid, cells: text },
      });
  });
  return [...found.values()];
}
