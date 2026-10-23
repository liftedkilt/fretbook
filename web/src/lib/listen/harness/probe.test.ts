import { it } from "vitest";
import { evaluate, formatReport } from "./evaluate";
import { SCENARIOS, renderScenario } from "./scenarios";
it("probe", () => {
  for (const sr of [48000, 44100, 16000]) for (const s of SCENARIOS) for (const useExpected of [false]) {
    const r = evaluate(renderScenario(s, sr), s.notes, { sampleRate: sr, useExpected });
    console.log(sr, formatReport(s.name, r));
  }
}, 120000);
