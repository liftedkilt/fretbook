import { describe, expect, it } from "vitest";

import { RATES, SHORTCUTS, shortcutFor, stepRate } from "./shortcuts";

const press = (key: string, extra: Partial<Parameters<typeof shortcutFor>[0]> = {}) =>
  shortcutFor({ key, ctrlKey: false, metaKey: false, altKey: false, ...extra });

describe("shortcuts", () => {
  it("maps keys to actions, and ? (which needs Shift) to help", () => {
    expect(press(" ")).toBe("toggle");
    expect(press("m")).toBe("metronome");
    expect(press("M")).toBe("metronome");
    expect(press("c")).toBe("countIn");
    expect(press("?")).toBe("help");
    expect(press("=")).toBe("volumeUp");
    expect(press("q")).toBeNull();
  });

  it("leaves browser shortcuts alone", () => {
    expect(press("m", { ctrlKey: true })).toBeNull();
    expect(press("s", { metaKey: true })).toBeNull();
    expect(press(" ", { altKey: true })).toBeNull();
  });

  it("gives every key to one action only, and every action a label", () => {
    const seen = new Set<string>();
    for (const item of SHORTCUTS) {
      expect(item.label).not.toBe("");
      for (const key of item.keys) {
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it("steps the speed through the list and stops at both ends", () => {
    expect(stepRate(1, 1)).toBe(1.1);
    expect(stepRate(1, -1)).toBe(0.9);
    expect(stepRate(RATES[RATES.length - 1], 1)).toBe(RATES[RATES.length - 1]);
    expect(stepRate(RATES[0], -1)).toBe(RATES[0]);
    expect(stepRate(0.95, 1)).toBe(1);
  });
});
