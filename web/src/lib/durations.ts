/** Note values in ticks (960 per quarter, as in alphaTab and `fretbook/score/model.py`). */

export const TICKS_PER_QUARTER = 960;
export const WHOLE = 4 * TICKS_PER_QUARTER;

/** alphaTex duration token and ticks for each plain note value. */
export const VALUES = [
  { token: 1, ticks: WHOLE },
  { token: 2, ticks: WHOLE / 2 },
  { token: 4, ticks: WHOLE / 4 },
  { token: 8, ticks: WHOLE / 8 },
  { token: 16, ticks: WHOLE / 16 },
  { token: 32, ticks: WHOLE / 32 },
  { token: 64, ticks: WHOLE / 64 },
] as const;

/** `actual` notes in the time of `normal`: 3:2, 5:4, 6:4, 7:4, 2:3. Matches `techniques.tuplet_ratio`. */
export function tupletRatio(actual: number): [number, number] {
  if (actual === 2) return [2, 3];
  let normal = 1;
  while (normal * 2 < actual) normal *= 2;
  return [actual, normal];
}

export interface Notation {
  token: number;
  dots: number;
  tuplet: number | null;
  /** Ticks this notation actually takes. Equal to the input unless nothing matched exactly. */
  ticks: number;
}

const DOTS = [
  { dots: 0, factor: 1 },
  { dots: 1, factor: 1.5 },
  { dots: 2, factor: 1.75 },
];

function candidates(tuplet: number | null): Notation[] {
  const [actual, normal] = tuplet ? tupletRatio(tuplet) : [1, 1];
  return VALUES.flatMap((value) =>
    DOTS.map(({ dots, factor }) => ({
      token: value.token,
      dots,
      tuplet,
      ticks: Math.round((value.ticks * factor * normal) / actual),
    })),
  );
}

/**
 * Exact notation for a duration: the tuplet hint first, then plain, dotted,
 * and common tuplets. Falls back to the nearest plain or dotted value.
 */
export function notation(ticks: number, hint: number | null = null): Notation {
  const tuplets = [hint, null, 3, 5, 6, 7, 9].filter(
    (item, index, all) => all.indexOf(item) === index,
  );
  for (const tuplet of tuplets) {
    const found = candidates(tuplet).find((item) => Math.abs(item.ticks - ticks) <= 1);
    if (found) return { ...found, ticks };
  }
  let best = candidates(null)[0];
  for (const item of candidates(null)) {
    if (Math.abs(item.ticks - ticks) < Math.abs(best.ticks - ticks)) best = item;
  }
  return best;
}

/** Durations offered by the editor, longest first. */
export const EDITOR_DURATIONS: { ticks: number; tuplet: number | null; key: string }[] = [
  { ticks: WHOLE, tuplet: null, key: "whole" },
  { ticks: (WHOLE * 3) / 4, tuplet: null, key: "dottedHalf" },
  { ticks: WHOLE / 2, tuplet: null, key: "half" },
  { ticks: (WHOLE * 3) / 8, tuplet: null, key: "dottedQuarter" },
  { ticks: WHOLE / 4, tuplet: null, key: "quarter" },
  { ticks: WHOLE / 6, tuplet: 3, key: "quarterTriplet" },
  { ticks: (WHOLE * 3) / 16, tuplet: null, key: "dottedEighth" },
  { ticks: WHOLE / 8, tuplet: null, key: "eighth" },
  { ticks: WHOLE / 12, tuplet: 3, key: "eighthTriplet" },
  { ticks: WHOLE / 16, tuplet: null, key: "sixteenth" },
  { ticks: WHOLE / 24, tuplet: 3, key: "sixteenthTriplet" },
  { ticks: WHOLE / 32, tuplet: null, key: "thirtySecond" },
];

export function barTicks(signature: [number, number]): number {
  return (WHOLE * signature[0]) / signature[1];
}
