import { describe, expect, it } from "vitest";

import { monogram, paletteFor, PALETTES } from "./cover";

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
