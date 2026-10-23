import { describe, expect, it } from "vitest";

import { firstPlayed, followPlayed, occurrences, playedBars } from "./playback";
import type { Bar } from "./types";

function makeBar(partial: Partial<Bar> = {}): Bar {
  return {
    signature: [4, 4],
    tempo: null,
    repeat_start: false,
    repeat_end: 0,
    alternate_endings: [],
    directions: [],
    section: null,
    extras: {},
    ...partial,
  };
}

describe("playedBars", () => {
  it("plays linear bars without repeats", () => {
    const bars = [makeBar(), makeBar(), makeBar(), makeBar()];
    expect(playedBars(bars)).toEqual([0, 1, 2, 3]);
  });

  it("handles simple repeats", () => {
    const bars = [
      makeBar(),
      makeBar({ repeat_start: true }),
      makeBar({ repeat_end: 2 }),
      makeBar(),
    ];
    expect(playedBars(bars)).toEqual([0, 1, 2, 1, 2, 3]);
  });

  it("handles repeats playing three times", () => {
    const bars = [makeBar({ repeat_start: true }), makeBar({ repeat_end: 3 }), makeBar()];
    expect(playedBars(bars)).toEqual([0, 1, 0, 1, 0, 1, 2]);
  });

  it("handles implicit repeat start at the beginning of the song", () => {
    const bars = [makeBar(), makeBar({ repeat_end: 2 }), makeBar()];
    expect(playedBars(bars)).toEqual([0, 1, 0, 1, 2]);
  });

  it("handles alternate endings 1 and 2", () => {
    const bars = [
      makeBar(),
      makeBar({ repeat_start: true }),
      makeBar({ alternate_endings: [1], repeat_end: 2 }),
      makeBar({ alternate_endings: [2] }),
      makeBar(),
    ];
    expect(playedBars(bars)).toEqual([0, 1, 2, 1, 3, 4]);
  });

  it("handles multi-bar alternate endings", () => {
    const bars = [
      makeBar({ repeat_start: true }),
      makeBar({ alternate_endings: [1] }),
      makeBar({ repeat_end: 2 }),
      makeBar({ alternate_endings: [2] }),
      makeBar(),
    ];
    expect(playedBars(bars)).toEqual([0, 1, 2, 0, 3, 4]);
  });

  it("handles da capo al fine", () => {
    const bars = [
      makeBar(),
      makeBar({ directions: ["fine"] }),
      makeBar({ directions: ["da_capo_al_fine"] }),
    ];
    expect(playedBars(bars)).toEqual([0, 1, 2, 0, 1]);
  });

  it("handles dal segno al coda", () => {
    const bars = [
      makeBar(),
      makeBar({ directions: ["segno"] }),
      makeBar({ directions: ["da_coda"] }),
      makeBar({ directions: ["dal_segno_al_coda"] }),
      makeBar({ directions: ["coda"] }),
      makeBar(),
    ];
    expect(playedBars(bars)).toEqual([0, 1, 2, 3, 1, 2, 4, 5]);
  });

  it("handles dal segno al fine", () => {
    const bars = [
      makeBar(),
      makeBar({ directions: ["segno"] }),
      makeBar({ directions: ["fine"] }),
      makeBar({ directions: ["dal_segno_al_fine"] }),
    ];
    expect(playedBars(bars)).toEqual([0, 1, 2, 3, 1, 2]);
  });
});

describe("occurrences and firstPlayed helpers", () => {
  it("counts occurrences correctly", () => {
    const order = [0, 1, 2, 1, 3, 4];
    expect(occurrences(order)).toEqual([0, 0, 0, 1, 0, 0]);
  });

  it("finds the first played index of each written bar", () => {
    const order = [0, 1, 2, 1, 3, 4];
    expect(firstPlayed(order, 5)).toEqual([0, 1, 2, 4, 5]);
    expect(firstPlayed(order, 6)).toEqual([0, 1, 2, 4, 5, 6]);
  });

  it("tracks current played position across repeats with followPlayed", () => {
    const order = [0, 1, 2, 1, 2, 3];
    expect(followPlayed(order, 0, -1)).toBe(0);
    expect(followPlayed(order, 1, 0)).toBe(1);
    expect(followPlayed(order, 2, 1)).toBe(2);
    // When playback loops back to bar 1:
    expect(followPlayed(order, 1, 2)).toBe(3);
    expect(followPlayed(order, 2, 3)).toBe(4);
    expect(followPlayed(order, 3, 4)).toBe(5);
  });
});
