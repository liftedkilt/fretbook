import { describe, expect, it } from "vitest";

import { applyLatency, histogram, matchHits, matchWindow, summarize } from "./timing";

describe("matchWindow", () => {
  it("is under half the smallest gap and capped", () => {
    expect(matchWindow([0, 200, 400])).toBe(100);
    expect(matchWindow([0, 2000])).toBe(150);
    expect(matchWindow([0])).toBe(150);
  });
});

describe("matchHits", () => {
  it("pairs hits with the nearest expected hit and signs the error", () => {
    const result = matchHits([0, 500, 1000], [-10, 530, 1000], 100);
    expect(result.errors).toEqual([-10, 30, 0]);
    expect(result.extra).toBe(0);
  });

  it("counts misses and extra hits", () => {
    const result = matchHits([0, 500, 1000], [5, 700, 1005], 100);
    expect(result.errors).toEqual([5, null, 5]);
    expect(result.extra).toBe(1);
  });

  it("matches a hit only once", () => {
    const result = matchHits([0, 500], [0, 10], 100);
    expect(result.errors).toEqual([0, null]);
    expect(result.extra).toBe(1);
  });
});

describe("summarize", () => {
  it("calls an early player rushing", () => {
    const summary = summarize({ errors: [-20, -30, -10, null], extra: 1 });
    expect(summary.hit).toBe(3);
    expect(summary.missed).toBe(1);
    expect(summary.extra).toBe(1);
    expect(summary.meanMs).toBeCloseTo(-20);
    expect(summary.tendency).toBe("rushing");
  });

  it("calls a late player dragging", () => {
    expect(summarize({ errors: [20, 30, 10], extra: 0 }).tendency).toBe("dragging");
  });

  it("calls a centred player steady and reports spread", () => {
    const summary = summarize({ errors: [-10, 10, -10, 10], extra: 0 });
    expect(summary.tendency).toBe("steady");
    expect(summary.spreadMs).toBeCloseTo(10);
    expect(summary.absMs).toBeCloseTo(10);
  });

  it("has no tendency without hits", () => {
    const summary = summarize({ errors: [null, null], extra: 0 });
    expect(summary.tendency).toBe("none");
    expect(summary.meanMs).toBeNull();
  });
});

describe("histogram", () => {
  it("bins errors and clamps the extremes into the outer bins", () => {
    const bins = histogram([-5, 5, 5, 45, -500, 900, null], 100, 20);
    expect(bins).toHaveLength(10);
    expect(bins[0].count).toBe(1);
    expect(bins[4].count).toBe(1);
    expect(bins[5].count).toBe(2);
    expect(bins[7].count).toBe(1);
    expect(bins[9].count).toBe(1);
    expect(bins.reduce((sum, b) => sum + b.count, 0)).toBe(6);
  });
});

describe("applyLatency", () => {
  it("moves a hit earlier by the latency", () => {
    expect(applyLatency(530, 30)).toBe(500);
  });
});
