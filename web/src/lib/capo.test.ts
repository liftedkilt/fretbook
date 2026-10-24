import { describe, expect, it } from "vitest";
import { suggestCapos } from "./capo";

describe("suggestCapos", () => {
  it("suggests nothing when the chords are already open shapes", () => {
    expect(suggestCapos(["A", "D", "E"])).toEqual([]);
  });

  it("turns a flat key into open shapes: Bb, Eb, F, Gm with capo 3 is G, C, D, Em", () => {
    const result = suggestCapos(["Bb", "Eb", "F", "Gm"]);
    expect(result[0]).toEqual({ capo: 3, shapes: ["G", "C", "D", "Em"], barres: 0 });
  });

  it("finds the capo with no barres and ranks fewer barres first, then the lower capo", () => {
    const result = suggestCapos(["B", "E", "F#m", "G#m"], false, 7);
    expect(result[0]).toEqual({ capo: 4, shapes: ["G", "C", "Dm", "Em"], barres: 0 });
    for (let i = 1; i < result.length; i += 1) {
      const [before, now] = [result[i - 1], result[i]];
      expect(
        now.barres > before.barres || (now.barres === before.barres && now.capo > before.capo),
      ).toBe(true);
    }
  });

  it("only offers capos that beat playing with none", () => {
    // A, D, E and F#m has one barre; capo 2 gives G, C, D, Em with none.
    const result = suggestCapos(["A", "D", "E", "F#m"], false, 7);
    expect(result.every((item) => item.barres < 1)).toBe(true);
    expect(result[0].capo).toBe(2);
  });

  it("spells shapes with flats on request and keeps slash basses", () => {
    const result = suggestCapos(["C#", "F#", "G#/C"], true, 7);
    expect(result.length).toBeGreaterThan(0);
    for (const item of result) expect(item.shapes.join(" ")).not.toContain("#");
    expect(result.some((item) => item.shapes.some((shape) => shape.includes("/")))).toBe(true);
  });

  it("ignores symbols that are not chords and returns nothing for an empty list", () => {
    expect(suggestCapos([])).toEqual([]);
    expect(suggestCapos(["N.C.", "x2"])).toEqual([]);
    expect(suggestCapos(["N.C.", "Bb", "Eb", "F", "Gm"])[0].shapes).toEqual(["G", "C", "D", "Em"]);
  });

  it("compares with the capo already in use and never suggests it again", () => {
    // G, C, D, Em under capo 3 sound as Bb, Eb, F, Gm: already open shapes, so nothing beats them.
    expect(suggestCapos(["Bb", "Eb", "F", "Gm"], false, 3, 3)).toEqual([]);
    // The same sounding chords under capo 1 are A, D, E, F#m (one barre); capo 3 is better.
    const better = suggestCapos(["Bb", "Eb", "F", "Gm"], false, 3, 1);
    expect(better).toEqual([{ capo: 3, shapes: ["G", "C", "D", "Em"], barres: 0 }]);
  });

  it("honours the limit", () => {
    expect(suggestCapos(["Bb", "Eb", "F", "Gm"], false, 1)).toHaveLength(1);
  });
});
