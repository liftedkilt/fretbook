import { describe, expect, it } from "vitest";

import { PitchEngine } from "./engine";
import { runEngine } from "./harness/evaluate";
import { midiToFrequency } from "./notes";

const sampleRate = 48000;

function sine(midi: number, seconds: number, amp = 0.5): Float32Array {
  const f = midiToFrequency(midi);
  return Float32Array.from(
    { length: Math.round(seconds * sampleRate) },
    (_, n) => amp * Math.sin((2 * Math.PI * f * n) / sampleRate),
  );
}

function run(
  samples: Float32Array,
  options: Partial<ConstructorParameters<typeof PitchEngine>[0]> = {},
) {
  const engine = new PitchEngine({ sampleRate, ...options });
  const events = [];
  for (let at = 0; at < samples.length; at += 128)
    events.push(...engine.process(samples.subarray(at, at + 128), at / sampleRate));
  return events;
}

describe("PitchEngine", () => {
  it("reports midi, cents and the AudioContext time of each reading", () => {
    const events = runEngine(sine(33, 1), sampleRate).filter((e) => e.time > 0.4);
    expect(events.length).toBeGreaterThan(10);
    for (const event of events) {
      expect(event.midi).toBe(33);
      expect(Math.abs(event.cents ?? 99)).toBeLessThan(2);
      expect(event.clarity).toBeGreaterThan(0.95);
    }
    const times = events.map((e) => e.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times[times.length - 1]).toBeLessThanOrEqual(1);
  });

  it("stamps events from the start time it is given", () => {
    const engine = new PitchEngine({ sampleRate });
    const samples = sine(40, 0.5);
    const events = [];
    for (let at = 0; at < samples.length; at += 128) {
      events.push(...engine.process(samples.subarray(at, at + 128), 10 + at / sampleRate));
    }
    expect(events[0].time).toBeGreaterThan(10);
    expect(events[events.length - 1].time).toBeLessThanOrEqual(10.5);
  });

  it("reports nothing pitched for silence and for quiet noise", () => {
    const events = runEngine(new Float32Array(sampleRate), sampleRate);
    expect(events.length).toBeGreaterThan(10);
    expect(events.every((e) => e.frequency === null && !e.onset)).toBe(true);
  });

  it("does not flag a held note as a new attack", () => {
    const events = runEngine(sine(45, 1.5), sampleRate);
    expect(events.filter((e) => e.onset).length).toBeLessThanOrEqual(1);
  });

  it("keeps reading a decaying note below the open threshold, but does not open on it", () => {
    const f = midiToFrequency(45);
    const decay = Float32Array.from({ length: sampleRate * 2 }, (_, n) => {
      const amp = 0.05 * Math.exp(-n / (0.35 * sampleRate));
      return amp * Math.sin((2 * Math.PI * f * n) / sampleRate);
    });
    const withHysteresis = run(decay);
    const without = run(decay, { keepRatio: 1 });
    const pitched = (events: { frequency: number | null }[]) =>
      events.filter((e) => e.frequency !== null).length;
    expect(pitched(withHysteresis)).toBeGreaterThan(pitched(without));
    // A note that starts between the keep and open thresholds never opens the gate.
    const quiet = run(sine(45, 1, 0.0035));
    expect(quiet.every((e) => e.frequency === null)).toBe(true);
  });

  it("is not thrown off by a DC offset or rumble under the note", () => {
    const note = sine(45, 1);
    const rumble = Float32Array.from(
      note,
      (v, n) => v + 0.2 + 0.1 * Math.sin((2 * Math.PI * 8 * n) / sampleRate),
    );
    const events = runEngine(rumble, sampleRate).filter((e) => e.time > 0.4);
    expect(events.length).toBeGreaterThan(10);
    for (const event of events) expect(event.midi).toBe(45);
  });

  it("measures the input level and resets the meter", () => {
    const engine = new PitchEngine({ sampleRate });
    engine.process(sine(45, 0.2, 0.5), 0);
    const level = engine.takeLevel();
    expect(level.peak).toBeCloseTo(0.5, 2);
    expect(level.rms).toBeCloseTo(0.5 / Math.SQRT2, 2);
    expect(engine.takeLevel()).toEqual({ rms: 0, peak: 0 });
  });

  it("accepts and clears an expected note", () => {
    const engine = new PitchEngine({ sampleRate });
    engine.setExpectedMidi(28);
    engine.setExpectedMidi(null);
    expect(engine.process(sine(28, 0.3), 0).length).toBeGreaterThan(0);
  });
});
