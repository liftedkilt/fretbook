import { describe, expect, it } from "vitest";

import { activeLibraryId, canEdit, sharePath, transferDestinations } from "./bands";

describe("bands", () => {
  it("treats only the view role as read-only", () => {
    expect(canEdit("edit")).toBe(true);
    expect(canEdit(undefined)).toBe(true);
    expect(canEdit("view")).toBe(false);
  });

  it("builds a one-segment share path", () => {
    expect(sharePath("sh_abc")).toBe("/share/sh_abc");
    expect(sharePath("sh_a/b")).toBe("/share/sh_ab");
  });

  it("uses the personal library when nothing is stored", () => {
    expect(activeLibraryId("", "local")).toBe("local");
    expect(activeLibraryId("  ", "local")).toBe("local");
    expect(activeLibraryId("band", "local")).toBe("band");
  });

  it("offers other editable libraries, personal first when the song is in a band", () => {
    const libraries = [
      { id: "local", role: "edit", kind: "personal" },
      { id: "band1", role: "edit", kind: "band" },
      { id: "band2", role: "edit", kind: "band" },
      { id: "band-view", role: "view", kind: "band" },
    ];
    expect(transferDestinations(libraries, "local").map((item) => item.id)).toEqual([
      "band1",
      "band2",
    ]);
    expect(transferDestinations(libraries, "band1").map((item) => item.id)).toEqual([
      "local",
      "band2",
    ]);
    expect(transferDestinations(libraries, "  ").map((item) => item.id)).toEqual([
      "local",
      "band1",
      "band2",
    ]);
  });
});
