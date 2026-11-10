import { describe, expect, it } from "vitest";

import { crashDetails } from "./crash";

describe("crashDetails", () => {
  it("names the error, the page and the version, then the stack", () => {
    const error = new TypeError("bars is undefined");
    error.stack = "TypeError: bars is undefined\n    at render (TabPlayer.svelte:10:3)";
    expect(crashDetails(error, "/songs/abc", "0.1.3")).toBe(
      "TypeError: bars is undefined\nPage: /songs/abc\nFretbook 0.1.3\nat render (TabPlayer.svelte:10:3)",
    );
  });

  it("keeps a stack that does not repeat the message", () => {
    const error = new Error("boom");
    error.stack = "render@TabPlayer.svelte:10:3";
    expect(crashDetails(error, "/", null)).toBe(
      "Error: boom\nPage: /\nrender@TabPlayer.svelte:10:3",
    );
  });

  it("describes a thrown value that is not an Error", () => {
    expect(crashDetails("nope", "/tools", null)).toBe("Error: nope\nPage: /tools");
  });
});
