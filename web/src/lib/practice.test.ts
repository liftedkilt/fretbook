import { afterEach, describe, expect, it, vi } from "vitest";

import {
  barClicks,
  calcNextSpeed,
  ClickScheduler,
  clicksBetween,
  countInClicks,
  defaultPractice,
  defaultSpeedTrainer,
  formatSpeedPercent,
  loadPractice,
  nextCountIn,
  parsePractice,
  preservePitch,
  recordLoopPracticeLog,
  savePractice,
  trackMix,
  updateLoopHighestSpeed,
  type SavedLoop,
} from "./practice";

const FOUR: [number, number] = [4, 4];

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("settings", () => {
  it("starts quiet: no metronome, no count-in, everything at full volume", () => {
    const settings = defaultPractice();
    expect(settings.metronome.on).toBe(false);
    expect(settings.countIn.bars).toBe(0);
    expect(settings.mix).toMatchObject({ audio: 1, synth: 1, tracks: {} });
  });

  it("keeps valid stored fields and repairs the rest", () => {
    const parsed = parsePractice({
      metronome: { on: true, volume: 7 },
      countIn: { bars: 2, beforeLoops: true },
      mix: { audio: -1, synth: "loud", tracks: { a: { volume: 0.5, mute: true }, b: 3 } },
    });
    expect(parsed.metronome).toEqual({ on: true, volume: 1 });
    expect(parsed.countIn).toEqual({ bars: 2, beforeLoops: true });
    expect(parsed.mix.audio).toBe(0);
    expect(parsed.mix.synth).toBe(1);
    expect(parsed.mix.tracks).toEqual({ a: { volume: 0.5, mute: true, solo: false } });
    expect(parsePractice({ countIn: { bars: 5 } }).countIn.bars).toBe(0);
  });

  it("remembers the fretboard options and repairs bad ones", () => {
    expect(defaultPractice().fretboard).toEqual({
      on: false,
      label: "names",
      leftHanded: false,
      root: null,
    });
    expect(
      parsePractice({ fretboard: { on: true, label: "frets", leftHanded: true, root: 9 } })
        .fretboard,
    ).toEqual({ on: true, label: "frets", leftHanded: true, root: 9 });
    const bad = parsePractice({ fretboard: { label: "sparkles", root: 12 } }).fretboard;
    expect(bad.label).toBe("names");
    expect(bad.root).toBeNull();
  });

  it("remembers the wait mode options and repairs bad ones", () => {
    expect(defaultPractice().wait).toEqual({
      anyOctave: true,
      silent: false,
      hintSeconds: 5,
      chords: true,
    });
    expect(
      parsePractice({ wait: { anyOctave: false, silent: true, hintSeconds: 99 } }).wait,
    ).toEqual({ anyOctave: false, silent: true, hintSeconds: 30, chords: true });
    expect(parsePractice({ wait: { chords: false } }).wait.chords).toBe(false);
    expect(parsePractice({ wait: { hintSeconds: "soon" } }).wait.hintSeconds).toBe(5);
    expect(parsePractice({ metronome: { on: true } }).wait.anyOctave).toBe(true);
    expect(parsePractice("nonsense")).toEqual(defaultPractice());
    expect(parsePractice([])).toEqual(defaultPractice());
  });

  it("remembers saved loops and repairs bad entries", () => {
    expect(defaultPractice().loops).toEqual([]);
    const parsed = parsePractice({
      loops: [
        { id: "solo", name: "Solo", a: 16, b: 24, highestSpeed: 0.8 },
        { id: "riff", name: "  Bridge riff  ", a: 8, b: 12 },
        { id: "invalid-bounds", name: "Bad", a: 20, b: 10 },
        { id: "", name: "", a: -5, b: -2 },
        "not-an-object",
      ],
    });
    expect(parsed.loops).toEqual([
      { id: "solo", name: "Solo", a: 16, b: 24, highestSpeed: 0.8 },
      { id: "riff", name: "Bridge riff", a: 8, b: 12 },
      { id: "invalid-bounds", name: "Bad", a: 20, b: 20 },
      { id: "loop-4", name: "Loop 4", a: 0, b: 0 },
    ]);
  });

  it("remembers speed trainer settings and clamps bounds", () => {
    expect(defaultSpeedTrainer()).toEqual(defaultPractice().speedTrainer);
    expect(defaultPractice().speedTrainer).toEqual({
      enabled: false,
      startPercent: 60,
      targetPercent: 100,
      stepPercent: 5,
      passesPerStep: 1,
    });
    const parsed = parsePractice({
      speedTrainer: {
        enabled: true,
        startPercent: 40,
        targetPercent: 120,
        stepPercent: 10,
        passesPerStep: 2,
      },
    });
    expect(parsed.speedTrainer).toEqual({
      enabled: true,
      startPercent: 40,
      targetPercent: 120,
      stepPercent: 10,
      passesPerStep: 2,
    });
    const clamped = parsePractice({
      speedTrainer: {
        enabled: true,
        startPercent: 5,
        targetPercent: 500,
        stepPercent: 200,
        passesPerStep: 50,
      },
    });
    expect(clamped.speedTrainer).toEqual({
      enabled: true,
      startPercent: 10,
      targetPercent: 300,
      stepPercent: 100,
      passesPerStep: 20,
    });
  });

  it("remembers settings per song and survives broken or missing storage", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const settings = defaultPractice();
    settings.metronome.on = true;
    settings.mix.tracks.bass = { volume: 0.3, mute: false, solo: true };
    savePractice("one", settings);
    expect(loadPractice("one")).toEqual(settings);
    expect(loadPractice("two")).toEqual(defaultPractice());

    vi.stubGlobal("localStorage", memoryStorage({ "fretbook.practice.bad": "{not json" }));
    expect(loadPractice("bad")).toEqual(defaultPractice());

    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(loadPractice("one")).toEqual(defaultPractice());
    expect(() => savePractice("one", settings)).not.toThrow();

    vi.stubGlobal("localStorage", undefined);
    expect(loadPractice("one")).toEqual(defaultPractice());
    expect(() => savePractice("one", settings)).not.toThrow();
  });

  it("cycles the count-in through off, one bar, two bars", () => {
    expect(nextCountIn(0)).toBe(1);
    expect(nextCountIn(1)).toBe(2);
    expect(nextCountIn(2)).toBe(0);
  });

  it("gives an untouched track the default mix", () => {
    expect(trackMix(defaultPractice(), "x")).toEqual({ volume: 1, mute: false, solo: false });
  });
});

describe("click schedule", () => {
  it("spreads a bar's beats evenly and accents the first", () => {
    expect(barClicks(2, 4, 4)).toEqual([
      { time: 2, accent: true },
      { time: 2.5, accent: false },
      { time: 3, accent: false },
      { time: 3.5, accent: false },
    ]);
    expect(barClicks(0, 1, 0)).toHaveLength(1);
  });

  it("follows time-signature changes and uneven bar lengths", () => {
    // Bar 1 is 4/4 and 2 s long; bar 2 is 3/4 and 1.5 s long (a faster tempo).
    const starts = [0, 2, 3.5];
    const bars = [{ signature: FOUR }, { signature: [3, 4] as [number, number] }];
    const clicks = clicksBetween(starts, bars, 0, 10);
    expect(clicks.map((click) => click.time)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3]);
    expect(clicks.filter((click) => click.accent).map((click) => click.time)).toEqual([0, 2]);
    expect(clicksBetween(starts, bars, 0.6, 2.2).map((click) => click.time)).toEqual([1, 1.5, 2]);
    expect(clicksBetween(starts, bars, 5, 6)).toEqual([]);
    expect(clicksBetween(starts, bars, -3, 0)).toEqual([]);
  });

  it("counts in whole bars at the given length", () => {
    const result = countInClicks(FOUR, 2, 2);
    expect(result.duration).toBe(4);
    expect(result.clicks).toHaveLength(8);
    expect(result.clicks.filter((click) => click.accent).map((click) => click.time)).toEqual([
      0, 2,
    ]);
    expect(countInClicks([3, 4], 1.5, 1).clicks).toHaveLength(3);
    expect(countInClicks(FOUR, 2, 0)).toEqual({ clicks: [], duration: 0 });
  });
});

describe("ClickScheduler", () => {
  const starts = [0, 2, 4];
  const bars = [{ signature: FOUR }, { signature: FOUR }];

  it("hands each click out once as the clock advances", () => {
    const scheduler = new ClickScheduler();
    const first = scheduler.due(starts, bars, 0, 1, 0.6);
    expect(first.map((click) => click.delay)).toEqual([0, 0.5]);
    expect(first[0].accent).toBe(true);
    expect(scheduler.due(starts, bars, 0.6, 1, 0.6)).toEqual([{ delay: 0.4, accent: false }]);
    expect(scheduler.due(starts, bars, 0.6, 1, 0.6)).toEqual([]);
  });

  it("converts media time to wall-clock time at the playback rate", () => {
    const scheduler = new ClickScheduler();
    // At half speed the same 0.5 s of music takes a second.
    const clicks = scheduler.due(starts, bars, 0, 0.5, 2.2);
    expect(clicks.map((click) => click.delay)).toEqual([0, 1, 2]);
  });

  it("clicks again after a reset, as when the player seeks back or loops", () => {
    const scheduler = new ClickScheduler();
    scheduler.due(starts, bars, 0, 1, 1);
    expect(scheduler.due(starts, bars, 0, 1, 1)).toEqual([]);
    scheduler.reset();
    expect(scheduler.due(starts, bars, 0, 1, 1)).toHaveLength(2);
  });
});

describe("preservePitch", () => {
  it("turns on the standard flag and the prefixed ones where they exist", () => {
    const audio = {
      preservesPitch: false,
      webkitPreservesPitch: false,
    } as unknown as HTMLAudioElement;
    preservePitch(audio);
    expect(audio.preservesPitch).toBe(true);
    expect((audio as unknown as { webkitPreservesPitch: boolean }).webkitPreservesPitch).toBe(true);
    expect("mozPreservesPitch" in audio).toBe(false);

    const gecko = {
      preservesPitch: false,
      mozPreservesPitch: false,
    } as unknown as HTMLAudioElement;
    preservePitch(gecko);
    expect((gecko as unknown as { mozPreservesPitch: boolean }).mozPreservesPitch).toBe(true);
  });
});

describe("calcNextSpeed", () => {
  it("steps toward target without exceeding it", () => {
    expect(calcNextSpeed(60, 100, 5)).toBe(65);
    expect(calcNextSpeed(95, 100, 5)).toBe(100);
    expect(calcNextSpeed(98, 100, 5)).toBe(100);
    expect(calcNextSpeed(100, 100, 5)).toBe(100);
    expect(calcNextSpeed(110, 100, 5)).toBe(100);
  });
});

describe("updateLoopHighestSpeed", () => {
  it("records higher speeds and ignores lower ones", () => {
    const loops: SavedLoop[] = [
      { id: "1", name: "Solo", a: 5, b: 10, highestSpeed: 0.8 },
      { id: "2", name: "Intro", a: 0, b: 4 },
    ];

    const lower = updateLoopHighestSpeed(loops, "1", 0.75);
    expect(lower.updated).toBe(false);
    expect(lower.loops[0].highestSpeed).toBe(0.8);

    const higher = updateLoopHighestSpeed(loops, "1", 0.9);
    expect(higher.updated).toBe(true);
    expect(higher.loops[0].highestSpeed).toBe(0.9);

    const first = updateLoopHighestSpeed(loops, "2", 1.0);
    expect(first.updated).toBe(true);
    expect(first.loops[1].highestSpeed).toBe(1.0);

    const notFound = updateLoopHighestSpeed(loops, "99", 1.2);
    expect(notFound.updated).toBe(false);
  });
});

describe("recordLoopPracticeLog", () => {
  it("does not throw when window is undefined", () => {
    vi.stubGlobal("window", undefined);
    expect(() =>
      recordLoopPracticeLog("song-1", { id: "loop-1", name: "Riff" }, 0.8),
    ).not.toThrow();
  });

  it("dispatches fretbook:practice-log-record event on window", () => {
    let dispatched: unknown = null;
    vi.stubGlobal("window", {
      dispatchEvent: (event: unknown) => {
        dispatched = event;
        return true;
      },
    });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    recordLoopPracticeLog("song-123", { id: "loop-1", name: "Riff" }, 0.85);

    expect(dispatched).toMatchObject({
      type: "fretbook:practice-log-record",
      detail: {
        songId: "song-123",
        loopId: "loop-1",
        loopName: "Riff",
        speed: 0.85,
      },
    });
  });
});

describe("formatSpeedPercent", () => {
  it("formats ratios and percentages cleanly", () => {
    expect(formatSpeedPercent(undefined)).toBe("");
    expect(formatSpeedPercent(0.85)).toBe("85%");
    expect(formatSpeedPercent(1)).toBe("100%");
    expect(formatSpeedPercent(1.25)).toBe("125%");
    expect(formatSpeedPercent(90)).toBe("90%");
  });
});
