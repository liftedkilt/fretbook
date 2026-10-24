import { describe, expect, it } from "vitest";

import type { WaitStep } from "./wait";
import { waitFocus } from "./waitFretboard";

const step = (kind: WaitStep["kind"]): WaitStep => ({
  bar: 0,
  position: 0,
  tick: 0,
  kind,
  midis: [28],
  string: 3,
  fret: 0,
});

describe("waitFocus", () => {
  it("marks the expected string and fret while waiting", () => {
    expect(waitFocus(step("note"), "waiting", false)).toEqual({
      notes: [{ string: 3, fret: 0 }],
      tone: "wait",
    });
  });

  it("switches to the hint tone after the hint delay", () => {
    expect(waitFocus(step("note"), "waiting", true)?.tone).toBe("hint");
  });

  it("turns to the hit tone on the note just played", () => {
    expect(waitFocus(step("note"), "hit", false)?.tone).toBe("hit");
  });

  it("shows nothing when idle, done, without a step, or for chords and dead notes", () => {
    expect(waitFocus(step("note"), "idle", false)).toBeNull();
    expect(waitFocus(step("note"), "done", false)).toBeNull();
    expect(waitFocus(null, "waiting", false)).toBeNull();
    expect(waitFocus(step("chord"), "waiting", false)).toBeNull();
    expect(waitFocus(step("dead"), "waiting", false)).toBeNull();
  });
});
