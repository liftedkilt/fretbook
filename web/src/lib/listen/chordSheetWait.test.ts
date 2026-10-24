import { describe, expect, it } from "vitest";

import { parse } from "../chordpro";
import { chordSheetSteps, segmentKey } from "./chordSheetWait";

const SHEET = `{title: Test}
{capo: 2}
{start_of_verse}
[Am]Hello [F]there
[N.C.]Quiet [C/G]now
{end_of_verse}
[G]Last
`;

describe("chordSheetSteps", () => {
  it("lists the chords in reading order, skipping what is not a chord", () => {
    const { steps, keys } = chordSheetSteps(parse(SHEET.replace("{capo: 2}\n", "")));
    expect(steps.map((step) => step.label)).toEqual(["Am", "F", "C/G", "G"]);
    expect(steps.every((step) => step.kind === "chord")).toBe(true);
    expect(steps.map((step) => step.tick)).toEqual([0, 1, 2, 3]);
    expect(steps[0].pcs?.slice().sort((a, b) => a - b)).toEqual([0, 4, 9]);
    expect(keys[0]).toBe(segmentKey(0, 0, 0));
    expect(keys).toHaveLength(steps.length);
  });

  it("raises the shapes by the capo", () => {
    const { steps } = chordSheetSteps(parse(SHEET));
    // Am shape with a capo on 2 sounds as Bm: B, D, F#.
    expect(steps[0].label).toBe("Am");
    expect(steps[0].pcs?.slice().sort((a, b) => a - b)).toEqual([2, 6, 11]);
  });

  it("follows the transposition and its spelling", () => {
    const { steps } = chordSheetSteps(parse("[C]a [G]b"), 2, true);
    expect(steps.map((step) => step.label)).toEqual(["D", "A"]);
    expect(chordSheetSteps(parse("[C]a"), 1, true).steps[0].label).toBe("Db");
    expect(chordSheetSteps(parse("[C]a"), 1, false).steps[0].label).toBe("C#");
  });

  it("is empty for a sheet with no chords", () => {
    expect(chordSheetSteps(parse("just words")).steps).toEqual([]);
  });
});
