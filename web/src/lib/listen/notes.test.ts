import { describe, expect, it } from "vitest";

import { centsBetween, describePitch, frequencyToMidiFloat, midiToFrequency } from "./notes";

describe("notes", () => {
  it("maps frequencies to midi and back", () => {
    expect(midiToFrequency(69)).toBeCloseTo(440);
    expect(midiToFrequency(28)).toBeCloseTo(41.2, 1);
    expect(frequencyToMidiFloat(880)).toBeCloseTo(81);
    expect(midiToFrequency(57, 432)).toBeCloseTo(216);
  });

  it("reports the nearest note and cents", () => {
    const flat = describePitch(midiToFrequency(40) * 2 ** (-20 / 1200));
    expect(flat.midi).toBe(40);
    expect(flat.cents).toBeCloseTo(-20, 5);
    expect(centsBetween(880, 440)).toBeCloseTo(1200);
  });
});
