import { describe, expect, it } from "vitest";
import { midiToFrequency } from "./listen/notes";
import {
  A4_MAX,
  A4_MIN,
  InTuneTracker,
  PRESETS,
  TICK_READINGS,
  chromaticMatch,
  clampA4,
  isInTune,
  nearestString,
  needlePosition,
  withCapo,
} from "./tuner";

const STANDARD = PRESETS.find((p) => p.id === "standard")!.midi;

describe("presets", () => {
  it("lists strings highest first with the expected string counts", () => {
    for (const preset of PRESETS) {
      expect([...preset.midi].sort((a, b) => b - a)).toEqual(preset.midi);
    }
    expect(PRESETS.find((p) => p.id === "bass4")!.midi).toEqual([43, 38, 33, 28]);
    expect(PRESETS.find((p) => p.id === "bass5")!.midi).toHaveLength(5);
    expect(PRESETS.find((p) => p.id === "bass6")!.midi).toHaveLength(6);
    expect(PRESETS.find((p) => p.id === "dropD")!.midi.at(-1)).toBe(38);
    expect(PRESETS.find((p) => p.id === "dadgad")!.midi).toEqual([62, 57, 55, 50, 45, 38]);
  });
});

describe("clampA4", () => {
  it("keeps the reference inside 432 to 446 Hz", () => {
    expect(clampA4(400)).toBe(A4_MIN);
    expect(clampA4(500)).toBe(A4_MAX);
    expect(clampA4(441.4)).toBe(441);
    expect(clampA4(Number.NaN)).toBe(440);
  });
});

describe("withCapo", () => {
  it("raises every string by the capo fret", () => {
    expect(withCapo([64, 59], 2)).toEqual([66, 61]);
    expect(withCapo([64, 59], 0)).toEqual([64, 59]);
  });
});

describe("nearestString", () => {
  it("finds the string and the cents off it", () => {
    const a = midiToFrequency(45);
    const match = nearestString(a * 2 ** (10 / 1200), STANDARD)!;
    expect(match.index).toBe(4);
    expect(match.cents).toBeCloseTo(10, 5);
  });

  it("reads flat as negative", () => {
    const match = nearestString(midiToFrequency(50) * 2 ** (-20 / 1200), STANDARD)!;
    expect(match.index).toBe(3);
    expect(match.cents).toBeCloseTo(-20, 5);
  });

  it("honours the A4 reference", () => {
    const match = nearestString(432, [69], 432)!;
    expect(match.cents).toBeCloseTo(0, 5);
    expect(nearestString(432, [69], 440)!.cents).toBeLessThan(-30);
  });

  it("returns null with no pitch or no strings", () => {
    expect(nearestString(0, STANDARD)).toBeNull();
    expect(nearestString(110, [])).toBeNull();
  });
});

describe("chromaticMatch", () => {
  it("names the nearest note", () => {
    const match = chromaticMatch(midiToFrequency(61) * 2 ** (-8 / 1200))!;
    expect(match.midi).toBe(61);
    expect(match.cents).toBeCloseTo(-8, 5);
    expect(chromaticMatch(-1)).toBeNull();
  });
});

describe("needle", () => {
  it("clamps to the dial", () => {
    expect(needlePosition(25)).toBe(0.5);
    expect(needlePosition(-80)).toBe(-1);
    expect(needlePosition(80)).toBe(1);
  });

  it("calls five cents in tune", () => {
    expect(isInTune(5)).toBe(true);
    expect(isInTune(-5.1)).toBe(false);
  });
});

describe("InTuneTracker", () => {
  it("shows the tick only after several steady readings on one string", () => {
    const tracker = new InTuneTracker();
    for (let i = 1; i < TICK_READINGS; i++) expect(tracker.update(2, 1)).toBe(false);
    expect(tracker.update(2, 1)).toBe(true);
  });

  it("starts over when the cents drift, the string changes or the sound stops", () => {
    const tracker = new InTuneTracker();
    for (let i = 0; i < TICK_READINGS; i++) tracker.update(2, 0);
    expect(tracker.update(2, 12)).toBe(false);
    expect(tracker.update(2, 0)).toBe(false);
    for (let i = 0; i < TICK_READINGS; i++) tracker.update(2, 0);
    expect(tracker.update(3, 0)).toBe(false);
    for (let i = 0; i < TICK_READINGS; i++) tracker.update(3, 0);
    expect(tracker.update(null, null)).toBe(false);
    expect(tracker.update(3, 0)).toBe(false);
  });
});
