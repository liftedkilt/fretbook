import { describe, expect, it } from "vitest";
import { beamAt, hasFlag } from "./beaming";
import { patternById } from "./patterns";

describe("beaming", () => {
  it("quarters have no beams and no flags", () => {
    const quarters = patternById("quarters");
    for (let i = 0; i < 4; i++) {
      expect(beamAt(quarters, i)).toBeNull();
      expect(hasFlag(quarters, i)).toBe(false);
    }
  });

  it("eighths have 4 beamed pairs with span 1 and no secondary beams", () => {
    const eighths = patternById("eighths");
    // Cells 0, 2, 4, 6 start beams of span 1
    for (let beat = 0; beat < 4; beat++) {
      const first = beat * 2;
      const second = first + 1;
      expect(beamAt(eighths, first)).toEqual({ span: 1, secondary: false });
      expect(beamAt(eighths, second)).toBeNull();
      expect(hasFlag(eighths, first)).toBe(false);
      expect(hasFlag(eighths, second)).toBe(false);
    }
  });

  it("sixteenths have 4 beamed groups with span 3 and secondary beams", () => {
    const sixteenths = patternById("sixteenths");
    for (let beat = 0; beat < 4; beat++) {
      const start = beat * 4;
      expect(beamAt(sixteenths, start)).toEqual({ span: 3, secondary: true });
      for (let offset = 1; offset < 4; offset++) {
        expect(beamAt(sixteenths, start + offset)).toBeNull();
        expect(hasFlag(sixteenths, start + offset)).toBe(false);
      }
    }
  });

  it("triplets have 4 beamed groups of span 2", () => {
    const triplets = patternById("triplets");
    for (let beat = 0; beat < 4; beat++) {
      const start = beat * 3;
      expect(beamAt(triplets, start)).toEqual({ span: 2, secondary: false });
      expect(beamAt(triplets, start + 1)).toBeNull();
      expect(beamAt(triplets, start + 2)).toBeNull();
    }
  });

  it("gallop has an isolated note with flags and a beamed pair in beat 0", () => {
    const gallop = patternById("gallop"); // x.xxx.xxx.xxx.xx
    // Beat 0: cells 0 (hit), 1 (rest), 2 (hit), 3 (hit)
    expect(beamAt(gallop, 0)).toBeNull();
    expect(hasFlag(gallop, 0)).toBe(true);

    expect(beamAt(gallop, 1)).toBeNull();
    expect(hasFlag(gallop, 1)).toBe(false);

    expect(beamAt(gallop, 2)).toEqual({ span: 1, secondary: true });
    expect(beamAt(gallop, 3)).toBeNull();
    expect(hasFlag(gallop, 2)).toBe(false);
    expect(hasFlag(gallop, 3)).toBe(false);
  });

  it("syncopation has isolated eighth notes with flags", () => {
    const syncopation = patternById("syncopation"); // x..xx.x.
    // Beat 0: cell 0 (hit), 1 (rest)
    expect(beamAt(syncopation, 0)).toBeNull();
    expect(hasFlag(syncopation, 0)).toBe(true);
    // Beat 1: cell 2 (rest), 3 (hit)
    expect(beamAt(syncopation, 2)).toBeNull();
    expect(beamAt(syncopation, 3)).toBeNull();
    expect(hasFlag(syncopation, 3)).toBe(true);
  });
});
