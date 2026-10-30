import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { evaluate, formatReport, runEngine, type TruthNote } from "./evaluate";
import { midiToFrequency, centsBetween } from "../notes";
import { SCENARIOS, dropAScenario, renderScenario } from "./scenarios";
import { decodeWav } from "./wav";

// The audio is synthesized (see synth.ts), so these thresholds guard against regressions in the
// detector rather than promise accuracy on a real instrument. Real recordings can be added as
// fixtures; see fixtures/README.md.
//
// A weak unguided bass fundamental, a soft repeated pluck, and a second voice under the note
// are the cases a laptop mic still fails. They are written up in
// docs/design/tuner-and-wait-pitch.md. Extend this file there; do not lower the bars below.
const RATES = [44100, 48000];

// DSP over synthesized audio is CPU-heavy; shared CI runners can exceed the 5s default.
describe("pitch and onset accuracy on synthesized instruments", { timeout: 60_000 }, () => {
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

describe("drop A and guitar-range lock", { timeout: 60_000 }, () => {
  for (const sampleRate of RATES) {
    it(`locks the fundamental of MIDI 21 at ${sampleRate} Hz`, () => {
      const events = runEngine(renderScenario(dropAScenario, sampleRate), sampleRate);
      const first = dropAScenario.notes[0];
      const inside = events.filter(
        (e) => e.frequency !== null && e.time >= first.start + 0.2 && e.time <= first.start + 0.8,
      );
      expect(inside.length).toBeGreaterThan(5);
      for (const e of inside)
        expect(Math.abs(centsBetween(e.frequency as number, midiToFrequency(21)))).toBeLessThan(25);
    });
  }

  it("does not regress guitar steady-lock latency", () => {
    const sampleRate = 48000;
    const scenario = SCENARIOS[1];
    const events = runEngine(renderScenario(scenario, sampleRate), sampleRate);
    const right = (e: (typeof events)[number], midi: number) =>
      e.frequency !== null && Math.abs(centsBetween(e.frequency, midiToFrequency(midi))) < 25;
    const latencies = scenario.notes.map((note) => {
      // First reading after the attack that starts a run of five right readings.
      const after = events.filter((e) => e.time >= note.start);
      const at = after.findIndex((_, i) => after.slice(i, i + 5).every((e) => right(e, note.midi)));
      return at < 0 ? Infinity : after[at].time - note.start;
    });
    const median = latencies.sort((a, b) => a - b)[Math.floor(latencies.length / 2)];
    console.log(`guitar median steady-lock latency ${(median * 1000).toFixed(0)} ms`);
    // The single 4096-sample window needed about 85 ms of the new note first.
    expect(median).toBeLessThan(0.085);
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
