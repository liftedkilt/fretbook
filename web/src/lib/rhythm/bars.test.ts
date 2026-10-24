import { describe, expect, it } from "vitest";

import type { ScoreDocument } from "../types";
import { barBreakdown, errorTone, songRhythms } from "./bars";
import { patternById } from "./patterns";

describe("barBreakdown", () => {
  it("splits the errors bar by bar so drift is visible", () => {
    const pattern = patternById("rests"); // x.x. : two hits a bar
    const rows = barBreakdown(pattern, 3, [-10, -20, 10, null, 40, 50]);
    expect(rows.map((r) => [r.hit, r.expected, r.meanMs])).toEqual([
      [2, 2, -15],
      [1, 2, 10],
      [2, 2, 45],
    ]);
    expect(rows[0].cells).toEqual([-10, undefined, -20, undefined]);
    expect(rows[1].cells).toEqual([10, undefined, null, undefined]);
  });

  it("has no mean for a bar where nothing was hit and treats missing errors as misses", () => {
    const rows = barBreakdown(patternById("rests"), 2, [null, null]);
    expect(rows[0].meanMs).toBeNull();
    expect(rows[1].hit).toBe(0);
    expect(rows[1].cells).toEqual([null, undefined, null, undefined]);
  });
});

describe("errorTone", () => {
  it("colours rests, misses, on-time, early and late hits", () => {
    expect(errorTone(undefined)).toBe("");
    expect(errorTone(null)).toBe("missed");
    expect(errorTone(25)).toBe("good");
    expect(errorTone(-60)).toBe("early");
    expect(errorTone(60)).toBe("late");
  });
});

function doc(bars: { signature: [number, number]; positions: number[]; tie?: boolean }[]) {
  return {
    version: 1,
    bpm: 100,
    bars: bars.map((b) => ({ signature: b.signature })),
    tracks: [
      {
        id: "t",
        name: "Guitar",
        instrument: "guitar",
        capo: 0,
        tuning_midi: [64],
        preferred: true,
        bars: bars.map((b) => ({
          voices: [
            {
              beats: b.positions.map((position) => ({
                position,
                duration: 480,
                notes: [{ string: 0, fret: 0, tie: b.tie }],
              })),
            },
          ],
        })),
      },
    ],
    sync: { video_id: null, points: [], anchors: {} },
  } as unknown as ScoreDocument;
}

describe("songRhythms", () => {
  it("turns bars into patterns on the coarsest grid and merges repeats", () => {
    const eighths = [0, 480, 960, 1440, 1920, 2400, 2880, 3360];
    const rhythms = songRhythms(
      doc([
        { signature: [4, 4], positions: [0, 960, 1920, 2880] },
        { signature: [4, 4], positions: eighths },
        { signature: [4, 4], positions: [0, 960, 1920, 2880] },
      ]),
      0,
    );
    expect(rhythms.map((r) => [r.pattern.grid, r.pattern.cells, r.firstBar, r.count])).toEqual([
      [1, "xxxx", 1, 2],
      [2, "xxxxxxxx", 2, 1],
    ]);
    expect(rhythms[0].pattern.beats).toBe(4);
  });

  it("finds triplets and other time signatures, and skips empty or off-grid bars", () => {
    const rhythms = songRhythms(
      doc([
        { signature: [3, 4], positions: [0, 320, 640, 960] },
        { signature: [4, 4], positions: [] },
        { signature: [4, 4], positions: [0, 130] },
        { signature: [4, 4], positions: [0, 480], tie: true },
        { signature: [7, 8], positions: [0] },
      ]),
      0,
    );
    expect(rhythms).toHaveLength(1);
    expect(rhythms[0].pattern).toMatchObject({ beats: 3, grid: 3, cells: "xxxx....." });
  });

  it("returns nothing for a track that does not exist", () => {
    expect(songRhythms(doc([]), 3)).toEqual([]);
  });
});
