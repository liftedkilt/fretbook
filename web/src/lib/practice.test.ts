import { afterEach, describe, expect, it, vi } from "vitest";

import {
  barClicks,
  ClickScheduler,
  clicksBetween,
  countInClicks,
  defaultPractice,
  loadPractice,
  nextCountIn,
  parsePractice,
  preservePitch,
  savePractice,
  trackMix,
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
    expect(defaultPractice().wait).toEqual({ anyOctave: true, silent: false, hintSeconds: 5 });
    expect(
      parsePractice({ wait: { anyOctave: false, silent: true, hintSeconds: 99 } }).wait,
    ).toEqual({ anyOctave: false, silent: true, hintSeconds: 30 });
    expect(parsePractice({ wait: { hintSeconds: "soon" } }).wait.hintSeconds).toBe(5);
    expect(parsePractice({ metronome: { on: true } }).wait.anyOctave).toBe(true);
    expect(parsePractice("nonsense")).toEqual(defaultPractice());
    expect(parsePractice([])).toEqual(defaultPractice());
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
