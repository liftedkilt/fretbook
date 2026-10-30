import { renderNotes, type Instrument } from "./synth";
import type { TruthNote } from "./evaluate";

export interface Scenario {
  name: string;
  instrument: Instrument;
  notes: TruthNote[];
  seconds: number;
  noiseFloor?: number;
  fundamentalGain?: number;
  /** A second voice mixed under the notes (speaker bleed). Not part of the truth. */
  bleed?: TruthNote[];
  /**
   * The onset bars in accuracy.test.ts are not met yet. Those checks are written as `it.fails`, so
   * they turn red when the fix lands and this marker has to be removed. Names the issue that
   * closes it. Pitch bars still apply in full.
   */
  pending?: string;
}

function line(
  midis: number[],
  step: number,
  duration: number,
  lead = 0.3,
  legato = false,
): TruthNote[] {
  return midis.map((midi, i) => ({
    midi,
    start: lead + i * step,
    duration,
    legato: legato && i > 0 ? true : undefined,
  }));
}

function range(from: number, to: number, by: number): number[] {
  const out: number[] = [];
  for (let m = from; m <= to; m += by) out.push(m);
  return out;
}

const total = (notes: TruthNote[], tail = 0.5) => {
  const last = notes[notes.length - 1];
  return last.start + last.duration + tail;
};

/** B0 (5-string low B) up to G3, a semitone at a time in the bottom octave. */
const bassRange = line([...range(23, 35, 1), ...range(37, 55, 3)], 0.9, 0.8);
/** Standard-tuning guitar from E2 to the 24th fret of the high E (E6). */
const guitarRange = line(range(40, 88, 3), 0.7, 0.6);
const repeatedBass = line([28, 28, 28, 28, 28, 28, 33, 33, 33, 33], 0.3, 0.28);
const repeatedGuitar = line([64, 64, 64, 64, 59, 59, 59, 59], 0.25, 0.23);
const legatoBass = [
  ...line([28], 0.5, 0.5),
  ...line([30, 28, 31, 28], 0.3, 0.3, 0.8, true),
  ...line([35, 33], 0.5, 0.45, 2.1),
];
const legatoGuitar = [
  ...line([64], 0.5, 0.5),
  ...line([66, 64, 67, 64], 0.25, 0.25, 0.8, true),
  ...line([71, 69], 0.5, 0.45, 1.9),
];

/** Drop A (MIDI 21, 27.5 Hz) and low B on a 5-string, below the old 28 Hz search floor. */
export const dropAScenario: Scenario = (() => {
  const notes = line([21, 23, 26, 21, 28], 1, 0.9);
  return { name: "bass drop A and low B", instrument: "bass", notes, seconds: total(notes) };
})();

/** Low bass with a fundamental about a twentieth of the second harmonic (`mpm.test.ts` uses an eighth). */
const weakFundamental = line([23, 25, 28, 30, 33, 35, 38], 0.8, 0.7);
/** The same pitch plucked hard, then softly while it still rings. */
const softRepluck = [
  ...line([28], 0.5, 0.5),
  ...[0.9, 1.5, 2.1].map((start) => ({ midi: 28, start, duration: 0.5, velocity: 0.04 })),
  ...[2.7, 3.2, 3.7].map((start) => ({ midi: 40, start, duration: 0.45, velocity: 0.04 })),
];
const bleedNotes = line([28, 31, 33, 35, 38], 0.7, 0.6);
/** A quiet backing note a fourth above, ringing across the played notes. */
const bleedVoice: TruthNote[] = [
  { midi: 43, start: 0.25, duration: 1.7, velocity: 0.3 },
  { midi: 45, start: 2.0, duration: 1.7, velocity: 0.3 },
];

export const SCENARIOS: Scenario[] = [
  { name: "bass range B0-G3", instrument: "bass", notes: bassRange, seconds: total(bassRange) },
  {
    name: "guitar range E2-E6",
    instrument: "guitar",
    notes: guitarRange,
    seconds: total(guitarRange),
  },
  {
    name: "bass repeated notes",
    instrument: "bass",
    notes: repeatedBass,
    seconds: total(repeatedBass),
  },
  {
    name: "guitar repeated notes",
    instrument: "guitar",
    notes: repeatedGuitar,
    seconds: total(repeatedGuitar),
  },
  { name: "bass legato line", instrument: "bass", notes: legatoBass, seconds: total(legatoBass) },
  {
    name: "guitar legato line",
    instrument: "guitar",
    notes: legatoGuitar,
    seconds: total(legatoGuitar),
  },
  {
    name: "bass with background noise",
    instrument: "bass",
    notes: line([28, 31, 33, 35, 38, 40], 0.6, 0.5),
    seconds: 4.2,
    noiseFloor: 0.004,
  },
  dropAScenario,

  {
    name: "bass weak fundamental, unguided",
    instrument: "bass",
    notes: weakFundamental,
    seconds: total(weakFundamental),
    fundamentalGain: 0.1,
  },
  {
    name: "bass soft repluck",
    instrument: "bass",
    notes: softRepluck,
    seconds: total(softRepluck),
  },
  {
    name: "bass with quiet second voice",
    instrument: "bass",
    notes: bleedNotes,
    seconds: total(bleedNotes),
    bleed: bleedVoice,
    pending: "#409: the backing note's attack is reported as an onset of the played line",
  },
];

export function renderScenario(scenario: Scenario, sampleRate: number, seed = 7): Float32Array {
  const options = {
    sampleRate,
    instrument: scenario.instrument,
    seed,
    fundamentalGain: scenario.fundamentalGain,
  };
  const played = renderNotes(scenario.notes, scenario.seconds, {
    ...options,
    noiseFloor: scenario.noiseFloor,
  });
  if (!scenario.bleed) return played;
  const bleed = renderNotes(scenario.bleed, scenario.seconds, { ...options, seed: seed + 1 });
  return played.map((v, i) => v + bleed[i]);
}

/** Small WAV fixtures committed under `fixtures/`, written by `scripts/make-listen-fixtures.ts`. */
export const FIXTURE_SAMPLE_RATE = 22050;

const bassRiff = [
  ...line([23, 28, 33, 38], 0.6, 0.55),
  ...line([28, 28, 28, 28], 0.25, 0.24, 2.8),
  ...line([31, 33, 31, 29], 0.3, 0.3, 3.9, true),
  ...line([40, 36], 0.5, 0.45, 5.2),
];
const guitarRiff = [
  ...line([40, 47, 52, 59, 64], 0.5, 0.45),
  ...line([64, 64, 64, 64], 0.25, 0.24, 2.7),
  ...line([67, 69, 67, 65], 0.25, 0.25, 3.8, true),
  ...line([76, 83], 0.5, 0.45, 4.9),
];

export const FIXTURES: Scenario[] = [
  {
    name: "bass-riff",
    instrument: "bass",
    notes: bassRiff,
    seconds: total(bassRiff),
    noiseFloor: 0.002,
  },
  {
    name: "guitar-riff",
    instrument: "guitar",
    notes: guitarRiff,
    seconds: total(guitarRiff),
    noiseFloor: 0.002,
  },
];
