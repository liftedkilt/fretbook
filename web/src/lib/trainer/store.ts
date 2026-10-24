/*
 * Trainer results remembered in this browser: per-string fretboard statistics and the best score
 * of each game. The server gets only the time and score (the practice log); this is the detail.
 */

import { emptyStat, type StringStats } from "./fretboardGame";

export type TrainerKind = "fretboard" | "interval" | "chord";

/** Locale keys per game (spelled out so the catalog test can see every key is used). */
export const KIND_NAMES: Record<TrainerKind, { labelKey: string }> = {
  fretboard: { labelKey: "trainer.kinds.fretboard" },
  interval: { labelKey: "trainer.kinds.interval" },
  chord: { labelKey: "trainer.kinds.chord" },
};

export const KIND_ABOUT: Record<TrainerKind, { labelKey: string }> = {
  fretboard: { labelKey: "trainer.about.fretboard" },
  interval: { labelKey: "trainer.about.interval" },
  chord: { labelKey: "trainer.about.chord" },
};

export interface TrainerStore {
  /** Per-string stats, keyed by the tuning they were made on (`"64,59,55,50,45,40"`). */
  strings: Record<string, StringStats>;
  /** Best score (0 to 100) per game and setting, e.g. `"interval:easy"`. */
  bests: Record<string, number>;
}

const KEY = "fretbook.trainer";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function tuningKey(tuning: readonly number[]): string {
  return tuning.join(",");
}

export function parseStore(raw: string | null): TrainerStore {
  const store: TrainerStore = { strings: {}, bests: {} };
  if (!raw) return store;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return store;
  }
  if (!isRecord(data)) return store;
  if (isRecord(data.strings)) {
    for (const [tuning, stats] of Object.entries(data.strings)) {
      if (!isRecord(stats)) continue;
      const clean: StringStats = {};
      for (const [string, stat] of Object.entries(stats)) {
        if (
          isRecord(stat) &&
          isNumber(stat.asked) &&
          isNumber(stat.correct) &&
          isNumber(stat.totalMs)
        )
          clean[string] = {
            ...emptyStat(),
            asked: stat.asked,
            correct: stat.correct,
            totalMs: stat.totalMs,
          };
      }
      store.strings[tuning] = clean;
    }
  }
  if (isRecord(data.bests)) {
    for (const [key, value] of Object.entries(data.bests)) {
      if (isNumber(value)) store.bests[key] = value;
    }
  }
  return store;
}

export function loadStore(
  storage: Pick<Storage, "getItem"> | undefined = safeStorage(),
): TrainerStore {
  try {
    return parseStore(storage?.getItem(KEY) ?? null);
  } catch {
    return parseStore(null);
  }
}

export function saveStore(
  store: TrainerStore,
  storage: Pick<Storage, "setItem"> | undefined = safeStorage(),
): void {
  try {
    storage?.setItem(KEY, JSON.stringify(store));
  } catch {
    // Private mode or a full disk: the statistics are a convenience.
  }
}

/** Record a score; returns the new store and whether it beat the previous best. */
export function recordBest(
  store: TrainerStore,
  key: string,
  score: number,
): { store: TrainerStore; isBest: boolean } {
  const before = store.bests[key];
  const isBest = before === undefined || score > before;
  return {
    store: isBest ? { ...store, bests: { ...store.bests, [key]: score } } : store,
    isBest,
  };
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
