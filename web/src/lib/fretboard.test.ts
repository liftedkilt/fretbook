import { describe, expect, it } from "vitest";

import {
  buildFretEvents,
  defaultRoot,
  dotLabel,
  dotPosition,
  eventIndexAt,
  focusAt,
  fretCount,
  fretPosition,
  intervalName,
  noteMidi,
  pitchClassName,
  playedBarTicks,
  positionInBar,
} from "./fretboard";
import type { ScoreDocument, Track } from "./types";

function bar(
  beats: { position: number; notes: { string: number; fret: number }[]; grace?: boolean }[],
) {
  return { voices: [{ beats: beats.map((beat) => ({ duration: 480, ...beat })) }] };
}

const track = {
  id: "t",
  name: "Bass",
  instrument: "bass",
  capo: 0,
  tuning_midi: [43, 38, 33, 28],
  preferred: true,
  bars: [
    bar([
      { position: 0, notes: [{ string: 3, fret: 3 }] },
      {
        position: 960,
        notes: [
          { string: 2, fret: 2 },
          { string: 1, fret: 0 },
        ],
      },
      { position: 960, notes: [{ string: 2, fret: 2 }] },
      { position: 1440, notes: [] },
    ]),
    bar([
      { position: 0, notes: [{ string: 0, fret: 14 }] },
      { position: 480, notes: [{ string: 0, fret: 1 }], grace: true },
    ]),
  ],
} as unknown as Track;

const document = {
  bars: [{ signature: [4, 4], repeat_start: true, repeat_end: 2 }, { signature: [4, 4] }],
  tracks: [track],
} as unknown as ScoreDocument;

describe("buildFretEvents", () => {
  const events = buildFretEvents(document, track);
  it("lists beats with notes in played order, merging duplicates and skipping rests and graces", () => {
    expect(events.map((e) => [e.bar, e.position, e.notes.length])).toEqual(
      expect.arrayContaining([
        [0, 0, 1],
        [0, 960, 2],
      ]),
    );
    expect(events.some((e) => e.position === 1440)).toBe(false);
    expect(events.some((e) => e.notes.some((n) => n.fret === 1 && n.string === 0))).toBe(false);
  });
  it("follows repeats", () => {
    const bars = events.map((e) => e.bar);
    expect(bars).toEqual([...bars].sort((a, b) => a - b));
    expect(Math.max(...bars)).toBeGreaterThan(1);
  });
});

describe("focusAt", () => {
  const events = buildFretEvents(document, track);
  it("is empty before the first note and previews it", () => {
    const focus = focusAt(events, 0, -1);
    expect(focus.current).toEqual([]);
    expect(focus.next[0].notes).toEqual([{ string: 3, fret: 3 }]);
  });
  it("lights the beat at or before the position and queues the next ones", () => {
    const focus = focusAt(events, 0, 1000, 2);
    expect(focus.current).toHaveLength(2);
    expect(focus.next).toHaveLength(2);
    expect(focus.next.map((n) => n.rank)).toEqual([1, 2]);
  });
  it("has nothing after the last beat", () => {
    const focus = focusAt(events, 99, 0);
    expect(focus.current.length).toBeGreaterThan(0);
    expect(focus.next).toEqual([]);
  });
  it("finds indexes", () => {
    expect(eventIndexAt([], 0, 0)).toBe(-1);
    expect(eventIndexAt(events, 0, 0)).toBe(0);
  });
});

describe("positionInBar", () => {
  it("interpolates and clamps", () => {
    expect(positionInBar([0, 2, 4], 0, 1, 3840)).toBe(1920);
    expect(positionInBar([0, 2, 4], 0, 9, 3840)).toBe(3840);
    expect(positionInBar([0, 2, 4], 5, 1, 3840)).toBe(0);
  });
  it("knows a played bar's length", () => {
    expect(playedBarTicks(document, 0)).toBe(3840);
    expect(playedBarTicks(document, 99)).toBe(0);
  });
});

describe("geometry", () => {
  it("spaces frets closer up the neck", () => {
    expect(fretPosition(0, 12)).toBe(0);
    expect(fretPosition(12, 12)).toBeCloseTo(1);
    expect(fretPosition(1, 12) - fretPosition(0, 12)).toBeGreaterThan(
      fretPosition(12, 12) - fretPosition(11, 12),
    );
    expect(fretPosition(1, 0)).toBe(0);
  });
  it("puts open strings before the nut and fretted notes between frets", () => {
    expect(dotPosition(0, 12)).toBeLessThan(0);
    expect(dotPosition(5, 12)).toBeGreaterThan(fretPosition(4, 12));
    expect(dotPosition(5, 12)).toBeLessThan(fretPosition(5, 12));
  });
  it("draws at least 12 frets and as many as the music needs, to 24", () => {
    expect(fretCount({ ...track, bars: [] } as Track)).toBe(12);
    expect(fretCount(track)).toBe(14);
    expect(fretCount(track, 15)).toBe(15);
  });
});

describe("labels", () => {
  it("names pitches and intervals", () => {
    expect(pitchClassName(61)).toBe("C#");
    expect(pitchClassName(-1)).toBe("B");
    expect(intervalName(67, 60)).toBe("5");
    expect(intervalName(59, 60)).toBe("7");
    expect(intervalName(60, 60)).toBe("R");
  });
  it("adds the capo when working out pitch", () => {
    expect(noteMidi(track.tuning_midi, 2, { string: 3, fret: 3 })).toBe(33);
  });
  it("picks the label for each mode", () => {
    expect(dotLabel("none", 40, 0, 4)).toBe("");
    expect(dotLabel("names", 40, 0, 4)).toBe("E");
    expect(dotLabel("intervals", 43, 3, 4)).toBe("b3");
    expect(dotLabel("frets", 43, 3, 4)).toBe("3");
  });
  it("uses the lowest string as the root", () => {
    expect(defaultRoot([64, 59, 55, 50, 45, 40])).toBe(4);
    expect(defaultRoot([])).toBe(0);
  });
});
