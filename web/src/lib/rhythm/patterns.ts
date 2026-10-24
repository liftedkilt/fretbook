/**
 * Rhythm patterns for the rhythm trainer. A pattern is one bar of `beats` beats cut into `grid`
 * equal cells per beat; `x` is a hit and `.` is a rest. All patterns here are original.
 */
export interface RhythmPattern {
  id: string;
  /** Locale key for the pattern's name. */
  labelKey: string;
  /** A name that needs no translation, for a pattern taken from a song. */
  label?: string;
  beats: number;
  /** Cells per beat: 1 quarters, 2 eighths, 3 triplets, 4 sixteenths. */
  grid: number;
  /** One character per cell, `beats * grid` long. */
  cells: string;
}

export type StrumDirection = "down" | "up";

export const PATTERNS: RhythmPattern[] = [
  { id: "quarters", labelKey: "rhythm.patterns.quarters", beats: 4, grid: 1, cells: "xxxx" },
  { id: "eighths", labelKey: "rhythm.patterns.eighths", beats: 4, grid: 2, cells: "xxxxxxxx" },
  {
    id: "sixteenths",
    labelKey: "rhythm.patterns.sixteenths",
    beats: 4,
    grid: 4,
    cells: "xxxxxxxxxxxxxxxx",
  },
  {
    id: "triplets",
    labelKey: "rhythm.patterns.triplets",
    beats: 4,
    grid: 3,
    cells: "xxxxxxxxxxxx",
  },
  { id: "rests", labelKey: "rhythm.patterns.rests", beats: 4, grid: 1, cells: "x.x." },
  { id: "offbeats", labelKey: "rhythm.patterns.offbeats", beats: 4, grid: 2, cells: ".x.x.x.x" },
  {
    id: "syncopation",
    labelKey: "rhythm.patterns.syncopation",
    beats: 4,
    grid: 2,
    cells: "x..xx.x.",
  },
  {
    id: "gallop",
    labelKey: "rhythm.patterns.gallop",
    beats: 4,
    grid: 4,
    cells: "x.xxx.xxx.xxx.xx",
  },
  {
    id: "tripletRests",
    labelKey: "rhythm.patterns.tripletRests",
    beats: 4,
    grid: 3,
    cells: "x.xx.xx.xx.x",
  },
];

export const DEFAULT_PATTERN_ID = "eighths";

export function patternById(id: string): RhythmPattern {
  return (
    PATTERNS.find((pattern) => pattern.id === id) ??
    PATTERNS.find((p) => p.id === DEFAULT_PATTERN_ID)!
  );
}

export function cellCount(pattern: RhythmPattern): number {
  return pattern.beats * pattern.grid;
}

/** Seconds from the start of a bar to a cell. */
export function cellSeconds(pattern: RhythmPattern, bpm: number, cell: number): number {
  return (cell / pattern.grid) * (60 / bpm);
}

export function barSeconds(pattern: RhythmPattern, bpm: number): number {
  return pattern.beats * (60 / bpm);
}

/** Strums go down on the beat and alternate from there, as a strumming hand does. */
export function strumDirection(pattern: RhythmPattern, cell: number): StrumDirection {
  return (cell % pattern.grid) % 2 === 0 ? "down" : "up";
}

/** Times in milliseconds, from the start of the first bar, of every hit over `bars` bars. */
export function expectedHits(pattern: RhythmPattern, bpm: number, bars: number): number[] {
  const hits: number[] = [];
  const bar = barSeconds(pattern, bpm) * 1000;
  for (let b = 0; b < bars; b++) {
    for (let cell = 0; cell < cellCount(pattern); cell++) {
      if (pattern.cells[cell] === "x") hits.push(b * bar + cellSeconds(pattern, bpm, cell) * 1000);
    }
  }
  return hits;
}
