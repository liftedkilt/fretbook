import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { patternById } from "./patterns";
import { RhythmRun, type RhythmResult } from "./run";

describe("RhythmRun", () => {
  let clock = 0;
  const clicks: { delay: number; accent: boolean; at: number }[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    clock = 0;
    clicks.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  function make(options: { latencyMs?: number; bars?: number } = {}) {
    let result: RhythmResult | undefined;
    const run = new RhythmRun({
      pattern: patternById("quarters"),
      bpm: 120,
      bars: options.bars ?? 1,
      now: () => clock,
      click: (delay, accent) => clicks.push({ delay, accent, at: clock }),
      onFinish: (r) => (result = r),
      latencyMs: options.latencyMs,
    });
    return { run, result: () => result };
  }

  function advance(ms: number) {
    clock += ms;
    vi.advanceTimersByTime(ms);
  }

  it("clicks every beat of the count-in and the scored bars, accenting beat one", () => {
    const { run, result } = make({ bars: 1 });
    run.begin();
    advance(6000);
    expect(clicks).toHaveLength(8);
    expect(clicks.map((c) => c.accent)).toEqual([
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ]);
    expect(result()).toBeDefined();
  });

  it("scores hits against the beats and reports a rushing player", () => {
    const { run, result } = make();
    run.begin();
    const start = run.scoredStart;
    for (const beat of [0, 1, 2, 3]) {
      const target = start + beat * 500 - 25;
      advance(Math.max(0, target - clock));
      run.hit(clock, "keyboard");
    }
    advance(5000);
    const r = result()!;
    expect(r.summary.hit).toBe(4);
    expect(r.summary.meanMs).toBeCloseTo(-25);
    expect(r.summary.tendency).toBe("rushing");
  });

  it("removes the round trip from mic hits and half of it from taps", () => {
    const { run, result } = make({ latencyMs: 100 });
    run.begin();
    const start = run.scoredStart;
    advance(start - clock);
    run.hit(start + 100, "mic");
    run.hit(start + 500 + 50, "touch");
    advance(5000);
    expect(result()!.match.errors.slice(0, 2)).toEqual([0, 0]);
  });

  it("counts misses and extra hits, and ignores hits after stop", () => {
    const { run, result } = make();
    run.begin();
    advance(run.scoredStart - clock);
    run.hit(clock, "keyboard");
    run.hit(clock + 250, "keyboard");
    advance(5000);
    const r = result()!;
    expect(r.summary.hit).toBe(1);
    expect(r.summary.missed).toBe(3);
    expect(r.summary.extra).toBe(1);
    run.hit(clock, "keyboard");
    expect(run.running).toBe(false);
  });

  it("reports where the run is", () => {
    const { run } = make();
    expect(run.position()).toBeNull();
    run.begin();
    advance(300 + 600);
    expect(run.position()).toEqual({ countIn: true, bar: 0, cell: 1 });
    advance(1400);
    expect(run.position()).toEqual({ countIn: false, bar: 0, cell: 0 });
    run.stop();
    expect(run.position()).toBeNull();
  });
});
