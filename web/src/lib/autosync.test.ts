import { describe, expect, it } from "vitest";

import {
  barsToCheck,
  clampBar,
  confidencePercent,
  dueClicks,
  firstClickAt,
  firstMarkedBar,
  parseStartTime,
  previewClicks,
  proposedStarts,
  pulses,
} from "./autosync";
import type { AutoSyncProposal, Bar, ScoreDocument } from "./types";

function bar(signature: [number, number], extra: Partial<Bar> = {}): Bar {
  return {
    signature,
    tempo: null,
    repeat_start: false,
    repeat_end: 0,
    alternate_endings: [],
    directions: [],
    section: null,
    extras: {},
    ...extra,
  } as Bar;
}

function document(bars: Bar[], bpm = 120): ScoreDocument {
  return {
    version: 1,
    bpm,
    bars,
    tracks: [],
    sync: { video_id: null, points: [], anchors: {}, keyed_by: "played" },
  } as unknown as ScoreDocument;
}

describe("pulses", () => {
  it("counts beats, and dotted quarters in compound time", () => {
    expect(pulses([4, 4])).toBe(4);
    expect(pulses([3, 4])).toBe(3);
    expect(pulses([6, 8])).toBe(2);
    expect(pulses([12, 8])).toBe(4);
    expect(pulses([7, 8])).toBe(7);
    expect(pulses([3, 8])).toBe(3);
  });
});

describe("previewClicks", () => {
  it("accents each bar start and spreads the beats between the proposed marks", () => {
    const score = document([bar([4, 4]), bar([2, 4])]);
    const clicks = previewClicks(score, { "0": 1, "1": 3, "2": 4 });
    expect(clicks.map((click) => click.time)).toEqual([1, 1.5, 2, 2.5, 3, 3.5]);
    expect(clicks.map((click) => click.accent)).toEqual([true, false, false, false, true, false]);
    expect(clicks.map((click) => click.bar)).toEqual([0, 0, 0, 0, 1, 1]);
  });

  it("follows repeats: the played bars, not the written ones", () => {
    const score = document([bar([2, 4], { repeat_start: true, repeat_end: 2 })]);
    const starts = proposedStarts(score, { "0": 0, "1": 2, "2": 4 });
    expect(starts).toEqual([0, 2, 4]);
    expect(previewClicks(score, { "0": 0, "1": 2, "2": 4 })).toHaveLength(4);
  });

  it("drops clicks that would fall before the start of the audio", () => {
    const score = document([bar([4, 4])]);
    const clicks = previewClicks(score, { "0": 0.5, "1": 2.5 });
    expect(clicks[0].time).toBe(0.5);
    expect(previewClicks(score, { "1": 1 }).every((click) => click.time >= 0)).toBe(true);
  });
});

describe("dueClicks", () => {
  const clicks = [0, 0.5, 1, 1.5, 2].map((time, index) => ({ time, accent: index === 0, bar: 0 }));

  it("returns the clicks inside the look-ahead window and advances the cursor", () => {
    const first = dueClicks(clicks, 0, 0.4, 0.2);
    expect(first.due.map((click) => click.time)).toEqual([0.5]);
    expect(first.cursor).toBe(2);
    expect(dueClicks(clicks, first.cursor, 0.45, 0.2).due).toEqual([]);
  });

  it("skips clicks that are already well in the past instead of playing them in a burst", () => {
    const result = dueClicks(clicks, 0, 1.2, 0.1);
    expect(result.due.map((click) => click.time)).toEqual([]);
    expect(result.cursor).toBe(3);
  });

  it("finds where to start from after a seek", () => {
    expect(firstClickAt(clicks, 0.6)).toBe(2);
    expect(firstClickAt(clicks, 0)).toBe(0);
    expect(firstClickAt(clicks, 9)).toBe(5);
  });
});

describe("proposal summary", () => {
  const proposal: AutoSyncProposal = {
    anchors: { "0": 1, "1": 3, "2": 5, "3": 7 },
    confidence: { "0": 0.9, "1": 0.3, "2": 0.8, "3": 0.2 },
    overall: 0.675,
    tempo_bpm: 120,
    beat_count: 12,
    audio_seconds: 8,
    low_confidence: [1],
  };

  it("rounds the overall confidence to a percentage", () => {
    expect(confidencePercent(proposal)).toBe(68);
    expect(confidencePercent({ ...proposal, overall: 1.4 })).toBe(100);
  });

  it("lists the bars to check, one-based and in order", () => {
    expect(barsToCheck(proposal)).toEqual([2]);
    expect(barsToCheck({ ...proposal, low_confidence: [5, 1] })).toEqual([2, 6]);
    expect(barsToCheck({ ...proposal, low_confidence: [] })).toEqual([]);
  });

  it("keeps a chosen starting bar inside the song", () => {
    expect(clampBar(1, 8)).toBe(0);
    expect(clampBar(5, 8)).toBe(4);
    expect(clampBar(99, 8)).toBe(7);
    expect(clampBar(Number.NaN, 8)).toBe(0);
    expect(clampBar(-3, 8)).toBe(0);
  });
});

describe("parseStartTime", () => {
  it("reads seconds, minutes and seconds, and a blank as the first sound", () => {
    expect(parseStartTime("")).toBeNull();
    expect(parseStartTime("  ")).toBeNull();
    expect(parseStartTime("12.5")).toBe(12.5);
    expect(parseStartTime("12,5")).toBe(12.5);
    expect(parseStartTime("1:05")).toBe(65);
    expect(parseStartTime("0:12.5")).toBe(12.5);
  });

  it("refuses text that is not a time", () => {
    for (const text of ["soon", "-3", "1:2:3", "1e3", "99999"]) {
      expect(parseStartTime(text)).toBeUndefined();
    }
  });
});

describe("firstMarkedBar", () => {
  it("is the lowest bar with a mark", () => {
    const proposal = { anchors: { "4": 1, "2": 0.5, "9": 3 } } as unknown as AutoSyncProposal;
    expect(firstMarkedBar(proposal)).toBe(2);
    expect(firstMarkedBar({ anchors: {} } as unknown as AutoSyncProposal)).toBe(0);
  });
});
