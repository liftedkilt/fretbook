import { describe, expect, it } from "vitest";

import { rangeFillPercent } from "./rangeFill";

describe("rangeFillPercent", () => {
  it("uses 0 and 100 when min and max are empty", () => {
    expect(rangeFillPercent("", "", "50")).toBe(50);
    expect(rangeFillPercent("   ", "   ", "25")).toBe(25);
  });

  it("returns 0 when a bound or the value is not a number", () => {
    expect(rangeFillPercent("no", "10", "1")).toBe(0);
    expect(rangeFillPercent("0", "no", "1")).toBe(0);
    expect(rangeFillPercent("0", "10", "no")).toBe(0);
  });

  it("returns 0 when the range has no width", () => {
    expect(rangeFillPercent("5", "5", "5")).toBe(0);
  });

  it("measures the value between min and max", () => {
    expect(rangeFillPercent("0", "200", "50")).toBe(25);
    expect(rangeFillPercent("0", "10", "10")).toBe(100);
    expect(rangeFillPercent(" 0 ", " 10 ", "2")).toBe(20);
  });
});
