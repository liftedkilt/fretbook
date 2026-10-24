/*
 * Scored play-along results, remembered per song in this browser (like the practice settings):
 * the latest runs, and the personal best for each song, loop and speed.
 */

export interface ScoreRecord {
  /** Milliseconds since the epoch. */
  at: number;
  /** 0 to 1. */
  accuracy: number;
  stars: number;
  hits: number;
  total: number;
  extras: number;
  bestStreak: number;
  /** "full" for the whole song, otherwise "a-b" (0-based played bars). */
  loop: string;
  /** Playback speed in percent. */
  speed: number;
}

export interface ScoreLog {
  history: ScoreRecord[];
  bests: Record<string, ScoreRecord>;
}

const KEY_PREFIX = "fretbook.scores.";
const HISTORY_LIMIT = 30;

export function loopKey(loop: { a: number; b: number } | null): string {
  return loop ? `${loop.a}-${loop.b}` : "full";
}

export function bestKey(loop: string, speed: number): string {
  return `${loop}@${Math.round(speed)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRecord(raw: unknown): ScoreRecord | null {
  if (!isRecord(raw)) return null;
  const numbers = ["at", "accuracy", "stars", "hits", "total", "extras", "bestStreak", "speed"];
  if (!numbers.every((key) => typeof raw[key] === "number" && Number.isFinite(raw[key])))
    return null;
  if (typeof raw.loop !== "string") return null;
  return raw as unknown as ScoreRecord;
}

export function parseScoreLog(raw: unknown): ScoreLog {
  const log: ScoreLog = { history: [], bests: {} };
  if (!isRecord(raw)) return log;
  if (Array.isArray(raw.history)) {
    for (const item of raw.history) {
      const record = parseRecord(item);
      if (record) log.history.push(record);
    }
  }
  if (isRecord(raw.bests)) {
    for (const [key, item] of Object.entries(raw.bests)) {
      const record = parseRecord(item);
      if (record) log.bests[key] = record;
    }
  }
  return log;
}

export function loadScores(songId: string): ScoreLog {
  try {
    const raw =
      typeof localStorage === "undefined" ? null : localStorage.getItem(KEY_PREFIX + songId);
    return parseScoreLog(raw ? JSON.parse(raw) : null);
  } catch {
    return { history: [], bests: {} };
  }
}

export function personalBest(log: ScoreLog, loop: string, speed: number): ScoreRecord | null {
  return log.bests[bestKey(loop, speed)] ?? null;
}

/** Adds a result to the log. `isBest` is true when it beat (or set) the best for its loop and speed. */
export function addScore(
  log: ScoreLog,
  record: ScoreRecord,
): { log: ScoreLog; isBest: boolean; previous: ScoreRecord | null } {
  const key = bestKey(record.loop, record.speed);
  const previous = log.bests[key] ?? null;
  const isBest = previous === null || record.accuracy > previous.accuracy;
  return {
    log: {
      history: [record, ...log.history].slice(0, HISTORY_LIMIT),
      bests: isBest ? { ...log.bests, [key]: record } : log.bests,
    },
    isBest,
    previous,
  };
}

/** Saves a finished run. The practice log gets the session's time and score from the player. */
export function recordScore(
  songId: string,
  record: ScoreRecord,
): { log: ScoreLog; isBest: boolean; previous: ScoreRecord | null } {
  const result = addScore(loadScores(songId), record);
  try {
    if (typeof localStorage !== "undefined")
      localStorage.setItem(KEY_PREFIX + songId, JSON.stringify(result.log));
  } catch {
    // Private mode or a full quota: the result just does not stick.
  }
  return result;
}
