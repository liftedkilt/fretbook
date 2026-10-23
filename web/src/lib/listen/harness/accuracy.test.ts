import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { evaluate, formatReport, type TruthNote } from "./evaluate";
import { SCENARIOS, renderScenario } from "./scenarios";
import { decodeWav } from "./wav";

// The audio is synthesized (see synth.ts), so these thresholds guard against regressions in the
// detector rather than promise accuracy on a real instrument. Real recordings can be added as
// fixtures; see fixtures/README.md.
const RATES = [44100, 48000];

// DSP over synthesized audio is CPU-heavy; shared CI runners can exceed the 5s default.
describe("pitch and onset accuracy on synthesized instruments", { timeout: 30_000 }, () => {
  for (const sampleRate of RATES) {
    for (const scenario of SCENARIOS) {
      it(`${scenario.name} at ${sampleRate} Hz`, () => {
        const report = evaluate(renderScenario(scenario, sampleRate), scenario.notes, {
          sampleRate,
        });
        console.log(`[${sampleRate} Hz] ${formatReport(scenario.name, report)}`);
        expect(report.pitchHits / report.notes).toBeGreaterThanOrEqual(0.95);
        expect(report.octaveErrors).toBe(0);
        expect(report.medianAbsCents).toBeLessThan(8);
        expect(report.onsetRecall).toBeGreaterThanOrEqual(0.9);
        expect(report.onsetPrecision).toBeGreaterThanOrEqual(0.9);
      });
    }
  }

  it("resolves octave errors towards the expected note", () => {
    const scenario = SCENARIOS[0];
    const sampleRate = 48000;
    const report = evaluate(renderScenario(scenario, sampleRate), scenario.notes, {
      sampleRate,
      useExpected: true,
    });
    console.log(formatReport("bass range, expected note given", report));
    expect(report.pitchHits).toBe(report.notes);
    expect(report.octaveErrors).toBe(0);
  });
});

describe("committed WAV fixtures", { timeout: 30_000 }, () => {
  for (const name of ["bass-riff", "guitar-riff"]) {
    it(name, () => {
      const dir = new URL("../fixtures/", import.meta.url);
      const wav = decodeWav(
        new Uint8Array(readFileSync(fileURLToPath(new URL(`${name}.wav`, dir)))),
      );
      const truth = JSON.parse(
        readFileSync(fileURLToPath(new URL(`${name}.json`, dir)), "utf8"),
      ) as {
        sampleRate: number;
        notes: TruthNote[];
      };
      expect(wav.sampleRate).toBe(truth.sampleRate);
      const report = evaluate(wav.samples, truth.notes, { sampleRate: wav.sampleRate });
      console.log(formatReport(name, report));
      expect(report.pitchHits / report.notes).toBeGreaterThanOrEqual(0.95);
      expect(report.octaveErrors).toBe(0);
      expect(report.onsetRecall).toBeGreaterThanOrEqual(0.9);
      expect(report.onsetPrecision).toBeGreaterThanOrEqual(0.85);
    });
  }
});
