import { describe, expect, it } from "vitest";

import { FFT } from "./fft";
import { MpmDetector, windowSizeFor } from "./mpm";
import { midiToFrequency } from "./notes";

function tone(frequency: number, sampleRate: number, length: number, harmonics: number[] = [1]) {
  const out = new Float32Array(length);
  harmonics.forEach((amp, i) => {
    for (let n = 0; n < length; n++) {
      out[n] += amp * Math.sin((2 * Math.PI * frequency * (i + 1) * n) / sampleRate);
    }
  });
  return out;
}

describe("windowSizeFor", () => {
  it("spans two periods of the lowest note", () => {
    expect(windowSizeFor(48000, 28)).toBe(4096);
    expect(windowSizeFor(44100, 28)).toBe(4096);
    expect(windowSizeFor(16000, 28)).toBe(2048);
    expect(windowSizeFor(48000, 200)).toBe(512);
  });
});

describe("FFT", () => {
  it("rejects sizes that are not powers of two", () => {
    expect(() => new FFT(100)).toThrow();
  });

  it("round-trips", () => {
    const fft = new FFT(16);
    const re = Float64Array.from({ length: 16 }, (_, i) => Math.sin(i) + i / 7);
    const original = Float64Array.from(re);
    const im = new Float64Array(16);
    fft.transform(re, im);
    fft.transform(re, im, true);
    for (let i = 0; i < 16; i++) expect(re[i] / 16).toBeCloseTo(original[i], 9);
  });
});

describe("MpmDetector", () => {
  const sampleRate = 48000;
  const size = windowSizeFor(sampleRate, 28);
  const detector = new MpmDetector({ sampleRate, windowSize: size });

  it("finds a pure tone to a fraction of a cent", () => {
    for (const midi of [23, 28, 40, 64, 88]) {
      const result = detector.detect(tone(midiToFrequency(midi), sampleRate, size));
      expect(result).not.toBeNull();
      expect(
        Math.abs(1200 * Math.log2((result?.frequency ?? 1) / midiToFrequency(midi))),
      ).toBeLessThan(1);
      expect(result?.clarity).toBeGreaterThan(0.98);
    }
  });

  it("returns null for silence and has low clarity for noise", () => {
    expect(detector.detect(new Float32Array(size))).toBeNull();
    const noise = Float32Array.from(
      { length: size },
      (_, i) => Math.sin(i * i * 0.37) * Math.cos(i * 12.9898),
    );
    const result = detector.detect(noise);
    expect(result === null || result.clarity < 0.7).toBe(true);
  });

  it("prefers the expected note when the second harmonic dominates", () => {
    // Weak fundamental, strong harmonics: a typical low-string trap.
    const f0 = midiToFrequency(28);
    const samples = tone(f0, sampleRate, size, [0.12, 1, 0.6, 0.3]);
    const plain = detector.detect(samples);
    const guided = detector.detect(samples, { expectedFrequency: f0 });
    expect(Math.abs(1200 * Math.log2((guided?.frequency ?? 1) / f0))).toBeLessThan(5);
    expect(plain).not.toBeNull();
  });
});
