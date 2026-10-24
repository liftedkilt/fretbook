/** Scale, mode and position tables for the exercise generator. Pitch classes are 0 (C) to 11. */

export const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "Eb",
  "E",
  "F",
  "F#",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
] as const;

export interface ScaleDef {
  /** Semitones above the tonic, ascending, tonic first. */
  intervals: number[];
  /**
   * Semitones to add to the tonic to reach the major key whose CAGED shapes the scale sits in:
   * a mode shares the fingering of its parent major scale, and a minor scale of its relative major.
   */
  parent: number;
}

export const SCALES: Record<string, ScaleDef> = {
  major: { intervals: [0, 2, 4, 5, 7, 9, 11], parent: 0 },
  dorian: { intervals: [0, 2, 3, 5, 7, 9, 10], parent: 10 },
  phrygian: { intervals: [0, 1, 3, 5, 7, 8, 10], parent: 8 },
  lydian: { intervals: [0, 2, 4, 6, 7, 9, 11], parent: 7 },
  mixolydian: { intervals: [0, 2, 4, 5, 7, 9, 10], parent: 5 },
  minor: { intervals: [0, 2, 3, 5, 7, 8, 10], parent: 3 },
  locrian: { intervals: [0, 1, 3, 5, 6, 8, 10], parent: 1 },
  harmonicMinor: { intervals: [0, 2, 3, 5, 7, 8, 11], parent: 3 },
  melodicMinor: { intervals: [0, 2, 3, 5, 7, 9, 11], parent: 3 },
  majorPentatonic: { intervals: [0, 2, 4, 7, 9], parent: 0 },
  minorPentatonic: { intervals: [0, 3, 5, 7, 10], parent: 3 },
  blues: { intervals: [0, 3, 5, 6, 7, 10], parent: 3 },
  wholeTone: { intervals: [0, 2, 4, 6, 8, 10], parent: 0 },
};

export const SCALE_IDS = Object.keys(SCALES);

/** The five open-chord shapes a major scale is built around, in the order they climb the neck. */
export const CAGED_SHAPES = ["C", "A", "G", "E", "D"] as const;
export type CagedShape = (typeof CAGED_SHAPES)[number];

/**
 * Where each shape's five-fret window starts, as the string its root is on (the open pitch of the 6th,
 * 5th or 4th string of a guitar) and an offset from the root's fret on that string.
 */
export const CAGED_WINDOWS: Record<CagedShape, { string: 0 | 1 | 2; offset: number }> = {
  C: { string: 1, offset: -3 },
  A: { string: 1, offset: -1 },
  G: { string: 0, offset: -3 },
  E: { string: 0, offset: -1 },
  D: { string: 2, offset: -1 },
};

export function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

export function noteName(pc: number): string {
  return NOTE_NAMES[pitchClass(pc)];
}

/** The pitch classes of a scale in a key. */
export function scalePitchClasses(root: number, scale: string): number[] {
  const def = SCALES[scale];
  if (!def) throw new Error(`unknown scale ${scale}`);
  return def.intervals.map((interval) => pitchClass(root + interval));
}
