import { describe, expect, it } from "vitest";
import { loadStore, parseStore, recordBest, saveStore, tuningKey } from "./store";

describe("trainer store", () => {
  it("keys stats by tuning", () => {
    expect(tuningKey([64, 59, 55])).toBe("64,59,55");
  });

  it("parses a stored value and drops what is malformed", () => {
    const store = parseStore(
      JSON.stringify({
        strings: {
          "64,59": { "0": { asked: 4, correct: 3, totalMs: 900 }, "1": { asked: "x" } },
          bad: 5,
        },
        bests: { "interval:easy": 80, other: "high" },
      }),
    );
    expect(store.strings).toEqual({ "64,59": { "0": { asked: 4, correct: 3, totalMs: 900 } } });
    expect(store.bests).toEqual({ "interval:easy": 80 });
  });

  it("starts empty for nothing, junk or the wrong shape", () => {
    const empty = { strings: {}, bests: {} };
    expect(parseStore(null)).toEqual(empty);
    expect(parseStore("not json")).toEqual(empty);
    expect(parseStore("[1]")).toEqual(empty);
    expect(parseStore("{}")).toEqual(empty);
  });

  it("round-trips through storage and survives storage failing", () => {
    const memory: Record<string, string> = {};
    const storage = {
      getItem: (key: string) => memory[key] ?? null,
      setItem: (key: string, value: string) => void (memory[key] = value),
    };
    const store = { strings: {}, bests: { "chord:all": 62.5 } };
    saveStore(store, storage);
    expect(loadStore(storage)).toEqual(store);
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(() => saveStore(store, broken)).not.toThrow();
    expect(loadStore(broken)).toEqual({ strings: {}, bests: {} });
    expect(loadStore(undefined)).toBeDefined();
  });

  it("records a best only when it is beaten", () => {
    const first = recordBest({ strings: {}, bests: {} }, "k", 70);
    expect(first.isBest).toBe(true);
    const lower = recordBest(first.store, "k", 60);
    expect(lower.isBest).toBe(false);
    expect(lower.store).toBe(first.store);
    expect(recordBest(first.store, "k", 90).store.bests.k).toBe(90);
  });
});
