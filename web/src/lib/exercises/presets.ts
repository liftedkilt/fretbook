import type { ExerciseSpec, Generated } from "./generate";

export interface PresetDrill {
  id: string;
  bpm: number;
  /** Which instruments make sense: a bass line is not offered on guitar, and chord strums are not on bass. */
  family: "bass" | "guitar" | "any";
  spec: ExerciseSpec;
}

const PENTATONIC_BOX: ExerciseSpec = {
  kind: "scale",
  root: 9,
  scale: "minorPentatonic",
  position: { type: "fret", fret: 5 },
  range: "position",
  direction: "both",
  rhythm: "eighth",
};

/** Ready-made drills. Each one's title and description live under `exercises.presets.<id>`. */
export const PRESET_DRILLS: PresetDrill[] = [
  { id: "pentatonicBox", bpm: 80, family: "any", spec: PENTATONIC_BOX },
  {
    id: "majorOctave",
    bpm: 70,
    family: "any",
    spec: {
      kind: "scale",
      root: 0,
      scale: "major",
      position: { type: "caged", shape: "C" },
      range: "octave",
      direction: "both",
      rhythm: "eighth",
    },
  },
  {
    id: "dorianTriplets",
    bpm: 60,
    family: "any",
    spec: {
      kind: "scale",
      root: 2,
      scale: "dorian",
      position: { type: "auto" },
      range: "twoOctaves",
      direction: "both",
      rhythm: "triplet",
    },
  },
  {
    id: "minorSeventhArpeggio",
    bpm: 70,
    family: "any",
    spec: {
      kind: "arpeggio",
      chord: "Am7",
      position: { type: "caged", shape: "E" },
      range: "twoOctaves",
      direction: "both",
      rhythm: "eighth",
    },
  },
  {
    id: "spiderWarmUp",
    bpm: 60,
    family: "any",
    spec: {
      kind: "spider",
      startFret: 5,
      pattern: "1234",
      direction: "up",
      shifts: 0,
      rhythm: "sixteenth",
    },
  },
  {
    id: "spiderCrawl",
    bpm: 70,
    family: "any",
    spec: {
      kind: "spider",
      startFret: 1,
      pattern: "1324",
      direction: "up",
      shifts: 4,
      rhythm: "sixteenth",
    },
  },
  {
    id: "openChordChanges",
    bpm: 70,
    family: "guitar",
    spec: {
      kind: "changes",
      chords: ["G", "C", "D", "Em"],
      beatsEach: 4,
      strum: "quarters",
      cycles: 2,
    },
  },
  {
    id: "folkStrum",
    bpm: 90,
    family: "guitar",
    spec: {
      kind: "changes",
      chords: ["Am", "F", "C", "G"],
      beatsEach: 4,
      strum: "folk",
      cycles: 2,
    },
  },
  {
    id: "rootFifthOctave",
    bpm: 90,
    family: "any",
    spec: { kind: "bass", chords: ["C", "G", "Am", "F"], pattern: "rootFifthOctave", cycles: 2 },
  },
  {
    id: "walkingBlues",
    bpm: 110,
    family: "any",
    spec: { kind: "bass", chords: ["E7", "A7", "E7", "B7"], pattern: "walking", cycles: 2 },
  },
];

export function presetById(id: string): PresetDrill | undefined {
  return PRESET_DRILLS.find((preset) => preset.id === id);
}

/** A generated title, with scale names translated by `translate`. */
export function labelText(
  label: Generated["label"],
  translate: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const params = { ...label.params };
  if (typeof params.scale === "string")
    params.scale = translate(`exercises.scales.${params.scale}`);
  return translate(label.key, params);
}
