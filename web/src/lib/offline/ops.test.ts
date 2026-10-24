import { describe, expect, it } from "vitest";

import { readOps, withOp, writeOps, type Op, type QueuedOp } from "./ops";

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

const item = (id: string, op: Op): QueuedOp => ({
  id,
  op,
  queuedAt: "2026-01-01T00:00:00Z",
  state: "pending",
  message: "",
});

describe("withOp", () => {
  it("replaces an earlier change to the same thing, keeping a sync's first revision", () => {
    let ops = withOp(
      [],
      item("1", { kind: "sync", songId: "a", revision: 3, bpm: 90, anchors: {} }),
    );
    ops = withOp(ops, item("2", { kind: "favourite", songId: "a", favourite: true }));
    ops = withOp(ops, item("3", { kind: "sync", songId: "a", revision: 5, bpm: 100, anchors: {} }));
    expect(ops.map((o) => o.id)).toEqual(["2", "3"]);
    expect(ops[1].op).toMatchObject({ revision: 3, bpm: 100 });
  });

  it("keeps every practice session", () => {
    const session = { kind: "practice", session: {} } as Op;
    expect(withOp(withOp([], item("1", session)), item("2", session))).toHaveLength(2);
  });
});

describe("readOps / writeOps", () => {
  it("round-trips, drops junk, and clears storage when empty", () => {
    const storage = memory();
    const ops = [item("1", { kind: "tags", songId: "a", tags: ["x"] })];
    writeOps(ops, storage);
    expect(readOps(storage)).toEqual(ops);
    storage.setItem("fretbook.offline.ops.v1", JSON.stringify([{ id: 1 }, ...ops]));
    expect(readOps(storage)).toEqual(ops);
    writeOps([], storage);
    expect(storage.length).toBe(0);
    expect(() => writeOps(ops, null)).toThrow();
  });
});
