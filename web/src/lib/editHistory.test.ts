import { describe, expect, it } from "vitest";

import { cursorAfterChange, EditHistory, HISTORY_LIMIT } from "./editHistory";

type State = { cells: string[] };

const at = (cells: string[]): State => ({ cells });

describe("EditHistory", () => {
  it("records changes and undoes and redoes them, with where each change was", () => {
    const history = new EditHistory<State, number>(at(["a"]), 0);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBeNull();

    expect(history.record(at(["b"]), 1)).toBe(true);
    expect(history.record(at(["b", "c"]), 2)).toBe(true);
    expect(history.canUndo).toBe(true);

    expect(history.undo()).toEqual({ state: at(["b"]), meta: 2 });
    expect(history.undo()).toEqual({ state: at(["a"]), meta: 1 });
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
    expect(history.redo()).toEqual({ state: at(["b"]), meta: 1 });
    expect(history.present).toEqual(at(["b"]));
  });

  it("ignores a record that changes nothing", () => {
    const history = new EditHistory<State, null>(at(["a"]), null);
    expect(history.record(at(["a"]), null)).toBe(false);
    expect(history.canUndo).toBe(false);
    expect(history.matches(at(["a"]))).toBe(true);
  });

  it("keeps its own copies, so later changes to the caller's objects do not leak in", () => {
    const state = at(["a"]);
    const history = new EditHistory<State, null>(state, null);
    state.cells.push("b");
    history.record(state, null);
    state.cells.push("c");
    expect(history.undo()?.state).toEqual(at(["a"]));
    expect(history.redo()?.state).toEqual(at(["a", "b"]));
  });

  it("drops what could be redone when a new change is made", () => {
    const history = new EditHistory<State, null>(at(["a"]), null);
    history.record(at(["b"]), null);
    history.undo();
    history.record(at(["c"]), null);
    expect(history.canRedo).toBe(false);
    expect(history.undo()?.state).toEqual(at(["a"]));
  });

  it("caps the number of steps", () => {
    const history = new EditHistory<State, null>(at(["0"]), null, { limit: 3 });
    for (const value of ["1", "2", "3", "4", "5"]) history.record(at([value]), null);
    const seen: string[] = [];
    let step = history.undo();
    while (step) {
      seen.push(step.state.cells[0]);
      step = history.undo();
    }
    expect(seen).toEqual(["4", "3", "2"]);
    expect(HISTORY_LIMIT).toBe(100);
  });

  it("groups a burst of edits to the same field into one step", () => {
    const history = new EditHistory<State, string>(at([""]), "start", { groupMs: 1000 });
    history.record(at(["1"]), "cell", { group: "cell", at: 1000 });
    history.record(at(["12"]), "cell", { group: "cell", at: 1500 });
    history.record(at(["123"]), "cell", { group: "cell", at: 2400 });
    expect(history.undo()).toEqual({ state: at([""]), meta: "cell" });
    expect(history.canUndo).toBe(false);
  });

  it("drops a grouped burst that ends where it started", () => {
    const history = new EditHistory<State, null>(at([""]), null);
    history.record(at(["x"]), null);
    history.record(at(["x", "1"]), null, { group: "cell", at: 0 });
    history.record(at(["x"]), null, { group: "cell", at: 10 });
    expect(history.present).toEqual(at(["x"]));
    expect(history.undo()?.state).toEqual(at([""]));
    expect(history.canUndo).toBe(false);
  });

  it("starts a new step after a pause, in another field, or without a group", () => {
    const history = new EditHistory<State, null>(at([""]), null, { groupMs: 1000 });
    history.record(at(["1"]), null, { group: "a", at: 0 });
    history.record(at(["12"]), null, { group: "a", at: 5000 });
    history.record(at(["12", "x"]), null, { group: "b", at: 5100 });
    history.record(at(["12", "y"]), null, { at: 5200 });
    history.record(at(["12", "z"]), null, { at: 5300 });
    const seen: State[] = [];
    let step = history.undo();
    while (step) {
      seen.push(step.state);
      step = history.undo();
    }
    expect(seen).toEqual([at(["12", "y"]), at(["12", "x"]), at(["12"]), at(["1"]), at([""])]);
  });

  it("does not fold an edit after an undo or a seal into the step before", () => {
    const history = new EditHistory<State, null>(at([""]), null);
    history.record(at(["1"]), null, { group: "a", at: 0 });
    history.record(at(["2"]), null, { group: "a", at: 10 });
    history.undo();
    history.redo();
    history.record(at(["3"]), null, { group: "a", at: 20 });
    expect(history.undo()?.state).toEqual(at(["2"]));

    history.record(at(["4"]), null, { group: "a", at: 30 });
    history.seal();
    history.record(at(["5"]), null, { group: "a", at: 40 });
    expect(history.undo()?.state).toEqual(at(["4"]));
  });

  it("uses the clock when no time is given", () => {
    const history = new EditHistory<State, null>(at([""]), null);
    history.record(at(["1"]), null, { group: "a" });
    history.record(at(["12"]), null, { group: "a" });
    expect(history.undo()?.state).toEqual(at([""]));
  });

  it("rewrites every step, replaces the present one, and resets", () => {
    const history = new EditHistory<State, null>(at(["a"]), null);
    history.record(at(["b"]), null);
    history.rewrite((state) => ({ cells: state.cells.map((cell) => cell.toUpperCase()) }));
    expect(history.present).toEqual(at(["B"]));
    history.replace(at(["B!"]), null);
    expect(history.matches(at(["B!"]))).toBe(true);
    expect(history.undo()?.state).toEqual(at(["A"]));
    expect(history.redo()?.state).toEqual(at(["B!"]));

    history.reset(at(["z"]), null);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.present).toEqual(at(["z"]));
  });
});

describe("cursorAfterChange", () => {
  it("puts the cursor at the end of the changed part", () => {
    expect(cursorAfterChange("hello world", "hello brave world")).toBe(12);
    expect(cursorAfterChange("hello brave world", "hello world")).toBe(6);
    expect(cursorAfterChange("abc", "abXc")).toBe(3);
    expect(cursorAfterChange("", "abc")).toBe(3);
    expect(cursorAfterChange("abc", "")).toBe(0);
    expect(cursorAfterChange("aaa", "aaaa")).toBe(4);
    expect(cursorAfterChange("same", "same")).toBe(4);
  });
});
