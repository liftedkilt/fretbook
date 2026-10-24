import { parseChord } from "../chords/theory";
import { generateVoicings, physicalTuning } from "../chords/voicings";
import { TICKS_PER_QUARTER } from "../durations";
import type { Beat, Note, ScoreDocument } from "../types";
import {
  CAGED_WINDOWS,
  noteName,
  pitchClass,
  SCALES,
  scalePitchClasses,
  type CagedShape,
} from "./theory";

/**
 * Exercises built from theory: each generator returns a normal Fretbook score document, so every
 * player mode works on it. Strings follow the score model (index 0 is the highest string), and
 * `tuning` is `tuning_midi` in that order.
 */

export const MAX_FRET = 22;
/** A position covers five frets: the first finger on `start` and the little finger on `start + 4`. */
export const POSITION_WIDTH = 5;
const REFERENCE_STRINGS = [40, 45, 50];

export type Rhythm = "quarter" | "eighth" | "triplet" | "sixteenth";
export type Direction = "up" | "down" | "both";
export type Range = "octave" | "twoOctaves" | "position";
export type Position =
  { type: "auto" } | { type: "fret"; fret: number } | { type: "caged"; shape: CagedShape };

export const RHYTHMS: Record<Rhythm, { ticks: number; tuplet: number | null }> = {
  quarter: { ticks: TICKS_PER_QUARTER, tuplet: null },
  eighth: { ticks: TICKS_PER_QUARTER / 2, tuplet: null },
  triplet: { ticks: TICKS_PER_QUARTER / 3, tuplet: 3 },
  sixteenth: { ticks: TICKS_PER_QUARTER / 4, tuplet: null },
};

/** One token per eighth note: `D` down-strum, `U` up-strum, `-` keep ringing. */
export const STRUM_PATTERNS: Record<string, string> = {
  quarters: "D-D-D-D-",
  eighths: "DUDUDUDU",
  folk: "D-DU-UDU",
  ballad: "D--UDU--",
  pop: "D-D-DUDU",
};

export const BASS_PATTERNS = ["rootFifthOctave", "walking"] as const;
export type BassPattern = (typeof BASS_PATTERNS)[number];

export type ExerciseSpec =
  | {
      kind: "scale";
      root: number;
      scale: string;
      position: Position;
      range: Range;
      direction: Direction;
      rhythm: Rhythm;
    }
  | {
      kind: "arpeggio";
      chord: string;
      position: Position;
      range: Range;
      direction: Direction;
      rhythm: Rhythm;
    }
  | {
      kind: "spider";
      /** The fret the first finger plays. */
      startFret: number;
      /** Fingers 1 to 4 in the order they play, such as "1234" or "1324". */
      pattern: string;
      direction: "up" | "down";
      /** How many times the pattern moves up a fret and repeats. */
      shifts: number;
      rhythm: Rhythm;
    }
  | {
      kind: "changes";
      chords: string[];
      beatsEach: number;
      strum: string;
      cycles: number;
    }
  | { kind: "bass"; chords: string[]; pattern: BassPattern; cycles: number };

export interface Setup {
  /** `tuning_midi`: highest string first. */
  tuning: number[];
  instrument: string;
  name: string;
  bpm: number;
}

export interface Generated {
  document: ScoreDocument;
  /** A catalog key and its values for the exercise's title; the caller translates it. */
  label: { key: string; params: Record<string, string | number> };
}

export class ExerciseError extends Error {
  constructor(
    readonly key: string,
    readonly params: Record<string, string | number> = {},
  ) {
    super(key);
  }
}

interface Spot {
  string: number;
  fret: number;
}

interface Pitched extends Spot {
  pitch: number;
}

interface Event {
  notes: Spot[];
  ticks: number;
  tuplet?: number | null;
  strum?: "down" | "up";
}

const SIGNATURE: [number, number] = [4, 4];
const BAR_TICKS = 4 * TICKS_PER_QUARTER;

/** Lay events end to end in 4/4 bars; one that crosses a bar line is split and tied. */
export function layout(events: Event[], barTicks = BAR_TICKS): Beat[][] {
  const bars: Beat[][] = [[]];
  let position = 0;
  for (const event of events) {
    let left = event.ticks;
    let first = true;
    if (event.tuplet && left > barTicks - position) {
      bars.push([]);
      position = 0;
    }
    while (left > 0) {
      const take = Math.min(left, barTicks - position);
      const beat: Beat = {
        position,
        duration: take,
        notes: event.notes.map((spot): Note => ({ ...spot, tie: !first })),
      };
      if (event.tuplet) beat.tuplet = event.tuplet;
      if (event.strum && first) beat.extras = { strum: event.strum };
      bars[bars.length - 1].push(beat);
      position += take;
      left -= take;
      first = false;
      if (position >= barTicks) {
        bars.push([]);
        position = 0;
      }
    }
  }
  if (bars.length > 1 && bars[bars.length - 1].length === 0) bars.pop();
  return bars;
}

function build(setup: Setup, bars: Beat[][]): ScoreDocument {
  return {
    version: 1,
    bpm: setup.bpm,
    bars: bars.map(() => ({ signature: [...SIGNATURE] as [number, number] })),
    tracks: [
      {
        id: "exercise",
        name: setup.name,
        instrument: setup.instrument,
        capo: 0,
        tuning_midi: [...setup.tuning],
        preferred: true,
        bars: bars.map((beats) => ({ voices: [{ beats }] })),
      },
    ],
    sync: { video_id: null, points: [], anchors: {}, keyed_by: "played" },
  };
}

function noteEvents(spots: Spot[], rhythm: Rhythm): Event[] {
  const { ticks, tuplet } = RHYTHMS[rhythm];
  return spots.map((spot) => ({ notes: [{ ...spot }], ticks, tuplet }));
}

/** Where a position's five-fret window starts, for a scale or chord whose parent major key is `parentRoot`. */
export function windowStart(tuning: number[], position: Position, parentRoot: number): number {
  const maxStart = MAX_FRET - POSITION_WIDTH + 1;
  if (position.type === "fret") {
    return Math.min(maxStart, Math.max(0, Math.round(position.fret)));
  }
  const shape = position.type === "caged" ? position.shape : "E";
  const { string, offset } = CAGED_WINDOWS[shape];
  const lowFirst = physicalTuning(tuning);
  const wanted = pitchClass(REFERENCE_STRINGS[string]);
  const found = lowFirst.findIndex((open) => pitchClass(open) === wanted);
  const index = found >= 0 ? found : Math.min(string, lowFirst.length - 1);
  let start = pitchClass(parentRoot - lowFirst[index]) + offset;
  if (position.type === "auto") return Math.min(maxStart, Math.max(0, start));
  while (start < 0) start += 12;
  while (start > maxStart) start -= 12;
  return Math.max(0, start);
}

/** Every note of a pitch-class set inside a position's window, lowest first, one spot per pitch. */
export function windowNotes(tuning: number[], start: number, pcs: Set<number>): Pitched[] {
  const centre = start + (POSITION_WIDTH - 1) / 2;
  const byPitch = new Map<number, Pitched>();
  tuning.forEach((open, string) => {
    for (let fret = start; fret < start + POSITION_WIDTH; fret++) {
      const pitch = open + fret;
      if (!pcs.has(pitchClass(pitch))) continue;
      const known = byPitch.get(pitch);
      if (!known || Math.abs(fret - centre) < Math.abs(known.fret - centre)) {
        byPitch.set(pitch, { string, fret, pitch });
      }
    }
  });
  return [...byPitch.values()].sort((a, b) => a.pitch - b.pitch);
}

function selectRange(notes: Pitched[], tonic: number, range: Range): Pitched[] {
  if (notes.length < 2) throw new ExerciseError("exercises.errors.noNotes");
  if (range === "position") return notes;
  const found = notes.findIndex((note) => pitchClass(note.pitch) === tonic);
  const from = Math.max(found, 0);
  const limit = notes[from].pitch + (range === "octave" ? 12 : 24);
  const picked = notes.slice(from).filter((note) => note.pitch <= limit);
  if (picked.length < 2) throw new ExerciseError("exercises.errors.noNotes");
  return picked;
}

function order<T>(items: T[], direction: Direction): T[] {
  const down = [...items].reverse();
  if (direction === "up") return items;
  if (direction === "down") return down;
  return [...items, ...down.slice(1)];
}

function spotOf({ string, fret }: Pitched): Spot {
  return { string, fret };
}

function scale(setup: Setup, spec: Extract<ExerciseSpec, { kind: "scale" }>): Generated {
  const def = SCALES[spec.scale];
  if (!def) throw new ExerciseError("exercises.errors.unknownScale", { scale: spec.scale });
  const parent = pitchClass(spec.root + def.parent);
  const start = windowStart(setup.tuning, spec.position, parent);
  const pcs = new Set(scalePitchClasses(spec.root, spec.scale));
  const notes = selectRange(
    windowNotes(setup.tuning, start, pcs),
    pitchClass(spec.root),
    spec.range,
  );
  return {
    document: build(
      setup,
      layout(noteEvents(order(notes, spec.direction).map(spotOf), spec.rhythm)),
    ),
    label: {
      key: "exercises.title.scale",
      params: { key: noteName(spec.root), scale: spec.scale, fret: start },
    },
  };
}

function arpeggio(setup: Setup, spec: Extract<ExerciseSpec, { kind: "arpeggio" }>): Generated {
  const chord = parseChord(spec.chord);
  if (!chord) throw new ExerciseError("exercises.errors.badChord", { chord: spec.chord });
  const pcs = new Set([...chord.required, ...chord.optional]);
  const minor = pcs.has(pitchClass(chord.root + 3)) && !pcs.has(pitchClass(chord.root + 4));
  const parent = pitchClass(chord.root + (minor ? 3 : 0));
  const start = windowStart(setup.tuning, spec.position, parent);
  const notes = selectRange(windowNotes(setup.tuning, start, pcs), chord.root, spec.range);
  return {
    document: build(
      setup,
      layout(noteEvents(order(notes, spec.direction).map(spotOf), spec.rhythm)),
    ),
    label: { key: "exercises.title.arpeggio", params: { chord: spec.chord, fret: start } },
  };
}

function spider(setup: Setup, spec: Extract<ExerciseSpec, { kind: "spider" }>): Generated {
  if (!/^[1-4]{2,8}$/.test(spec.pattern)) {
    throw new ExerciseError("exercises.errors.badPattern");
  }
  const reach = Math.max(...[...spec.pattern].map(Number)) - 1;
  const shifts = Math.max(0, Math.round(spec.shifts));
  const start = Math.max(1, Math.round(spec.startFret));
  if (start + reach + shifts > MAX_FRET) throw new ExerciseError("exercises.errors.tooHigh");
  // Highest string first in the score, so counting up the strings is walking the indexes backwards.
  const strings = setup.tuning.map((_, index) => index);
  if (spec.direction === "up") strings.reverse();
  const spots: Spot[] = [];
  for (let shift = 0; shift <= shifts; shift++) {
    for (const string of strings) {
      for (const finger of spec.pattern) {
        spots.push({ string, fret: start + shift + Number(finger) - 1 });
      }
    }
  }
  return {
    document: build(setup, layout(noteEvents(spots, spec.rhythm))),
    label: { key: "exercises.title.spider", params: { pattern: spec.pattern, fret: start } },
  };
}

/** The best open voicing of a chord, as spots from the lowest string to the highest. */
export function chordSpots(tuning: number[], name: string): Spot[] {
  if (!parseChord(name)) throw new ExerciseError("exercises.errors.badChord", { chord: name });
  const voicing = generateVoicings(physicalTuning(tuning), name, { limit: 6 })[0];
  if (!voicing) throw new ExerciseError("exercises.errors.noVoicing", { chord: name });
  const spots: Spot[] = [];
  voicing.frets.forEach((fret, physical) => {
    if (fret !== null) spots.push({ string: tuning.length - 1 - physical, fret });
  });
  return spots;
}

function checkChords(chords: string[], min: number, max: number): string[] {
  const names = chords.map((name) => name.trim()).filter(Boolean);
  if (names.length < min || names.length > max) {
    throw new ExerciseError("exercises.errors.chordCount", { min, max });
  }
  return names;
}

function changes(setup: Setup, spec: Extract<ExerciseSpec, { kind: "changes" }>): Generated {
  const names = checkChords(spec.chords, 2, 4);
  const pattern = STRUM_PATTERNS[spec.strum];
  if (!pattern) throw new ExerciseError("exercises.errors.badPattern");
  const beats = Math.min(16, Math.max(1, Math.round(spec.beatsEach)));
  const cycles = Math.min(8, Math.max(1, Math.round(spec.cycles)));
  const eighth = TICKS_PER_QUARTER / 2;
  const events: Event[] = [];
  for (let cycle = 0; cycle < cycles; cycle++) {
    for (const name of names) {
      const spots = chordSpots(setup.tuning, name);
      let last: Event | null = null;
      for (let slot = 0; slot < beats * 2; slot++) {
        const token = pattern[slot % pattern.length];
        if (token === "D" || token === "U") {
          // An up-stroke only catches the top strings.
          last = {
            notes: token === "D" ? spots : spots.slice(-3),
            ticks: eighth,
            strum: token === "D" ? "down" : "up",
          };
          events.push(last);
        } else if (last) {
          last.ticks += eighth;
        } else {
          last = { notes: [], ticks: eighth };
          events.push(last);
        }
      }
    }
  }
  return {
    document: build(setup, layout(events)),
    label: { key: "exercises.title.changes", params: { chords: names.join(" – ") } },
  };
}

/** Frets for each pitch, keeping the hand close to where it was (a small Viterbi pass). */
export function placePitches(tuning: number[], pitches: number[]): Spot[] {
  const options = pitches.map((pitch) => {
    const spots: Spot[] = [];
    tuning.forEach((open, string) => {
      const fret = pitch - open;
      if (fret >= 0 && fret <= MAX_FRET) spots.push({ string, fret });
    });
    if (!spots.length) throw new ExerciseError("exercises.errors.outOfRange");
    return spots;
  });
  const cost = options[0].map((spot) => spot.fret * 0.05);
  const back: number[][] = [];
  for (let step = 1; step < options.length; step++) {
    const next: number[] = [];
    const via: number[] = [];
    for (const spot of options[step]) {
      let best = Infinity;
      let from = 0;
      options[step - 1].forEach((prev, index) => {
        const move = Math.abs(spot.fret - prev.fret) + 0.5 * Math.abs(spot.string - prev.string);
        if (cost[index] + move < best) {
          best = cost[index] + move;
          from = index;
        }
      });
      next.push(best + spot.fret * 0.05);
      via.push(from);
    }
    cost.splice(0, cost.length, ...next);
    back.push(via);
  }
  let index = cost.indexOf(Math.min(...cost));
  const chosen: Spot[] = [];
  for (let step = options.length - 1; step >= 0; step--) {
    chosen.unshift(options[step][index]);
    if (step > 0) index = back[step - 1][index];
  }
  return chosen;
}

function bass(setup: Setup, spec: Extract<ExerciseSpec, { kind: "bass" }>): Generated {
  const names = checkChords(spec.chords, 1, 8);
  const cycles = Math.min(8, Math.max(1, Math.round(spec.cycles)));
  const chords = names.map((name) => {
    const chord = parseChord(name);
    if (!chord) throw new ExerciseError("exercises.errors.badChord", { chord: name });
    return chord;
  });
  const low = Math.min(...setup.tuning);
  const rootPitch = (pc: number) => low + pitchClass(pc - low);
  const pitches: number[] = [];
  for (let cycle = 0; cycle < cycles; cycle++) {
    chords.forEach((chord, index) => {
      const root = rootPitch(chord.root);
      const fifth = root + 7;
      if (spec.pattern === "rootFifthOctave") {
        pitches.push(root, fifth, root + 12, fifth);
        return;
      }
      const third = root + (chord.required.includes(pitchClass(chord.root + 3)) ? 3 : 4);
      const target = rootPitch(chords[(index + 1) % chords.length].root);
      // Approach the next root by a half step from whichever side is nearer the fifth.
      const approach =
        Math.abs(target - 1 - fifth) <= Math.abs(target + 1 - fifth) ? target - 1 : target + 1;
      pitches.push(root, third, fifth, approach);
    });
  }
  const events = placePitches(setup.tuning, pitches).map((spot) => ({
    notes: [spot],
    ticks: TICKS_PER_QUARTER,
  }));
  return {
    document: build(setup, layout(events)),
    label: {
      key: `exercises.title.${spec.pattern}`,
      params: { chords: names.join(" – ") },
    },
  };
}

export function generateExercise(setup: Setup, spec: ExerciseSpec): Generated {
  switch (spec.kind) {
    case "scale":
      return scale(setup, spec);
    case "arpeggio":
      return arpeggio(setup, spec);
    case "spider":
      return spider(setup, spec);
    case "changes":
      return changes(setup, spec);
    case "bass":
      return bass(setup, spec);
  }
}
