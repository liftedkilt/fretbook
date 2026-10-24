import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chosenVoicing, loadChoice, loadSetup, saveChoice, saveSetup } from "./choice";
import type { Voicing } from "./voicings";

const make = (frets: (number | null)[]): Voicing => ({
  frets,
  baseFret: 1,
  barre: null,
  source: "generated",
});

function memoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
}

describe("chord choices", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("remembers instrument, tuning and voicings per song", () => {
    saveChoice("a", { instrument: "ukulele", tuning: "lowG", voicings: { C: "0.0.0.3" } });
    expect(loadChoice("a")).toEqual({
      instrument: "ukulele",
      tuning: "lowG",
      voicings: { C: "0.0.0.3" },
    });
    expect(loadChoice("b")).toEqual({ voicings: {} });
  });

  it("ignores damaged storage", () => {
    localStorage.setItem("fretbook.chordChoice.a", "{nope");
    expect(loadChoice("a")).toEqual({ voicings: {} });
    localStorage.setItem(
      "fretbook.chordChoice.a",
      JSON.stringify({ instrument: 4, voicings: { C: 1, G: "x" } }),
    );
    expect(loadChoice("a")).toEqual({
      instrument: undefined,
      tuning: undefined,
      voicings: { G: "x" },
    });
    localStorage.setItem("fretbook.chordChoice.a", "null");
    expect(loadChoice("a")).toEqual({ voicings: {} });
  });

  it("survives storage that throws", () => {
    const broken = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", { getItem: broken, setItem: broken });
    expect(() => saveChoice("a", { voicings: {} })).not.toThrow();
    expect(() => saveSetup({ instrument: "guitar6", tuning: "standard" })).not.toThrow();
    expect(loadChoice("a")).toEqual({ voicings: {} });
    expect(loadSetup()).toEqual({});
  });

  it("keeps the library's setup", () => {
    expect(loadSetup()).toEqual({});
    saveSetup({ instrument: "bass4", tuning: "dropD" });
    expect(loadSetup()).toEqual({ instrument: "bass4", tuning: "dropD" });
    localStorage.setItem("fretbook.chordSetup", "3");
    expect(loadSetup()).toEqual({});
  });
});

describe("chosenVoicing", () => {
  const list = [make([0, 0, 0]), make([1, 1, 1]), make([2, 2, 2])];

  it("finds the remembered voicing by its frets", () => {
    expect(chosenVoicing(list, "2.2.2")?.index).toBe(2);
  });

  it("falls back to the best one", () => {
    expect(chosenVoicing(list, undefined)?.index).toBe(0);
    expect(chosenVoicing(list, "9.9.9")?.index).toBe(0);
    expect(chosenVoicing([], "0.0.0")).toBeNull();
  });
});
