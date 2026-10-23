import { renderNotes, type Instrument } from "./synth";
import type { TruthNote } from "./evaluate";

export interface Scenario {
  name: string;
  instrument: Instrument;
  notes: TruthNote[];
  seconds: number;
  noiseFloor?: number;
}

function line(midis: number[], step: number, duration: number, lead = 0.3, legato = false): TruthNote[] {
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

export const SCENARIOS: Scenario[] = [
  { name: "bass range B0-G3", instrument: "bass", notes: bassRange, seconds: total(bassRange) },
  { name: "guitar range E2-E6", instrument: "guitar", notes: guitarRange, seconds: total(guitarRange) },
  { name: "bass repeated notes", instrument: "bass", notes: repeatedBass, seconds: total(repeatedBass) },
  { name: "guitar repeated notes", instrument: "guitar", notes: repeatedGuitar, seconds: total(repeatedGuitar) },
  { name: "bass legato line", instrument: "bass", notes: legatoBass, seconds: total(legatoBass) },
  { name: "guitar legato line", instrument: "guitar", notes: legatoGuitar, seconds: total(legatoGuitar) },
  {
    name: "bass with background noise",
    instrument: "bass",
    notes: line([28, 31, 33, 35, 38, 40], 0.6, 0.5),
    seconds: 4.2,
    noiseFloor: 0.004,
  },
];

export function renderScenario(scenario: Scenario, sampleRate: number, seed = 7): Float32Array {
  return renderNotes(scenario.notes, scenario.seconds, {
    sampleRate,
    instrument: scenario.instrument,
    seed,
    noiseFloor: scenario.noiseFloor,
  });
}
