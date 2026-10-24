import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addScore,
  bestKey,
  loadScores,
  loopKey,
  parseScoreLog,
  personalBest,
  recordScore,
  type ScoreRecord,
} from "./scoreLog";

const record = (accuracy: number, extra: Partial<ScoreRecord> = {}): ScoreRecord => ({
  at: 1,
  accuracy,
  stars: 2,
  hits: 8,
  total: 10,
  extras: 0,
  bestStreak: 5,
  loop: "full",
  speed: 100,
  ...extra,
});

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe("scoreLog", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("keys the personal best by loop and speed", () => {
    expect(loopKey(null)).toBe("full");
    expect(loopKey({ a: 2, b: 5 })).toBe("2-5");
    expect(bestKey("2-5", 84.6)).toBe("2-5@85");
  });

  it("keeps the best result per loop and speed and the latest history", () => {
    const first = addScore({ history: [], bests: {} }, record(0.6));
    expect(first.isBest).toBe(true);
    const worse = addScore(first.log, record(0.5));
    expect(worse.isBest).toBe(false);
    expect(worse.previous?.accuracy).toBe(0.6);
    expect(personalBest(worse.log, "full", 100)?.accuracy).toBe(0.6);
    const slower = addScore(worse.log, record(0.4, { speed: 80 }));
    expect(slower.isBest).toBe(true);
    expect(personalBest(slower.log, "full", 80)?.accuracy).toBe(0.4);
    expect(slower.log.history.map((item) => item.accuracy)).toEqual([0.4, 0.5, 0.6]);
  });

  it("limits the history", () => {
    let log = { history: [] as ScoreRecord[], bests: {} };
    for (let index = 0; index < 40; index += 1) log = addScore(log, record(0.5)).log;
    expect(log.history).toHaveLength(30);
  });

  it("saves, reloads and announces a result", () => {
    const heard = vi.fn();
    vi.stubGlobal("window", { dispatchEvent: heard });
    recordScore("song-1", record(0.9));
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard.mock.calls[0][0].detail).toMatchObject({ kind: "score", songId: "song-1" });
    expect(loadScores("song-1").history).toHaveLength(1);
    expect(loadScores("other").history).toHaveLength(0);
  });

  it("survives having no storage or window", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(loadScores("x")).toEqual({ history: [], bests: {} });
    expect(recordScore("x", record(0.5)).isBest).toBe(true);
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(recordScore("x", record(0.5)).isBest).toBe(true);
  });

  it("ignores damaged data", () => {
    vi.stubGlobal("localStorage", memoryStorage({ "fretbook.scores.bad": "{nope" }));
    expect(loadScores("bad")).toEqual({ history: [], bests: {} });
    expect(parseScoreLog(null)).toEqual({ history: [], bests: {} });
    expect(
      parseScoreLog({
        history: [{ accuracy: "x" }, record(0.5), 3],
        bests: { a: { nope: true }, b: record(0.7), c: { ...record(1), loop: 4 } },
      }),
    ).toEqual({ history: [record(0.5)], bests: { b: record(0.7) } });
  });
});
