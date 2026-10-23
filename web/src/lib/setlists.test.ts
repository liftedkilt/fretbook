import { describe, expect, it } from "vitest";

import {
  clampTranspose,
  moveItem,
  neighbour,
  playIndex,
  playPath,
  reorderKey,
  setlistPath,
  stepForKey,
  toDrafts,
  transposeLabel,
} from "./setlists";
import type { SetlistEntry } from "./types";

const keys = { altKey: true, ctrlKey: false, metaKey: false };

describe("moveItem", () => {
  it("moves an item forward and back without changing the original", () => {
    const list = ["a", "b", "c", "d"];
    expect(moveItem(list, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(list, 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(list).toEqual(["a", "b", "c", "d"]);
  });

  it("clamps the target and ignores a missing source", () => {
    expect(moveItem(["a", "b", "c"], 1, 99)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b", "c"], 1, -5)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b"], 5, 0)).toEqual(["a", "b"]);
    expect(moveItem([], 0, 0)).toEqual([]);
  });
});

describe("transpose", () => {
  it("clamps to a sensible range and rounds", () => {
    expect(clampTranspose(30)).toBe(11);
    expect(clampTranspose(-30)).toBe(-11);
    expect(clampTranspose(2.6)).toBe(3);
    expect(clampTranspose(Number.NaN)).toBe(0);
  });

  it("labels the sign", () => {
    expect(transposeLabel(2)).toBe("+2");
    expect(transposeLabel(-3)).toBe("-3");
    expect(transposeLabel(0)).toBe("0");
  });
});

describe("play-through addresses", () => {
  it("counts positions from 1 in the address and from 0 in code", () => {
    expect(setlistPath("abc")).toBe("/setlists/abc");
    expect(playPath("abc", 0)).toBe("/setlists/abc/play/1");
    expect(playIndex("3", 5)).toBe(2);
  });

  it("falls back to a valid entry", () => {
    expect(playIndex(undefined, 4)).toBe(0);
    expect(playIndex("nope", 4)).toBe(0);
    expect(playIndex("99", 4)).toBe(3);
    expect(playIndex("0", 4)).toBe(0);
    expect(playIndex("2", 0)).toBe(0);
  });

  it("finds the next and previous entry, and stops at the ends", () => {
    expect(neighbour(1, 3, 1)).toBe(2);
    expect(neighbour(1, 3, -1)).toBe(0);
    expect(neighbour(2, 3, 1)).toBeNull();
    expect(neighbour(0, 3, -1)).toBeNull();
  });
});

describe("keys", () => {
  it("steps with Alt and the left or right arrow", () => {
    expect(stepForKey({ ...keys, key: "ArrowRight" })).toBe(1);
    expect(stepForKey({ ...keys, key: "ArrowLeft" })).toBe(-1);
    expect(stepForKey({ ...keys, key: "x" })).toBeNull();
    expect(stepForKey({ ...keys, altKey: false, key: "ArrowRight" })).toBeNull();
    expect(stepForKey({ ...keys, ctrlKey: true, key: "ArrowRight" })).toBeNull();
  });

  it("reorders with Alt and the up or down arrow", () => {
    expect(reorderKey({ ...keys, key: "ArrowDown" })).toBe(1);
    expect(reorderKey({ ...keys, key: "ArrowUp" })).toBe(-1);
    expect(reorderKey({ ...keys, key: "ArrowLeft" })).toBeNull();
    expect(reorderKey({ ...keys, altKey: false, key: "ArrowUp" })).toBeNull();
    expect(reorderKey({ ...keys, metaKey: true, key: "ArrowUp" })).toBeNull();
  });
});

describe("toDrafts", () => {
  it("keeps only what is saved", () => {
    const entry: SetlistEntry = {
      id: "e1",
      song_id: "s1",
      note: "capo 2",
      transpose: 2,
      title: "T",
      artist: "A",
      content_kind: "chords",
      preferred_instrument: "",
      string_count: 0,
    };
    expect(toDrafts([entry])).toEqual([{ song_id: "s1", note: "capo 2", transpose: 2 }]);
  });
});
