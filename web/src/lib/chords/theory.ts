import { CHORD, PITCH, transposeChord } from "../chordpro";

/**
 * Chord symbols as pitch classes. The parser accepts the same roots and slash
 * basses as `transposeChord`, so a chord that transposes also gets a diagram.
 */

interface Quality {
  /** Semitones above the root. */
  intervals: number[];
  /** Intervals a voicing may leave out (usually the fifth). */
  optional: number[];
}

const QUALITIES: Record<string, Quality> = {
  maj: { intervals: [0, 4, 7], optional: [] },
  m: { intervals: [0, 3, 7], optional: [] },
  "5": { intervals: [0, 7], optional: [] },
  "6": { intervals: [0, 4, 7, 9], optional: [7] },
  m6: { intervals: [0, 3, 7, 9], optional: [7] },
  "7": { intervals: [0, 4, 7, 10], optional: [7] },
  maj7: { intervals: [0, 4, 7, 11], optional: [7] },
  m7: { intervals: [0, 3, 7, 10], optional: [7] },
  mmaj7: { intervals: [0, 3, 7, 11], optional: [7] },
  m7b5: { intervals: [0, 3, 6, 10], optional: [] },
  dim: { intervals: [0, 3, 6], optional: [] },
  dim7: { intervals: [0, 3, 6, 9], optional: [] },
  aug: { intervals: [0, 4, 8], optional: [] },
  aug7: { intervals: [0, 4, 8, 10], optional: [] },
  sus2: { intervals: [0, 2, 7], optional: [] },
  sus4: { intervals: [0, 5, 7], optional: [] },
  "7sus4": { intervals: [0, 5, 7, 10], optional: [7] },
  add9: { intervals: [0, 2, 4, 7], optional: [7] },
  "9": { intervals: [0, 2, 4, 7, 10], optional: [7] },
  m9: { intervals: [0, 2, 3, 7, 10], optional: [7] },
  maj9: { intervals: [0, 2, 4, 7, 11], optional: [7] },
  "7b9": { intervals: [0, 1, 4, 7, 10], optional: [7] },
  "7#9": { intervals: [0, 3, 4, 7, 10], optional: [7] },
};

const ALIASES: Record<string, string> = {
  "": "maj",
  maj: "maj",
  M: "maj",
  m: "m",
  min: "m",
  "-": "m",
  "5": "5",
  "6": "6",
  m6: "m6",
  min6: "m6",
  "7": "7",
  dom7: "7",
  maj7: "maj7",
  M7: "maj7",
  ma7: "maj7",
  Δ: "maj7",
  Δ7: "maj7",
  m7: "m7",
  min7: "m7",
  "-7": "m7",
  mmaj7: "mmaj7",
  mM7: "mmaj7",
  minmaj7: "mmaj7",
  m7b5: "m7b5",
  "m7-5": "m7b5",
  min7b5: "m7b5",
  ø: "m7b5",
  ø7: "m7b5",
  dim: "dim",
  mb5: "dim",
  "°": "dim",
  o: "dim",
  dim7: "dim7",
  "°7": "dim7",
  o7: "dim7",
  aug: "aug",
  "+": "aug",
  "#5": "aug",
  aug7: "aug7",
  "+7": "aug7",
  "7#5": "aug7",
  sus2: "sus2",
  sus4: "sus4",
  sus: "sus4",
  "7sus4": "7sus4",
  "7sus": "7sus4",
  add9: "add9",
  "9": "9",
  m9: "m9",
  min9: "m9",
  maj9: "maj9",
  M9: "maj9",
  "7b9": "7b9",
  "7#9": "7#9",
};

export interface ParsedChord {
  /** The symbol as given. */
  name: string;
  /** Root pitch class, 0 (C) to 11. */
  root: number;
  quality: string;
  /** Slash bass pitch class, if any. */
  bass: number | null;
  /** Every pitch class a voicing must contain. */
  required: number[];
  /** Pitch classes a voicing may add but need not. */
  optional: number[];
}

/** Read a chord symbol, or `null` for anything that is not a chord we can draw (N.C., x2, |). */
export function parseChord(name: string): ParsedChord | null {
  const match = CHORD.exec(name.trim());
  if (!match) return null;
  const [, root, rawQuality, bassName] = match;
  const quality = ALIASES[rawQuality.replace(/[()\s]/g, "")];
  const rootPitch = PITCH[root];
  if (!quality || rootPitch === undefined) return null;
  let bass: number | null = null;
  if (bassName) {
    const bassPitch = PITCH[bassName];
    if (bassPitch === undefined) return null;
    bass = bassPitch === rootPitch ? null : bassPitch;
  }
  const { intervals, optional } = QUALITIES[quality];
  const pitches = (list: number[]) => list.map((interval) => (rootPitch + interval) % 12);
  const required = pitches(intervals.filter((interval) => !optional.includes(interval)));
  if (bass !== null && !required.includes(bass) && !pitches(optional).includes(bass)) {
    required.push(bass);
  }
  return {
    name: name.trim(),
    root: rootPitch,
    quality,
    bass,
    required: [...new Set(required)],
    optional: pitches(optional).filter((pitch) => !required.includes(pitch)),
  };
}

/** The name a chord is shown under once transposed. */
export function shapeName(chord: string, transpose: number, flats: boolean): string {
  return transposeChord(chord, transpose, flats);
}
