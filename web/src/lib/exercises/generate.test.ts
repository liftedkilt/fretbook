import { describe, expect, it } from "vitest";

import { parseChord } from "../chords/theory";
import { PRESET_DRILLS, labelText } from "./presets";
import {
  ExerciseError,
  chordSpots,
  generateExercise,
  layout,
  placePitches,
  windowStart,
  type ExerciseSpec,
  type Setup,
} from "./generate";
import { CAGED_SHAPES, SCALE_IDS, SCALES, pitchClass, scalePitchClasses } from "./theory";

const GUITAR: Setup = {
  tuning: [64, 59, 55, 50, 45, 40],
  instrument: "guitar",
  name: "Guitar",
  bpm: 80,
};
const BASS: Setup = { tuning: [43, 38, 33, 28], instrument: "bass-guitar", name: "Bass", bpm: 80 };
const BASS5: Setup = { ...BASS, tuning: [43, 38, 33, 28, 23] };
const GUITAR7: Setup = { ...GUITAR, tuning: [64, 59, 55, 50, 45, 40, 35] };
const DROP_D: Setup = { ...GUITAR, tuning: [64, 59, 55, 50, 45, 38] };
const SETUPS = [GUITAR, BASS, BASS5, GUITAR7, DROP_D];

/** The notes of the exercise in playing order, as sounding pitches with their spots. */
function played(setup: Setup, spec: ExerciseSpec) {
  const { document } = generateExercise(setup, spec);
  const track = document.tracks[0];
  return track.bars.flatMap((bar, index) =>
    bar.voices[0].beats.map((beat) => ({
      bar: index,
      beat,
      notes: beat.notes.map((note) => ({
        ...note,
        pitch: track.tuning_midi[note.string] + note.fret,
      })),
    })),
  );
}

function pitches(setup: Setup, spec: ExerciseSpec): number[] {
  return played(setup, spec).flatMap((entry) => entry.notes.map((note) => note.pitch));
}

function scaleSpec(over: Partial<Extract<ExerciseSpec, { kind: "scale" }>> = {}): ExerciseSpec {
  return {
    kind: "scale",
    root: 9,
    scale: "minor",
    position: { type: "fret", fret: 5 },
    range: "position",
    direction: "up",
    rhythm: "eighth",
    ...over,
  };
}

function checkDocument(setup: Setup, spec: ExerciseSpec) {
  const { document } = generateExercise(setup, spec);
  const track = document.tracks[0];
  expect(track.bars).toHaveLength(document.bars.length);
  expect(track.tuning_midi).toEqual(setup.tuning);
  document.bars.forEach((bar, index) => {
    const length = (4 * 960 * bar.signature[0]) / bar.signature[1];
    const beats = track.bars[index].voices[0].beats;
    let cursor = 0;
    for (const beat of beats) {
      expect(beat.position).toBe(cursor);
      cursor += beat.duration;
      for (const note of beat.notes) {
        expect(note.string).toBeGreaterThanOrEqual(0);
        expect(note.string).toBeLessThan(setup.tuning.length);
        expect(note.fret).toBeGreaterThanOrEqual(0);
        expect(note.fret).toBeLessThanOrEqual(99);
      }
    }
    expect(cursor).toBeLessThanOrEqual(length);
    // Only the last bar may stop short; the rest are full.
    if (index < document.bars.length - 1) expect(cursor).toBe(length);
  });
  return document;
}

describe("scales", () => {
  it("uses only the degrees of the scale in every key, mode and tuning", () => {
    for (const setup of SETUPS) {
      for (const scale of SCALE_IDS) {
        for (const root of [0, 3, 6, 9, 11]) {
          const allowed = new Set(scalePitchClasses(root, scale));
          const list = pitches(
            setup,
            scaleSpec({ root, scale, position: { type: "caged", shape: "E" } }),
          );
          expect(list.length).toBeGreaterThan(2);
          for (const pitch of list) expect(allowed.has(pitchClass(pitch))).toBe(true);
        }
      }
    }
  });

  it("plays every degree of a seven-note scale in order from the tonic", () => {
    const list = pitches(
      GUITAR,
      scaleSpec({
        root: 0,
        scale: "major",
        position: { type: "caged", shape: "C" },
        range: "octave",
      }),
    );
    expect(list.map((pitch) => pitchClass(pitch))).toEqual([0, 2, 4, 5, 7, 9, 11, 0]);
    expect(list[0]).toBe(48);
    expect(list.at(-1)).toBe(60);
  });

  it("builds A minor from the fifth fret and C major from the nut", () => {
    const minor = pitches(GUITAR, scaleSpec());
    expect(minor.slice(0, 5)).toEqual([45, 47, 48, 50, 52]);
    const major = played(
      GUITAR,
      scaleSpec({ root: 0, scale: "major", position: { type: "fret", fret: 0 } }),
    );
    expect(major[0].notes[0]).toMatchObject({ string: 5, fret: 0 });
  });

  it("keeps every position inside a five-fret span", () => {
    for (const setup of SETUPS) {
      for (const shape of CAGED_SHAPES) {
        for (const scale of ["major", "minor", "minorPentatonic", "blues", "dorian"]) {
          for (let root = 0; root < 12; root++) {
            const list = played(
              setup,
              scaleSpec({ root, scale, position: { type: "caged", shape } }),
            );
            const frets = list
              .flatMap((entry) => entry.notes.map((note) => note.fret))
              .filter(Boolean);
            expect(Math.max(...frets) - Math.min(...frets)).toBeLessThanOrEqual(4);
          }
        }
      }
    }
  });

  it("ascends, descends, or does both", () => {
    const up = pitches(GUITAR, scaleSpec({ direction: "up" }));
    const down = pitches(GUITAR, scaleSpec({ direction: "down" }));
    const both = pitches(GUITAR, scaleSpec({ direction: "both" }));
    expect([...up].sort((a, b) => a - b)).toEqual(up);
    expect(down).toEqual([...up].reverse());
    expect(both).toEqual([...up, ...[...up].reverse().slice(1)]);
  });

  it("limits the range to one or two octaves from the tonic", () => {
    const one = pitches(
      GUITAR,
      scaleSpec({ range: "octave", position: { type: "caged", shape: "E" } }),
    );
    const two = pitches(
      GUITAR,
      scaleSpec({ range: "twoOctaves", position: { type: "caged", shape: "E" } }),
    );
    expect(pitchClass(one[0])).toBe(9);
    expect(one.at(-1)! - one[0]).toBeLessThanOrEqual(12);
    expect(two.at(-1)! - two[0]).toBeLessThanOrEqual(24);
    expect(two.length).toBeGreaterThan(one.length);
  });

  it("sets the rhythm: eighths, triplets and sixteenths", () => {
    expect(played(GUITAR, scaleSpec({ rhythm: "quarter" }))[0].beat.duration).toBe(960);
    expect(played(GUITAR, scaleSpec({ rhythm: "eighth" }))[0].beat.duration).toBe(480);
    const triplet = played(GUITAR, scaleSpec({ rhythm: "triplet" }))[0].beat;
    expect(triplet.duration).toBe(320);
    expect(triplet.tuplet).toBe(3);
    expect(played(GUITAR, scaleSpec({ rhythm: "sixteenth" }))[0].beat.duration).toBe(240);
  });

  it("makes valid, fully written bars", () => {
    for (const setup of SETUPS) {
      for (const rhythm of ["quarter", "eighth", "triplet", "sixteenth"] as const) {
        checkDocument(setup, scaleSpec({ rhythm, direction: "both" }));
      }
    }
  });

  it("reports a scale it does not know", () => {
    expect(() => generateExercise(GUITAR, scaleSpec({ scale: "nope" }))).toThrow(ExerciseError);
  });

  it("has a CAGED window for every shape that climbs the neck for C major", () => {
    const starts = CAGED_SHAPES.map((shape) =>
      windowStart(GUITAR.tuning, { type: "caged", shape }, 0),
    );
    expect(starts).toEqual([0, 2, 5, 7, 9]);
    expect(windowStart(GUITAR.tuning, { type: "auto" }, 4)).toBe(0);
    expect(windowStart(GUITAR.tuning, { type: "fret", fret: 99 }, 0)).toBe(18);
  });

  it("a mode sits in the shape of its parent major scale", () => {
    const dorian = windowStart(
      GUITAR.tuning,
      { type: "caged", shape: "A" },
      pitchClass(2 + SCALES.dorian.parent),
    );
    const major = windowStart(GUITAR.tuning, { type: "caged", shape: "A" }, 0);
    expect(dorian).toBe(major);
  });
});

describe("arpeggios", () => {
  it("plays only chord tones, root first, within a five-fret span", () => {
    for (const setup of SETUPS) {
      for (const chord of ["C", "Am", "G7", "Dm7", "Bm7b5", "F#dim", "Cmaj7", "Esus4"]) {
        const parsed = parseChord(chord)!;
        const tones = new Set([...parsed.required, ...parsed.optional]);
        const entries = played(setup, {
          kind: "arpeggio",
          chord,
          position: { type: "caged", shape: "A" },
          range: "octave",
          direction: "up",
          rhythm: "eighth",
        });
        const list = entries.flatMap((entry) => entry.notes);
        expect(pitchClass(list[0].pitch)).toBe(parsed.root);
        for (const note of list) expect(tones.has(pitchClass(note.pitch))).toBe(true);
        const frets = list.map((note) => note.fret).filter(Boolean);
        expect(Math.max(...frets) - Math.min(...frets)).toBeLessThanOrEqual(4);
      }
    }
  });

  it("rejects text that is not a chord", () => {
    expect(() =>
      generateExercise(GUITAR, {
        kind: "arpeggio",
        chord: "H",
        position: { type: "auto" },
        range: "octave",
        direction: "up",
        rhythm: "eighth",
      }),
    ).toThrow(ExerciseError);
  });
});

describe("spider and chromatic drills", () => {
  const spider = (over: object = {}): ExerciseSpec => ({
    kind: "spider",
    startFret: 5,
    pattern: "1234",
    direction: "up",
    shifts: 0,
    rhythm: "sixteenth",
    ...over,
  });

  it("walks four consecutive frets on every string, low to high", () => {
    const list = played(GUITAR, spider()).flatMap((entry) => entry.notes);
    expect(list).toHaveLength(24);
    expect(list.slice(0, 4).map((note) => [note.string, note.fret])).toEqual([
      [5, 5],
      [5, 6],
      [5, 7],
      [5, 8],
    ]);
    expect(list.slice(-4).map((note) => note.string)).toEqual([0, 0, 0, 0]);
    expect(list.slice(0, 4).map((note) => note.pitch)).toEqual([45, 46, 47, 48]);
  });

  it("follows other finger orders and runs down the strings", () => {
    const list = played(BASS, spider({ pattern: "1324", direction: "down" })).flatMap(
      (entry) => entry.notes,
    );
    expect(list.slice(0, 4).map((note) => note.fret)).toEqual([5, 7, 6, 8]);
    expect(list[0].string).toBe(0);
    expect(list[4].string).toBe(1);
  });

  it("shifts up a fret on each repeat", () => {
    const list = played(BASS, spider({ shifts: 2 })).flatMap((entry) => entry.notes);
    expect(list).toHaveLength(4 * 4 * 3);
    expect(list[16].fret).toBe(6);
    expect(list[32].fret).toBe(7);
  });

  it("refuses a bad pattern or one that runs off the neck", () => {
    expect(() => generateExercise(GUITAR, spider({ pattern: "15" }))).toThrow(ExerciseError);
    expect(() => generateExercise(GUITAR, spider({ startFret: 21, shifts: 3 }))).toThrow(
      ExerciseError,
    );
  });

  it("is valid for every tuning", () => {
    for (const setup of SETUPS) checkDocument(setup, spider({ shifts: 1 }));
  });
});

describe("chord changes and strumming", () => {
  const changes = (over: object = {}): ExerciseSpec => ({
    kind: "changes",
    chords: ["G", "C", "D"],
    beatsEach: 4,
    strum: "quarters",
    cycles: 1,
    ...over,
  });

  it("strums each chord for the beats asked", () => {
    const entries = played(GUITAR, changes({ beatsEach: 2 }));
    // Two beats of down-strums that each ring a quarter note.
    expect(entries).toHaveLength(3 * 2);
    expect(entries.every((entry) => entry.beat.duration === 960)).toBe(true);
    const bar = checkDocument(GUITAR, changes({ beatsEach: 2 })).bars.length;
    expect(bar).toBe(2);
  });

  it("voices real chords: every note belongs to the chord and the root is lowest", () => {
    for (const name of ["G", "C", "D", "Em", "Am", "F", "A7"]) {
      const parsed = parseChord(name)!;
      const tones = new Set([...parsed.required, ...parsed.optional]);
      const spots = chordSpots(GUITAR.tuning, name);
      const sounding = spots.map((spot) => GUITAR.tuning[spot.string] + spot.fret);
      for (const pitch of sounding) expect(tones.has(pitchClass(pitch))).toBe(true);
      expect(pitchClass(Math.min(...sounding))).toBe(parsed.root);
      const frets = spots.map((spot) => spot.fret).filter(Boolean);
      if (frets.length) expect(Math.max(...frets) - Math.min(...frets)).toBeLessThanOrEqual(4);
    }
  });

  it("plays a strumming pattern, with up-strokes on the top strings only", () => {
    const entries = played(GUITAR, changes({ chords: ["Am", "C"], strum: "folk", beatsEach: 4 }));
    const first = entries.slice(0, 4);
    expect(first.map((entry) => entry.beat.duration)).toEqual([960, 480, 480 * 2, 480]);
    expect(first.map((entry) => entry.beat.extras?.strum)).toEqual(["down", "down", "up", "up"]);
    expect(entries[2].notes.length).toBeLessThanOrEqual(3);
    expect(entries[0].notes.length).toBeGreaterThan(3);
  });

  it("repeats the progression for each cycle", () => {
    const one = checkDocument(GUITAR, changes()).bars.length;
    const three = checkDocument(GUITAR, changes({ cycles: 3 })).bars.length;
    expect(three).toBe(one * 3);
  });

  it("ties a sustained strum across a bar line", () => {
    const entries = played(GUITAR, changes({ chords: ["G", "C"], beatsEach: 3, strum: "ballad" }));
    const tied = entries.filter((entry) => entry.notes.some((note) => note.tie));
    expect(tied.length).toBeGreaterThan(0);
    checkDocument(GUITAR, changes({ chords: ["G", "C"], beatsEach: 3, strum: "ballad" }));
  });

  it("needs two to four chords it can voice", () => {
    expect(() => generateExercise(GUITAR, changes({ chords: ["G"] }))).toThrow(ExerciseError);
    expect(() => generateExercise(GUITAR, changes({ chords: ["G", "C", "D", "A", "E"] }))).toThrow(
      ExerciseError,
    );
    expect(() => generateExercise(GUITAR, changes({ chords: ["G", "nope"] }))).toThrow(
      ExerciseError,
    );
    expect(() => generateExercise(GUITAR, changes({ strum: "nope" }))).toThrow(ExerciseError);
  });

  it("is valid on guitar, including 7 strings and drop D", () => {
    for (const setup of [GUITAR, GUITAR7, DROP_D]) checkDocument(setup, changes({ strum: "pop" }));
  });
});

describe("bass patterns", () => {
  const bass = (
    pattern: "rootFifthOctave" | "walking",
    chords = ["C", "G", "Am", "F"],
  ): ExerciseSpec => ({
    kind: "bass",
    chords,
    pattern,
    cycles: 1,
  });

  it("plays root, fifth, octave, fifth over each chord", () => {
    for (const setup of [BASS, BASS5, GUITAR]) {
      const list = pitches(setup, bass("rootFifthOctave"));
      expect(list).toHaveLength(16);
      for (let bar = 0; bar < 4; bar++) {
        const [root, fifth, octave, again] = list.slice(bar * 4, bar * 4 + 4);
        expect([fifth - root, octave - root, again - root]).toEqual([7, 12, 7]);
      }
      expect(list.map((pitch) => pitchClass(pitch)).filter((_, index) => index % 4 === 0)).toEqual([
        0, 7, 9, 5,
      ]);
      expect(Math.min(...list)).toBeGreaterThanOrEqual(Math.min(...setup.tuning));
    }
  });

  it("keeps the roots in the lowest octave of the instrument", () => {
    const list = pitches(BASS, bass("rootFifthOctave"));
    const roots = list.filter((_, index) => index % 4 === 0);
    for (const root of roots) {
      expect(root).toBeGreaterThanOrEqual(28);
      expect(root).toBeLessThan(40);
    }
  });

  it("walks root, third, fifth, then a half step to the next root", () => {
    const list = pitches(BASS, bass("walking", ["E7", "A7", "Em", "B7"]));
    const bars = [0, 1, 2, 3].map((bar) => list.slice(bar * 4, bar * 4 + 4));
    expect(bars[0].slice(1, 3).map((pitch) => pitch - bars[0][0])).toEqual([4, 7]);
    // E minor takes the minor third.
    expect(bars[2][1] - bars[2][0]).toBe(3);
    bars.forEach((bar, index) => {
      const nextRoot = bars[(index + 1) % 4][0];
      expect(Math.abs(bar[3] - nextRoot)).toBe(1);
    });
  });

  it("fingers the line close together", () => {
    const entries = played(BASS, bass("walking", ["E7", "A7", "B7"]));
    const frets = entries.flatMap((entry) => entry.notes.map((note) => note.fret));
    for (let index = 1; index < frets.length; index++) {
      expect(Math.abs(frets[index] - frets[index - 1])).toBeLessThanOrEqual(7);
    }
  });

  it("is valid for every tuning and rejects bad chords", () => {
    for (const setup of SETUPS) checkDocument(setup, bass("walking"));
    expect(() => generateExercise(BASS, bass("walking", ["C", "zz"]))).toThrow(ExerciseError);
    expect(() => generateExercise(BASS, bass("walking", []))).toThrow(ExerciseError);
  });
});

describe("helpers", () => {
  it("places pitches near the previous one and rejects out-of-range pitches", () => {
    const spots = placePitches(BASS.tuning, [28, 35, 40]);
    expect(spots.map((spot) => BASS.tuning[spot.string] + spot.fret)).toEqual([28, 35, 40]);
    expect(() => placePitches(BASS.tuning, [10])).toThrow(ExerciseError);
  });

  it("splits an event that crosses the bar line into tied beats", () => {
    const bars = layout([
      { notes: [{ string: 0, fret: 1 }], ticks: 3840 - 480 },
      { notes: [{ string: 0, fret: 2 }], ticks: 960 },
    ]);
    expect(bars).toHaveLength(2);
    expect(bars[0].at(-1)!.duration).toBe(480);
    expect(bars[1][0].notes[0].tie).toBe(true);
    expect(bars[1][0].position).toBe(0);
  });

  it("starts a triplet that does not fit on a new bar", () => {
    const bars = layout([
      { notes: [], ticks: 3840 - 100 },
      { notes: [{ string: 0, fret: 1 }], ticks: 320, tuplet: 3 },
    ]);
    expect(bars).toHaveLength(2);
    expect(bars[1][0].tuplet).toBe(3);
  });
});

describe("preset drills", () => {
  it("all generate a valid document on a fitting instrument", () => {
    for (const preset of PRESET_DRILLS) {
      for (const setup of preset.family === "guitar"
        ? [GUITAR]
        : preset.family === "bass"
          ? [BASS]
          : [GUITAR, BASS]) {
        const document = checkDocument(setup, preset.spec);
        expect(document.tracks[0].bars.length).toBeGreaterThan(0);
      }
    }
  });

  it("have unique ids", () => {
    expect(new Set(PRESET_DRILLS.map((preset) => preset.id)).size).toBe(PRESET_DRILLS.length);
  });

  it("title with the scale's translated name", () => {
    const { label } = generateExercise(GUITAR, scaleSpec());
    const text = labelText(label, (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key));
    expect(text).toContain('"scale":"exercises.scales.minor"');
    expect(text.startsWith("exercises.title.scale:")).toBe(true);
  });
});
