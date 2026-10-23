import { describe, expect, it } from "vitest";

import { barSeconds, flatSyncPoints, measureAt, measureStarts, moveAnchor, remapSync } from "./sync";
import type { ScoreDocument } from "./types";

describe("measureStarts", () => {
  it("matches the Python vectors", () => {
    const even = [2, 2, 2, 2];
    expect(measureStarts(even, {})).toEqual([0, 2, 4, 6, 8]);
    expect(measureStarts(even, { 2: 10 })).toEqual([6, 8, 10, 12, 14]);
    expect(measureStarts(even, { 1: 5, 3: 11 })).toEqual([3, 5, 8, 11, 14]);
    expect(measureStarts([3, 3, 3], {})).toEqual([0, 3, 6, 9]);
    expect(measureStarts([4, 2, 2], { 0: 0, 3: 16 })).toEqual([0, 8, 12, 16]);
  });

  it("looks up the bar the same way as the Python port", () => {
    const starts = measureStarts([2, 2], { 0: 1, 2: 5 });
    expect(starts).toEqual([1, 3, 5]);
    expect(measureAt(starts, 0.5)).toBe(-1);
    expect(measureAt(starts, 1)).toBe(0);
    expect(measureAt(starts, 3)).toBe(1);
    expect(measureAt(starts, 5)).toBe(2);
  });

  it("uses each bar's signature and tempo", () => {
    const document = {
      bpm: 60,
      bars: [{ signature: [4, 4] }, { signature: [3, 4] }, { signature: [6, 8], tempo: 120 }],
    } as unknown as ScoreDocument;
    expect(barSeconds(document)).toEqual([4, 3, 1.5]);
  });

  it("places a sync point at the end of the last bar", () => {
    const { points, shiftMs } = flatSyncPoints([0, 2, 4]);
    expect(shiftMs).toBe(0);
    expect(points.at(-1)).toMatchObject({ barIndex: 1, barPosition: 1, millisecondOffset: 4000 });
  });
});

describe("remapSync", () => {
  it("follows inserted and deleted bars", () => {
    const sync = { video_id: "x", points: [0, 2, 4, 6], anchors: { "1": 2.1, "3": 6.2 } };
    // Bar 0 deleted, a new bar inserted after the old bar 2.
    const next = remapSync(sync, [1, 2, null, 3]);
    expect(next.anchors).toEqual({ "0": 2.1, "3": 6.2 });
    expect(next.points).toEqual([2, 4, null, 6]);
  });
});

describe("moveAnchor", () => {
  it("moves later anchors with the tapped bar and leaves earlier ones", () => {
    const anchors = { "0": 1, "1": 3, "2": 5, "3": 7 };
    expect(moveAnchor(anchors, [1, 3, 5, 7, 9], 1, 6.5)).toEqual({ "0": 1, "1": 6.5, "2": 8.5, "3": 10.5 });
  });

  it("measures the shift from the bar's current start when it has no anchor yet", () => {
    expect(moveAnchor({ "0": 0, "4": 8 }, [0, 2, 4, 6, 8], 2, 5)).toEqual({ "0": 0, "2": 5, "4": 9 });
  });
});
