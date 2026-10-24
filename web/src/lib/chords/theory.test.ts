import { describe, expect, it } from "vitest";

import { parseChord, shapeName } from "./theory";

describe("parseChord", () => {
  it("reads roots, qualities and aliases", () => {
    expect(parseChord("C")).toMatchObject({ root: 0, quality: "maj", bass: null });
    expect(parseChord("F#m7")).toMatchObject({ root: 6, quality: "m7" });
    expect(parseChord("Bbmaj7")).toMatchObject({ root: 10, quality: "maj7" });
    expect(parseChord("Cmin")?.quality).toBe("m");
    expect(parseChord("C-7")?.quality).toBe("m7");
    expect(parseChord("CM7")?.quality).toBe("maj7");
    expect(parseChord("C+")?.quality).toBe("aug");
    expect(parseChord("Bø")?.quality).toBe("m7b5");
    expect(parseChord("Am(maj7)")?.quality).toBe("mmaj7");
    expect(parseChord("Gsus")?.quality).toBe("sus4");
  });

  it("lists the pitch classes a voicing needs", () => {
    const chord = parseChord("Am7")!;
    expect([...chord.required].sort((a, b) => a - b)).toEqual([0, 4, 7, 9].filter((p) => p !== 4));
    expect(chord.optional).toEqual([4]);
    expect(parseChord("C")?.required).toEqual([0, 4, 7]);
  });

  it("handles slash basses, adding a foreign bass to the chord", () => {
    expect(parseChord("D/F#")).toMatchObject({ root: 2, bass: 6 });
    expect(parseChord("C/E")?.bass).toBe(4);
    expect(parseChord("C/D")?.required).toContain(2);
    expect(parseChord("C/C")?.bass).toBeNull();
  });

  it("returns null for symbols that are not chords", () => {
    for (const name of ["N.C.", "x2", "|", "", "H", "Cfoo", "C/H", "%"]) {
      expect(parseChord(name)).toBeNull();
    }
  });
});

describe("shapeName", () => {
  it("is the transposed name", () => {
    expect(shapeName("Am", 2, false)).toBe("Bm");
    expect(shapeName("C", 1, true)).toBe("Db");
  });
});

describe("extended qualities", () => {
  it("reads elevenths, thirteenths and altered dominants", () => {
    const cases: [string, string][] = [
      ["C11", "11"],
      ["Am11", "m11"],
      ["G13", "13"],
      ["Dm13", "m13"],
      ["Fmaj13", "maj13"],
      ["CM13", "maj13"],
      ["G7b5", "7b5"],
      ["G7(b5)", "7b5"],
      ["G7#11", "7#11"],
      ["Cmaj7#11", "maj7#11"],
      ["G7b13", "aug7"],
      ["G9sus4", "9sus4"],
      ["Cmadd9", "madd9"],
      ["Cadd11", "add11"],
    ];
    for (const [name, quality] of cases) expect(parseChord(name)?.quality, name).toBe(quality);
  });

  it("keeps the colour tones required and lets the fifth and ninth go", () => {
    const sorted = (list: number[]) => [...list].sort((a, b) => a - b);
    expect(sorted(parseChord("C13")!.required)).toEqual([0, 4, 9, 10]);
    expect(sorted(parseChord("C13")!.optional)).toEqual([2, 7]);
    expect(sorted(parseChord("Cm11")!.required)).toEqual([0, 3, 5, 10]);
    expect(sorted(parseChord("G7b5")!.required)).toEqual([1, 5, 7, 11]);
  });
});
