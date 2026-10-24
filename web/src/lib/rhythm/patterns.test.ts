import { describe, expect, it } from "vitest";

import {
  PATTERNS,
  barSeconds,
  cellCount,
  expectedHits,
  patternById,
  strumDirection,
} from "./patterns";

describe("patterns", () => {
  it("has a cell for every grid slot in every pattern", () => {
    for (const pattern of PATTERNS) {
      expect(pattern.cells).toHaveLength(cellCount(pattern));
      expect(pattern.cells).toMatch(/^[x.]+$/);
      expect(pattern.cells).toContain("x");
    }
  });

  it("covers quarters to sixteenths, rests, syncopation and triplets", () => {
    const grids = new Set(PATTERNS.map((p) => p.grid));
    expect([...grids].sort()).toEqual([1, 2, 3, 4]);
    expect(PATTERNS.some((p) => p.cells.includes("."))).toBe(true);
    expect(patternById("syncopation").cells).toBe("x..xx.x.");
  });

  it("falls back to the default for an unknown id", () => {
    expect(patternById("nope").id).toBe("eighths");
  });

  it("places hits on the beat grid", () => {
    expect(expectedHits(patternById("quarters"), 120, 1)).toEqual([0, 500, 1000, 1500]);
    expect(expectedHits(patternById("rests"), 120, 2)).toEqual([0, 1000, 2000, 3000]);
    expect(expectedHits(patternById("syncopation"), 120, 1)).toEqual([0, 750, 1000, 1500]);
    const triplets = expectedHits(patternById("triplets"), 90, 1);
    expect(triplets).toHaveLength(12);
    expect(triplets[1]).toBeCloseTo(222.2, 1);
  });

  it("measures a bar", () => {
    expect(barSeconds(patternById("quarters"), 60)).toBe(4);
  });

  it("strums down on the beat and up in between", () => {
    const eighths = patternById("eighths");
    expect([0, 1, 2, 3].map((c) => strumDirection(eighths, c))).toEqual([
      "down",
      "up",
      "down",
      "up",
    ]);
    const triplets = patternById("triplets");
    expect([0, 1, 2, 3].map((c) => strumDirection(triplets, c))).toEqual([
      "down",
      "up",
      "down",
      "down",
    ]);
  });
});
