import { it } from "vitest";
import { runEngine } from "./evaluate";
import { SCENARIOS, renderScenario } from "./scenarios";
it("probe", () => {
  const s = SCENARIOS[0];
  const ev = runEngine(renderScenario(s, 44100), 44100);
  console.log("m", ev.filter((e) => e.time < 1.2).map((e) => `${e.time.toFixed(2)}:${e.midi}/${e.clarity.toFixed(2)}${e.onset ? "*" : ""}`).join(" "));
});
