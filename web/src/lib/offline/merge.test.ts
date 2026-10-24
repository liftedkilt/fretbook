import { describe, expect, it } from "vitest";

import { chainBase, contentKey, mergeOnto, type EditBase } from "./merge";
import type { ScoreDocument } from "../types";

const bar = () => ({ signature: [4, 4] as [number, number], extras: {} });
const doc = (bars: number, bpm = 100, points: (number | null)[] = []): ScoreDocument =>
  ({
    bpm,
    bars: Array.from({ length: bars }, bar),
    tracks: [{ id: "t", bars: [] }],
    sync: { video_id: "v", points, anchors: {}, keyed_by: "played" },
  }) as unknown as ScoreDocument;

const base = (loaded: ScoreDocument, origin: (number | null)[]): EditBase => ({
  content: contentKey(loaded),
  bpm: loaded.bpm,
  origin,
});

describe("mergeOnto", () => {
  it("keeps the newer sync marks and BPM when only those moved", () => {
    const loaded = doc(2, 100);
    const latest = doc(2, 120, [1, 2]);
    const merged = mergeOnto(latest, doc(2, 100), base(loaded, [0, 1]));
    expect(merged?.bpm).toBe(120);
    expect(merged?.sync.points).toEqual([1, 2]);
  });

  it("keeps the edit's own BPM when it changed it", () => {
    const loaded = doc(2, 100);
    const merged = mergeOnto(doc(2, 120), doc(2, 90), base(loaded, [0, 1]));
    expect(merged?.bpm).toBe(90);
  });

  it("re-keys the newer sync marks to the bars as edited", () => {
    const loaded = doc(2, 100);
    const edited = doc(3, 100); // a bar added in the middle
    const merged = mergeOnto(doc(2, 100, [1, 2]), edited, base(loaded, [0, null, 1]));
    expect(merged?.sync.points).toEqual([1, null, 2]);
    expect(merged?.bars).toHaveLength(3);
  });

  it("gives up when the bars or tracks changed", () => {
    const loaded = doc(2);
    expect(mergeOnto(doc(3), doc(2), base(loaded, [0, 1]))).toBeNull();
  });
});

describe("chainBase", () => {
  it("keeps the earlier content and BPM, and follows the origins back", () => {
    const earlier = { content: "a", bpm: 100, origin: [0, null, 1] };
    const later = { content: "b", bpm: 100, origin: [0, 1, 2, null] };
    expect(chainBase(earlier, later)).toEqual({
      content: "a",
      bpm: 100,
      origin: [0, null, 1, null],
    });
  });
});
