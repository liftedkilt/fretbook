import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PitchEvent } from "./engine";
import type { ListenOptions, ListenSession } from "./input";
import type { ScoredStep, ScoreSummary } from "./scored";
import { ScoredRun } from "./scoredRun";

const step = (time: number, midi: number): ScoredStep => ({
  bar: 0,
  position: 0,
  tick: 0,
  time,
  kind: "note",
  midis: [midi],
  string: 3,
  fret: 0,
});

const attack = (time: number, midi: number): PitchEvent => ({
  time,
  frequency: 100,
  clarity: 0.95,
  midi,
  cents: 0,
  onset: true,
  onsetTime: time - 0.02,
});

function setup(options: { rate?: number; latency?: number; steps?: ScoredStep[] } = {}) {
  let listenOptions!: ListenOptions;
  const clock = { song: 0, mic: 0 };
  const stopped = vi.fn(async () => undefined);
  const session: ListenSession = {
    sampleRate: 48000,
    channelCount: 1,
    get currentTime() {
      return clock.mic;
    },
    setChannel: () => undefined,
    setExpectedMidi: () => undefined,
    setChroma: () => undefined,
    stop: stopped,
  };
  const completed: ScoreSummary[] = [];
  const changes: number[][] = [];
  const attacks: number[][] = [];
  const run = new ScoredRun({
    steps: options.steps ?? [step(1, 40), step(2, 41)],
    barCount: 1,
    listen: async (given) => {
      listenOptions = given;
      return session;
    },
    songTime: () => clock.song,
    rate: () => options.rate ?? 1,
    latencySeconds: options.latency ?? 0,
    onGrades: (changed) => changes.push(changed),
    onAttacks: (total, rest) => attacks.push([total, rest]),
    onComplete: (summary) => completed.push(summary),
  });
  return {
    run,
    clock,
    completed,
    changes,
    attacks,
    stopped,
    hear: (e: PitchEvent) => listenOptions.onPitch(e),
  };
}

describe("ScoredRun", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("maps the microphone clock onto the song clock and finishes when the pass is graded", async () => {
    const { run, clock, completed, hear } = setup();
    await run.start({ from: 0, to: 2 });
    // Microphone clock 500 s ahead of the song clock; the first note is played in time.
    clock.song = 1.03;
    clock.mic = 501.03;
    hear(attack(501.03, 40));
    expect(run.summary?.counts.hit).toBe(1);
    expect(run.running).toBe(true);
    clock.song = 2.03;
    clock.mic = 502.03;
    hear(attack(502.03, 41));
    expect(completed).toHaveLength(1);
    expect(completed[0].counts.hit).toBe(2);
    expect(run.running).toBe(false);
  });

  it("moves an attack back by the latency and scales by the playback speed", async () => {
    // At half speed the song moves 0.5 s per real second, so 0.2 s of latency is 0.1 s of song.
    const { run, clock, hear } = setup({ rate: 0.5, latency: 0.2 });
    await run.start({ from: 0, to: 2 });
    clock.song = 1.15;
    clock.mic = 1000;
    hear(attack(1000, 40));
    // song time of the attack: 1.15 - (0.02 ago + 0.2) * 0.5 = 1.04 -> hit
    expect(run.summary?.counts.hit).toBe(1);
  });

  it("marks missed notes from the timer and ends the pass at its end", async () => {
    const { run, clock, completed } = setup();
    await run.start({ from: 0, to: 2 });
    clock.song = 2.5;
    await vi.advanceTimersByTimeAsync(150);
    expect(completed).toHaveLength(1);
    expect(completed[0].counts.missed).toBe(2);
  });

  it("finishes early on request, restarts a pass and stops the microphone", async () => {
    const { run, clock, completed, stopped } = setup();
    await run.start({ from: 0, to: 2 });
    clock.song = 0.5;
    const summary = run.finish();
    expect(summary?.counts.missed).toBe(2);
    expect(run.finish()).toEqual(summary);
    expect(completed).toHaveLength(1);
    run.begin({ from: 0, to: 2 });
    expect(run.running).toBe(true);
    expect(run.attacks).toBe(0);
    expect(run.restAttacks).toBe(0);
    run.stop();
    expect(stopped).toHaveBeenCalled();
    expect(run.summary).toBeNull();
    expect(run.finish()).toBeNull();
  });

  it("reports attacks, and those far from any note", async () => {
    const { run, clock, hear, attacks } = setup();
    await run.start({ from: 0, to: 5 });
    clock.song = 1;
    clock.mic = 1;
    hear(attack(1, 40));
    clock.song = 4;
    clock.mic = 4;
    hear(attack(4, 40));
    expect(attacks).toEqual([
      [1, 0],
      [2, 1],
    ]);
  });

  it("ignores events after the pass is done", async () => {
    const { run, clock, hear, changes } = setup();
    await run.start({ from: 0, to: 2 });
    run.finish();
    const before = changes.length;
    clock.song = 1;
    hear(attack(1, 40));
    expect(changes).toHaveLength(before);
  });
});
