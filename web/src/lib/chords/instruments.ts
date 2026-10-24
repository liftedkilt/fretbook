import { INSTRUMENTS } from "../tuner";
import { physicalTuning } from "./voicings";

/** The instruments and tunings the chord diagrams cover, taken from the tuner's list. */

export interface ChordTuning {
  id: string;
  labelKey: string;
  /** Open-string MIDI notes, lowest string first (the diagram's order). */
  strings: number[];
}

export interface ChordInstrument {
  id: string;
  labelKey: string;
  /** The lowest sounding note has to be the root. Ukulele chords are often inversions. */
  rootInBass: boolean;
  tunings: ChordTuning[];
}

const COVERED: Record<string, boolean> = { guitar6: true, ukulele: false, bass4: true };

export const CHORD_INSTRUMENTS: ChordInstrument[] = INSTRUMENTS.filter(
  (instrument) => instrument.id in COVERED,
).map((instrument) => ({
  id: instrument.id,
  labelKey: instrument.labelKey,
  rootInBass: COVERED[instrument.id],
  tunings: instrument.tunings
    .filter((tuning) => tuning.midi.length > 0)
    .map((tuning) => ({
      id: tuning.id,
      labelKey: tuning.labelKey,
      strings: physicalTuning(tuning.midi),
    })),
}));

export interface ChordSetup {
  instrument: ChordInstrument;
  tuning: ChordTuning;
}

/** Resolve stored ids to a known instrument and tuning, falling back to guitar in standard. */
export function resolveSetup(instrumentId?: string, tuningId?: string): ChordSetup {
  const instrument =
    CHORD_INSTRUMENTS.find((item) => item.id === instrumentId) ?? CHORD_INSTRUMENTS[0];
  const tuning = instrument.tunings.find((item) => item.id === tuningId) ?? instrument.tunings[0];
  return { instrument, tuning };
}
