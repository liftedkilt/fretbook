import { describe, expect, it } from "vitest";

import { coverSrc, monogram, paletteFor, PALETTES, patternFor } from "./cover";

describe("cover art", () => {
  it("gives the same song the same palette", () => {
    expect(paletteFor("abc")).toBe(paletteFor("abc"));
    expect(PALETTES).toContain(paletteFor("another-song"));
  });

  it("builds a monogram from the title", () => {
    expect(monogram("The Chain")).toBe("C");
    expect(monogram("Another One Bites the Dust")).toBe("AO");
    expect(monogram("  ")).toBe("♪");
    expect(monogram("águas de março")).toBe("ÁD");
  });
});

describe("coverSrc", () => {
  it("is undefined without a cover and resolves a relative address", () => {
    expect(coverSrc(null)).toBeUndefined();
    expect(coverSrc("")).toBeUndefined();
    expect(coverSrc("api/songs/s1/cover?v=1")).toContain("api/songs/s1/cover?v=1");
  });
});

describe("patternFor", () => {
  it("is stable for an id and varies between ids", () => {
    expect(patternFor("abc")).toEqual(patternFor("abc"));
    const shapes = new Set(
      Array.from({ length: 40 }, (_, index) => patternFor(`song-${index}`).shape),
    );
    expect(shapes.size).toBeGreaterThan(1);
  });
});
