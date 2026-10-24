import { describe, expect, it } from "vitest";
import { formatDuration } from "./practiceText";

describe("formatDuration", () => {
  it("writes seconds, minutes, and hours with padded minutes", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(12 * 60)).toBe("12m");
    expect(formatDuration(3600 + 5 * 60)).toBe("1h 05m");
    expect(formatDuration(2 * 3600 + 30 * 60)).toBe("2h 30m");
  });
});
