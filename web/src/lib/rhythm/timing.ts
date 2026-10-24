/** Scoring for the rhythm trainer: match played hits to expected ones and summarise the errors. */

export interface MatchResult {
  /** Per expected hit: the signed error in ms (positive is late), or null when it was missed. */
  errors: (number | null)[];
  /** Hits that matched no expected hit. */
  extra: number;
}

/** The widest error still counted as an attempt at a hit: under half the gap to its neighbours. */
export function matchWindow(expected: number[], maxMs = 150): number {
  let gap = Infinity;
  for (let i = 1; i < expected.length; i++) gap = Math.min(gap, expected[i] - expected[i - 1]);
  return Math.min(maxMs, gap * 0.5);
}

/**
 * Pairs each played hit with the nearest unmatched expected hit within `windowMs`.
 * Both lists are in ms on the same clock. A hit is matched at most once.
 */
export function matchHits(expected: number[], played: number[], windowMs: number): MatchResult {
  const errors: (number | null)[] = expected.map(() => null);
  let extra = 0;
  for (const time of [...played].sort((a, b) => a - b)) {
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < expected.length; i++) {
      if (errors[i] !== null) continue;
      const distance = Math.abs(time - expected[i]);
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    }
    if (best >= 0 && bestDistance <= windowMs) errors[best] = time - expected[best];
    else extra++;
  }
  return { errors, extra };
}

export type Tendency = "rushing" | "dragging" | "steady" | "none";

export interface TimingSummary {
  expected: number;
  hit: number;
  missed: number;
  extra: number;
  /** Mean signed error in ms; null with no hits. */
  meanMs: number | null;
  /** Spread (standard deviation) of the errors in ms. */
  spreadMs: number | null;
  /** Mean absolute error in ms. */
  absMs: number | null;
  tendency: Tendency;
}

/** A mean error beyond this many ms, in either direction, is called rushing or dragging. */
export const TENDENCY_THRESHOLD_MS = 8;

export function summarize(result: MatchResult): TimingSummary {
  const hits = result.errors.filter((e): e is number => e !== null);
  const base = {
    expected: result.errors.length,
    hit: hits.length,
    missed: result.errors.length - hits.length,
    extra: result.extra,
  };
  if (hits.length === 0) {
    return { ...base, meanMs: null, spreadMs: null, absMs: null, tendency: "none" };
  }
  const mean = hits.reduce((sum, e) => sum + e, 0) / hits.length;
  const variance = hits.reduce((sum, e) => sum + (e - mean) ** 2, 0) / hits.length;
  const abs = hits.reduce((sum, e) => sum + Math.abs(e), 0) / hits.length;
  const tendency: Tendency =
    mean <= -TENDENCY_THRESHOLD_MS
      ? "rushing"
      : mean >= TENDENCY_THRESHOLD_MS
        ? "dragging"
        : "steady";
  return {
    ...base,
    meanMs: mean,
    spreadMs: Math.sqrt(variance),
    absMs: abs,
    tendency,
  };
}

export interface HistogramBin {
  /** Bin centre in ms. */
  centerMs: number;
  count: number;
}

/**
 * Counts errors in bins of `binMs` across -range..+range. Errors beyond the range go in the
 * outer bins.
 */
export function histogram(errors: (number | null)[], range = 100, binMs = 20): HistogramBin[] {
  const bins: HistogramBin[] = [];
  const count = Math.round((range * 2) / binMs);
  for (let i = 0; i < count; i++) bins.push({ centerMs: -range + binMs * (i + 0.5), count: 0 });
  for (const error of errors) {
    if (error === null) continue;
    const index = Math.min(count - 1, Math.max(0, Math.floor((error + range) / binMs)));
    bins[index].count++;
  }
  return bins;
}

/** Corrects hits for latency: mic hits lag by the whole round trip, taps by about its output half. */
export function applyLatency(timeMs: number, latencyMs: number): number {
  return timeMs - latencyMs;
}
