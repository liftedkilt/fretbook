import { describe, expect, it } from "vitest";

import { flatSyncPoints, measureAt, measureStarts } from "./sync";

describe("measureStarts", () => {
  it("matches the original even-bar, one-anchor, and two-anchor vectors", () => {
    expect(measureStarts(4, 120, {})).toEqual([0, 2, 4, 6, 8]);
    expect(measureStarts(4, 120, { 2: 10 })).toEqual([6, 8, 10, 12, 14]);
    expect(measureStarts(4, 120, { 1: 5, 3: 11 })).toEqual([3, 5, 8, 11, 14]);
  });

  it("looks up the measure the same way as the Python port", () => {
    const starts = measureStarts(2, 60, { 0: 1, 2: 5 });
    expect(starts).toEqual([1, 3, 5]);
    expect(measureAt(starts, 0.5)).toBe(-1);
    expect(measureAt(starts, 1)).toBe(0);
    expect(measureAt(starts, 3)).toBe(1);
    expect(measureAt(starts, 5)).toBe(2);
  });

  it("places a sync point at the end of the last bar", () => {
    const { points, shiftMs } = flatSyncPoints([0, 2, 4]);
    expect(shiftMs).toBe(0);
    expect(points.at(-1)).toMatchObject({ barIndex: 1, barPosition: 1, millisecondOffset: 4000 });
  });
});
