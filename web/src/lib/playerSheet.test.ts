import { describe, expect, it, vi } from "vitest";

import { formatRate, loadSheetTab, saveSheetTab, sectionMarks } from "./playerSheet";

function memory(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("player sheet tab memory", () => {
  it("starts on Practice and keeps the last tab per user", () => {
    const store = memory();
    vi.stubGlobal("localStorage", store);
    expect(loadSheetTab("ada")).toBe("practice");
    saveSheetTab("sync", "ada");
    expect(loadSheetTab("ada")).toBe("sync");
    expect(loadSheetTab("bea")).toBe("sync");
    saveSheetTab("view", "bea");
    expect(loadSheetTab("ada")).toBe("sync");
    expect(loadSheetTab("bea")).toBe("view");
    store.setItem("fretbook.playerSheetTab.ada", "nope");
    expect(loadSheetTab("ada")).toBe("practice");
    vi.unstubAllGlobals();
  });

  it("ignores a store that throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(loadSheetTab()).toBe("practice");
    expect(() => saveSheetTab("audio")).not.toThrow();
    vi.unstubAllGlobals();
  });
});

describe("formatRate", () => {
  it("prints the multiplier the dock shows", () => {
    expect(formatRate(1)).toBe("1×");
    expect(formatRate(0.75)).toBe("0.75×");
  });
});

describe("sectionMarks", () => {
  it("marks the played bar where a section name is set", () => {
    const bars = [
      { section: "Intro" },
      { section: null },
      { section: " Chorus " },
      { section: "" },
    ];
    expect(sectionMarks(bars, [0, 1, 2, 3, 0])).toEqual([
      { index: 0, label: "Intro" },
      { index: 2, label: "Chorus" },
      { index: 4, label: "Intro" },
    ]);
  });
});
