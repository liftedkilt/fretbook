import { describe, expect, it } from "vitest";

import { decodeWav, encodeWav } from "./harness/wav";

describe("wav", () => {
  it("round-trips 16-bit samples", () => {
    const samples = Float32Array.from([0, 0.5, -0.5, 0.999, -1]);
    const decoded = decodeWav(encodeWav(samples, 22050));
    expect(decoded.sampleRate).toBe(22050);
    expect(decoded.samples.length).toBe(5);
    samples.forEach((value, i) => expect(decoded.samples[i]).toBeCloseTo(value, 3));
  });

  it("rejects other files and formats", () => {
    expect(() => decodeWav(new Uint8Array(64))).toThrow("Not a WAV");
    const wav = encodeWav(new Float32Array(4), 8000);
    new DataView(wav.buffer).setUint16(34, 8, true);
    expect(() => decodeWav(wav)).toThrow("16-bit");
    expect(() => decodeWav(wav.subarray(0, 36))).toThrow();
  });
});
