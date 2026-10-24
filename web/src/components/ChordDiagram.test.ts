import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";

import ChordDiagram from "./ChordDiagram.svelte";
import { generateVoicings, physicalTuning } from "../lib/chords/voicings";

const guitar = physicalTuning([64, 59, 55, 50, 45, 40]);

describe("ChordDiagram", () => {
  it("writes the finger numbers on the dots", () => {
    const c = generateVoicings(guitar, "C").find((v) => v.frets.join() === ",3,2,0,1,0")!;
    const { container } = render(ChordDiagram, { voicing: c, strings: 6, name: "C" });
    const fingers = [...container.querySelectorAll(".finger")].map((el) => el.textContent);
    expect(fingers.sort()).toEqual(["1", "2", "3"]);
  });

  it("writes the barre finger on both ends of a barre", () => {
    const f = generateVoicings(guitar, "F").find((v) => v.frets.join() === "1,3,3,2,1,1")!;
    const { container } = render(ChordDiagram, { voicing: f, strings: 6, name: "F" });
    const fingers = [...container.querySelectorAll(".finger")].map((el) => el.textContent);
    expect(fingers.filter((n) => n === "1")).toHaveLength(2);
  });

  it("draws none when the shape has no fingering", () => {
    const { container } = render(ChordDiagram, {
      voicing: { frets: [null, 0, 2, 2, 1, 0], baseFret: 1, barre: null, source: "define" },
      strings: 6,
      name: "Am",
    });
    expect(container.querySelectorAll(".finger")).toHaveLength(0);
  });
});
