import { describe, expect, it } from "vitest";
import { sideNavIds, tabBarIds } from "./nav";
import { lessonsEnabled } from "./ui.svelte";

describe("lessonsEnabled", () => {
  it("is off unless the user opted in", () => {
    expect(lessonsEnabled(null)).toBe(false);
    expect(lessonsEnabled({ settings: {} })).toBe(false);
    expect(lessonsEnabled({ settings: { lessons_enabled: false } })).toBe(false);
    expect(lessonsEnabled({ settings: { lessons_enabled: true } })).toBe(true);
  });
});

describe("shell destinations", () => {
  it("hides Lessons by default", () => {
    expect(sideNavIds(false)).toEqual(["practice", "library", "setlists", "tools"]);
    expect(tabBarIds(false)).toEqual(["practice", "library", "setlists", "tools"]);
  });
  it("shows Lessons when enabled", () => {
    expect(sideNavIds(true)).toContain("lessons");
    expect(tabBarIds(true)).toEqual(["practice", "library", "lessons", "tools"]);
  });
});
