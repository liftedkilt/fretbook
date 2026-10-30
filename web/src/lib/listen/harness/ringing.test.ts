import { describe, expect, it } from "vitest";

import { evaluate, runEngine, type TruthNote } from "./evaluate";
import { renderNotes } from "./synth";

// A repluck under about a quarter of the loud note's level still hides in the ring.
describe("soft repluck while the string still rings", () => {
  const sampleRate = 48000;
  const loud: TruthNote = { midi: 28, start: 0.3, duration: 2.2, velocity: 0.9 };
  const replucks: TruthNote[] = [1.0, 1.6].map((start) => ({
    midi: 28,
    start,
    duration: 0.5,
    velocity: 0.3,
  }));

  it("finds the replucks without moving the first attack", () => {
    const notes = [loud, ...replucks];
    const samples = renderNotes(notes, 3, { sampleRate, instrument: "bass", seed: 7 });
    const report = evaluate(samples, notes, { sampleRate });
    expect(report.onsetRecall).toBeGreaterThanOrEqual(0.9);
    expect(report.falseOnsets).toBe(0);
    const first = runEngine(samples, sampleRate).find((e) => e.onsetTime !== null);
    expect(Math.abs((first?.onsetTime ?? 0) - 0.3)).toBeLessThan(0.03);
  });
});
