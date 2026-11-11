// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { EDITOR_SHORTCUTS, editorShortcutFor, ownsUndo } from "./shortcuts";

const press = (key: string, extra: Partial<Parameters<typeof editorShortcutFor>[0]> = {}) =>
  editorShortcutFor({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...extra,
  });

describe("editor shortcuts", () => {
  it("maps Ctrl or Cmd with Z, Shift Z and Y to undo and redo", () => {
    expect(press("z", { ctrlKey: true })).toBe("undo");
    expect(press("z", { metaKey: true })).toBe("undo");
    expect(press("Z", { ctrlKey: true, shiftKey: true })).toBe("redo");
    expect(press("z", { metaKey: true, shiftKey: true })).toBe("redo");
    expect(press("y", { ctrlKey: true })).toBe("redo");
  });

  it("ignores other keys and other modifiers", () => {
    expect(press("z")).toBeNull();
    expect(press("z", { ctrlKey: true, altKey: true })).toBeNull();
    expect(press("y", { metaKey: true })).toBeNull();
    expect(press("y", { ctrlKey: true, shiftKey: true })).toBeNull();
    expect(press("x", { ctrlKey: true })).toBeNull();
  });

  it("lists both for the help overlay", () => {
    expect(EDITOR_SHORTCUTS.map((item) => item.action)).toEqual(["undo", "redo"]);
  });

  it("leaves undo to the browser in text fields, unless they opt in", () => {
    const text = document.createElement("input");
    const number = document.createElement("input");
    number.type = "number";
    const box = document.createElement("input");
    box.type = "checkbox";
    const area = document.createElement("textarea");
    const shared = document.createElement("textarea");
    shared.dataset.editHistory = "";
    const editable = document.createElement("div");
    // jsdom does not compute isContentEditable, so set it as a browser would.
    Object.defineProperty(editable, "isContentEditable", { value: true });
    const button = document.createElement("button");

    expect(ownsUndo(text)).toBe(true);
    expect(ownsUndo(number)).toBe(true);
    expect(ownsUndo(area)).toBe(true);
    expect(ownsUndo(box)).toBe(false);
    expect(ownsUndo(shared)).toBe(false);
    expect(ownsUndo(button)).toBe(false);
    expect(ownsUndo(null)).toBe(false);
    expect(ownsUndo(window)).toBe(false);
    expect(ownsUndo(editable)).toBe(true);
  });
});
