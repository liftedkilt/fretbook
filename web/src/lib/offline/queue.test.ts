import { describe, expect, it } from "vitest";

import { readQueue, withEdit, writeQueue, type QueuedEdit } from "./queue";

function memory(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

const edit = (songId: string, revision: number, title = "Song"): QueuedEdit => ({
  songId,
  title,
  body: { title, artist: "", revision, chordpro: "{title: x}" },
  queuedAt: "2026-01-01T00:00:00Z",
  state: "pending",
  message: "",
});

describe("queue storage", () => {
  it("round-trips and clears", () => {
    const storage = memory();
    expect(readQueue(storage)).toEqual([]);
    writeQueue([edit("a", 3)], storage);
    expect(readQueue(storage)).toEqual([edit("a", 3)]);
    writeQueue([], storage);
    expect(storage.length).toBe(0);
  });

  it("ignores damaged or foreign data", () => {
    expect(readQueue(memory({ "fretbook.offline.queue.v1": "{nope" }))).toEqual([]);
    expect(readQueue(memory({ "fretbook.offline.queue.v1": '{"a":1}' }))).toEqual([]);
    expect(
      readQueue(
        memory({ "fretbook.offline.queue.v1": JSON.stringify([{ songId: 1 }, edit("a", 1)]) }),
      ),
    ).toEqual([edit("a", 1)]);
    expect(readQueue(null)).toEqual([]);
  });

  it("refuses to pretend it stored something when there is no storage", () => {
    expect(() => writeQueue([edit("a", 1)], null)).toThrow();
  });
});

describe("withEdit", () => {
  it("replaces an earlier edit to the same song but keeps the revision the server last agreed on", () => {
    const first = edit("a", 3, "One");
    const other = edit("b", 7);
    const later = edit("a", 4, "Two");
    const next = withEdit([first, other], later);
    expect(next.map((item) => item.songId)).toEqual(["b", "a"]);
    const kept = next.find((item) => item.songId === "a")!;
    expect(kept.body.title).toBe("Two");
    expect(kept.body.revision).toBe(3);
  });

  it("adds an edit to a song that has none", () => {
    expect(withEdit([], edit("a", 1))).toEqual([edit("a", 1)]);
  });
});
