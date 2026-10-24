import { describe, expect, it } from "vitest";

import { activeLibraryId, canEdit, sharePath } from "./bands";

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
});
