import { describe, expect, it } from "vitest";
import { isAudioFile } from "./audioFile";

describe("isAudioFile", () => {
  it("accepts audio by type or by extension", () => {
    expect(isAudioFile({ name: "x", type: "audio/mpeg" })).toBe(true);
    expect(isAudioFile({ name: "Take 1.M4A", type: "" })).toBe(true);
  });

  it("rejects other files", () => {
    expect(isAudioFile({ name: "tab.txt", type: "text/plain" })).toBe(false);
    expect(isAudioFile({ name: "song.gp5", type: "" })).toBe(false);
  });
});
