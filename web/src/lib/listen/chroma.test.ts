import { describe, expect, it } from "vitest";

import { ChromaAnalyzer, chromaScore, chromaWindowSize } from "./chroma";
import { PitchEngine } from "./engine";
import { renderStrum } from "./harness/synth";
import { midiToFrequency } from "./notes";

const sampleRate = 48000;
const pcs = (midis: number[]) => [...new Set(midis.map((midi) => midi % 12))];

// Open-position guitar voicings, low string first.
export const C = [48, 52, 55, 60, 64];
export const AM = [45, 52, 57, 60, 64];
export const G = [43, 47, 50, 55, 59, 67];
export const D = [50, 57, 62, 66];

function sines(midis: number[], size: number): Float32Array {
  const out = new Float32Array(size);
  for (const midi of midis) {
    const f = midiToFrequency(midi);
    for (let i = 0; i < size; i++) out[i] += 0.2 * Math.sin((2 * Math.PI * f * i) / sampleRate);
  }
  return out;
}

describe("chromaWindowSize", () => {
  it("is a power of two covering at least 0.15 s", () => {
    for (const rate of [22050, 44100, 48000, 96000]) {
      const size = chromaWindowSize(rate);
      expect(Math.log2(size) % 1).toBe(0);
      expect(size / rate).toBeGreaterThanOrEqual(0.15);
    }
  });
});

describe("ChromaAnalyzer", () => {
  const analyzer = new ChromaAnalyzer({ sampleRate });

  it("puts the energy of pure tones on their pitch classes", () => {
    const bins = analyzer.analyse(sines([57, 61, 64], analyzer.size));
    const total = bins.reduce((a, b) => a + b, 0);
    const wanted = bins[9] + bins[1] + bins[4];
    expect(wanted / total).toBeGreaterThan(0.95);
  });

  it("reads silence as zeros", () => {
    expect(analyzer.analyse(new Float32Array(analyzer.size))).toEqual(new Array(12).fill(0));
  });
});

describe("chromaScore", () => {
  it("is 0 for silence and for no wanted notes", () => {
    expect(chromaScore(new Array(12).fill(0), [0, 4, 7])).toBe(0);
    expect(chromaScore([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [])).toBe(0);
  });

  it("is 1 for exactly the chord and treats pitch classes mod 12", () => {
    const bins = new Array(12).fill(0);
    for (const pc of [0, 4, 7]) bins[pc] = 1;
    expect(chromaScore(bins, [0, 4, 7])).toBeCloseTo(1);
    expect(chromaScore(bins, [12, 16, -5])).toBeCloseTo(1);
  });

  it("falls when a note is missing and further when energy is elsewhere", () => {
    const full = [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0];
    const missing = [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0];
    const elsewhere = [0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0];
    const wanted = [0, 4, 7];
    expect(chromaScore(full, wanted)).toBeGreaterThan(chromaScore(missing, wanted));
    expect(chromaScore(missing, wanted)).toBeGreaterThan(chromaScore(elsewhere, wanted));
  });
});

describe("chromaScore on a lone note", () => {
  const wanted = [0, 4, 7];
  const only = (...pcs: number[]) => {
    const bins = new Array(12).fill(0);
    for (const pc of pcs) bins[pc] = 1;
    return bins;
  };

  it("rejects the root alone, or any single chord tone", () => {
    const threshold = 0.6;
    for (const pc of wanted) expect(chromaScore(only(pc), wanted)).toBeLessThan(threshold);
  });

  it("still passes with one chord tone missing", () => {
    expect(chromaScore(only(0, 7), wanted)).toBeGreaterThanOrEqual(0.6);
    expect(chromaScore(only(0, 4), wanted)).toBeGreaterThanOrEqual(0.6);
  });
});

describe("chroma of synthesized strums", () => {
  const analyzer = new ChromaAnalyzer({ sampleRate });
  // Windows ending 0.3 s and 0.5 s after the strum began.
  const score = (played: number[], wanted: number[], end = 0.5, up = false) => {
    const audio = renderStrum(played, 0.1, 1.2, { sampleRate, instrument: "guitar", up });
    const stop = Math.round(end * sampleRate);
    return chromaScore(
      analyzer.analyse(audio.slice(stop - analyzer.size, stop)),
      pcs(wanted),
      Math.min(...wanted),
    );
  };

  it("scores the right chord high, up or down", () => {
    for (const end of [0.3, 0.5]) {
      expect(score(C, C, end)).toBeGreaterThan(0.7);
      expect(score(C, C, end, true)).toBeGreaterThan(0.7);
      expect(score(G, G, end)).toBeGreaterThan(0.7);
    }
  });

  it("scores a chord with a string missing above the threshold", () => {
    const withoutLow = C.slice(1);
    const withoutMiddle = C.filter((_, i) => i !== 2);
    expect(score(withoutLow, C)).toBeGreaterThan(0.6);
    expect(score(withoutMiddle, C)).toBeGreaterThan(0.6);
  });

  it("puts one wrong string between the right chord and a wrong one", () => {
    const oneWrong = [48, 52, 54, 60, 64];
    for (const end of [0.3, 0.5]) {
      const right = score(C, C, end);
      const wrongString = score(oneWrong, C, end);
      const wrongChord = score(D, C, end);
      expect(right).toBeGreaterThan(wrongString);
      expect(wrongString).toBeGreaterThan(wrongChord);
    }
  });

  it("keeps a close wrong chord (Am for C, C for Am) below the threshold", () => {
    for (const end of [0.3, 0.5]) {
      expect(score(AM, C, end)).toBeLessThan(0.6);
      expect(score(C, AM, end)).toBeLessThan(0.6);
      expect(score(D, G, end)).toBeLessThan(0.6);
    }
  });
});

describe("PitchEngine chroma", () => {
  function run(audio: Float32Array, on: boolean) {
    const engine = new PitchEngine({ sampleRate });
    engine.setChroma(on);
    const chroma = [];
    for (let at = 0; at < audio.length; at += 128) {
      engine.process(audio.subarray(at, Math.min(audio.length, at + 128)), at / sampleRate);
      chroma.push(...engine.takeChroma());
    }
    return chroma;
  }

  it("makes nothing unless asked", () => {
    const audio = renderStrum(C, 0.2, 1.5, { sampleRate, instrument: "guitar" });
    expect(run(audio, false)).toEqual([]);
  });

  it("reports the strum's attack and then the chord's pitch classes", () => {
    const audio = renderStrum(C, 0.5, 2, { sampleRate, instrument: "guitar" });
    const readings = run(audio, true);
    const onsets = readings.filter((reading) => reading.onset);
    expect(onsets.length).toBeGreaterThanOrEqual(1);
    expect(onsets[0].onsetTime).toBeGreaterThan(0.45);
    expect(onsets[0].onsetTime).toBeLessThan(0.65);
    // Before the strum: silence. Well after it: the chord.
    expect(readings[0].bins.every((value) => value === 0)).toBe(true);
    const settled = readings.find((reading) => reading.time > 1.1);
    expect(settled).toBeDefined();
    expect(chromaScore(settled!.bins, pcs(C))).toBeGreaterThan(0.7);
    expect(settled!.span).toBeCloseTo(8192 / sampleRate);
  });
});
