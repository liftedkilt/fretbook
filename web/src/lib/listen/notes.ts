/** Pitch <-> note helpers shared by the detector, the tests and (later) the tuner and wait mode. */

export const DEFAULT_A4 = 440;

export function frequencyToMidiFloat(frequency: number, a4 = DEFAULT_A4): number {
  return 69 + 12 * Math.log2(frequency / a4);
}

export function midiToFrequency(midi: number, a4 = DEFAULT_A4): number {
  return a4 * 2 ** ((midi - 69) / 12);
}

/** Nearest note and how far off it is, in cents (-50..50). */
export function describePitch(frequency: number, a4 = DEFAULT_A4): { midi: number; cents: number } {
  const exact = frequencyToMidiFloat(frequency, a4);
  const midi = Math.round(exact);
  return { midi, cents: (exact - midi) * 100 };
}

/** Signed distance between two frequencies in cents. */
export function centsBetween(frequency: number, reference: number): number {
  return 1200 * Math.log2(frequency / reference);
}
