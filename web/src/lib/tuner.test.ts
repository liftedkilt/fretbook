import { afterEach, describe, expect, it, vi } from "vitest";
import { midiToFrequency } from "./listen/notes";
import {
  ExpectedNotePrior,
  playReferenceTone,
  A4_MAX,
  A4_MIN,
  INSTRUMENTS,
  PRESETS,
  PitchSmoother,
  TuneTracker,
  centsFromString,
  displayCents,
  playSuccessChime,
  chromaticMatch,
  clampA4,
  isInTune,
  nearestString,
  needlePosition,
  withCapo,
  loadTunerChoice,
  saveTunerChoice,
} from "./tuner";
import { nameToMidi, parseCustomTuning } from "./tuning";

const STANDARD = PRESETS.find((p) => p.id === "standard")!.midi;

describe("presets", () => {
  it("lists strings highest first with the expected string counts", () => {
    for (const preset of PRESETS) {
      expect([...preset.midi].sort((a, b) => b - a)).toEqual(preset.midi);
    }
    expect(PRESETS.find((p) => p.id === "bass4")!.midi).toEqual([43, 38, 33, 28]);
    expect(PRESETS.find((p) => p.id === "bass5")!.midi).toHaveLength(5);
    expect(PRESETS.find((p) => p.id === "bass6")!.midi).toHaveLength(6);
    expect(PRESETS.find((p) => p.id === "dropD")!.midi.at(-1)).toBe(38);
    expect(PRESETS.find((p) => p.id === "dadgad")!.midi).toEqual([62, 57, 55, 50, 45, 38]);
  });
});

describe("clampA4", () => {
  it("keeps the reference inside 432 to 446 Hz", () => {
    expect(clampA4(400)).toBe(A4_MIN);
    expect(clampA4(500)).toBe(A4_MAX);
    expect(clampA4(441.4)).toBe(441);
    expect(clampA4(Number.NaN)).toBe(440);
  });
});

describe("withCapo", () => {
  it("raises every string by the capo fret", () => {
    expect(withCapo([64, 59], 2)).toEqual([66, 61]);
    expect(withCapo([64, 59], 0)).toEqual([64, 59]);
  });
});

describe("nearestString", () => {
  it("finds the string and the cents off it", () => {
    const a = midiToFrequency(45);
    const match = nearestString(a * 2 ** (10 / 1200), STANDARD)!;
    expect(match.index).toBe(4);
    expect(match.cents).toBeCloseTo(10, 5);
  });

  it("reads flat as negative", () => {
    const match = nearestString(midiToFrequency(50) * 2 ** (-20 / 1200), STANDARD)!;
    expect(match.index).toBe(3);
    expect(match.cents).toBeCloseTo(-20, 5);
  });

  it("honours the A4 reference", () => {
    const match = nearestString(432, [69], 432)!;
    expect(match.cents).toBeCloseTo(0, 5);
    expect(nearestString(432, [69], 440)!.cents).toBeLessThan(-30);
  });

  it("returns null with no pitch or no strings", () => {
    expect(nearestString(0, STANDARD)).toBeNull();
    expect(nearestString(110, [])).toBeNull();
  });
});

describe("chromaticMatch", () => {
  it("names the nearest note", () => {
    const match = chromaticMatch(midiToFrequency(61) * 2 ** (-8 / 1200))!;
    expect(match.midi).toBe(61);
    expect(match.cents).toBeCloseTo(-8, 5);
    expect(chromaticMatch(-1)).toBeNull();
  });
});

describe("needle", () => {
  it("clamps to the dial", () => {
    expect(needlePosition(25)).toBe(0.5);
    expect(needlePosition(-80)).toBe(-1);
    expect(needlePosition(80)).toBe(1);
  });

  it("calls six cents in tune", () => {
    expect(isInTune(6)).toBe(true);
    expect(isInTune(-6.1)).toBe(false);
  });
});

describe("displayCents", () => {
  it("shows a small offset as centred and keeps a real one", () => {
    expect(displayCents(1.2)).toBe(0);
    expect(displayCents(-1.5)).toBe(0);
    expect(displayCents(2.5)).toBe(2.5);
    expect(displayCents(-9)).toBe(-9);
  });
});

describe("centsFromString", () => {
  it("measures against the chosen string, not the nearest", () => {
    expect(centsFromString(midiToFrequency(45), STANDARD, 4)).toBeCloseTo(0, 5);
    expect(centsFromString(midiToFrequency(45), STANDARD, 5)).toBeCloseTo(500, 3);
    expect(centsFromString(0, STANDARD, 4)).toBeNull();
    expect(centsFromString(110, STANDARD, 9)).toBeNull();
  });
});

describe("PitchSmoother", () => {
  const a2 = midiToFrequency(45);

  it("ignores a single outlier reading", () => {
    const smoother = new PitchSmoother();
    [0, 0.01, 0.02, 0.03].forEach((t) => smoother.push(t, a2));
    const out = smoother.push(0.04, a2 * 1.02);
    expect(out).toBeCloseTo(a2, 5);
  });

  it("follows a slow drift", () => {
    const smoother = new PitchSmoother();
    let out = 0;
    for (let i = 0; i < 20; i++) out = smoother.push(i * 0.01, a2 * 2 ** ((i * 2) / 1200))!;
    expect(out).toBeGreaterThan(a2 * 2 ** (20 / 1200));
  });

  it("jumps straight to a new note", () => {
    const smoother = new PitchSmoother();
    for (let i = 0; i < 5; i++) smoother.push(i * 0.01, a2);
    expect(smoother.push(0.06, midiToFrequency(50))).toBeCloseTo(midiToFrequency(50), 5);
  });

  it("holds the note through a short dropout and then clears", () => {
    const smoother = new PitchSmoother();
    smoother.push(0, a2);
    expect(smoother.push(0.2, null)).toBeCloseTo(a2, 5);
    expect(smoother.push(0.5, null)).toBeNull();
    expect(smoother.push(0.6, null)).toBeNull();
  });
});

describe("TuneTracker", () => {
  it("confirms a string after it has stayed in tune for the hold time", () => {
    const tracker = new TuneTracker(1);
    expect(tracker.update(0, 2, 1).confirmed).toBe(false);
    const half = tracker.update(0.5, 2, -2);
    expect(half.progress).toBeCloseTo(0.5, 5);
    expect(half.confirmed).toBe(false);
    const done = tracker.update(1, 2, 0);
    expect(done).toMatchObject({ confirmed: true, newlyTuned: true });
    expect(tracker.tuned.has(2)).toBe(true);
    expect(tracker.update(1.2, 2, 0)).toMatchObject({ confirmed: true, newlyTuned: false });
  });

  it("starts over when the pitch drifts out, the string changes or the sound stops", () => {
    const tracker = new TuneTracker(1);
    tracker.update(0, 2, 0);
    expect(tracker.update(0.9, 2, 8).progress).toBe(0);
    tracker.update(1, 2, 0);
    expect(tracker.update(1.9, 3, 0).progress).toBe(0);
    tracker.update(2, 3, 0);
    expect(tracker.update(2.9, null, null).progress).toBe(0);
    expect(tracker.update(3, 3, 0).confirmed).toBe(false);
    expect(tracker.tuned.size).toBe(0);
  });

  it("tells you once per hold and forgets the tuned strings on reset", () => {
    const tracker = new TuneTracker(1);
    tracker.update(0, 1, 0);
    expect(tracker.update(1, 1, 0).newlyTuned).toBe(true);
    tracker.update(2, 1, 20);
    tracker.update(3, 1, 0);
    expect(tracker.update(4, 1, 0).newlyTuned).toBe(false);
    tracker.reset();
    expect(tracker.tuned.size).toBe(0);
  });

  it("uses a ±6 cent zone", () => {
    expect(isInTune(6)).toBe(true);
    expect(isInTune(-6)).toBe(true);
    expect(isInTune(6.5)).toBe(false);
    const tracker = new TuneTracker(1);
    tracker.update(0, 2, 5);
    expect(tracker.update(1, 2, -5).confirmed).toBe(true);
  });

  it("holds through a single outlier reading once the pitch is median-smoothed", () => {
    const a4 = 440;
    const hz = (cents: number) => a4 * 2 ** (cents / 1200);
    const run = (readings: number[]) => {
      const smoother = new PitchSmoother();
      const tracker = new TuneTracker(1);
      let last = { progress: 0, confirmed: false, newlyTuned: false };
      readings.forEach((cents, i) => {
        const time = i * 0.25;
        const frequency = smoother.push(time, hz(cents));
        last = tracker.update(time, 0, centsFromString(frequency!, [69], 0, a4)!);
      });
      return last;
    };
    // 40 cents sharp for one reading in the middle: the median stays in the zone.
    expect(run([2, 3, 2, 40, 3, 2, 3]).confirmed).toBe(true);
    // Real drift: the median leaves the zone and the hold starts over.
    expect(run([2, 3, 2, 40, 40, 40, 40]).confirmed).toBe(false);
  });

  it("confirms chromatic holds without remembering them", () => {
    const tracker = new TuneTracker(1);
    tracker.update(0, 60, 0, false);
    expect(tracker.update(1, 60, 0, false).newlyTuned).toBe(true);
    expect(tracker.tuned.size).toBe(0);
  });
});

describe("playSuccessChime", () => {
  it("does not throw without audio", () => {
    vi.stubGlobal("AudioContext", undefined);
    expect(() => playSuccessChime()).not.toThrow();
    vi.unstubAllGlobals();
  });
});

describe("playReferenceTone", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("plays a sine at the frequency and fades out on stop", () => {
    vi.useFakeTimers();
    const param = {
      value: 0,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
    };
    const oscillator = {
      type: "",
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const gain = { gain: param, connect: vi.fn() };
    oscillator.connect.mockReturnValue(gain);
    gain.connect.mockReturnValue(undefined);
    const close = vi.fn(async () => {});
    vi.stubGlobal("window", { setTimeout: globalThis.setTimeout });
    vi.stubGlobal(
      "AudioContext",
      class {
        currentTime = 1;
        destination = {};
        createOscillator = () => oscillator;
        createGain = () => gain;
        close = close;
      },
    );

    const tone = playReferenceTone(110);
    expect(oscillator.type).toBe("sine");
    expect(oscillator.frequency.value).toBe(110);
    expect(oscillator.start).toHaveBeenCalled();

    tone.stop();
    expect(oscillator.stop).toHaveBeenCalledWith(expect.closeTo(1.06));
    vi.advanceTimersByTime(200);
    expect(close).toHaveBeenCalled();
  });
});

describe("instruments and custom tuning", () => {
  it("provides definitions for guitar, bass, ukulele and chromatic", () => {
    expect(INSTRUMENTS.map((i) => i.id)).toEqual([
      "guitar6",
      "guitar7",
      "bass4",
      "bass5",
      "ukulele",
      "chromatic",
    ]);
  });

  it("converts note names to MIDI numbers", () => {
    expect(nameToMidi("E4")).toBe(64);
    expect(nameToMidi("B3")).toBe(59);
    expect(nameToMidi("G3")).toBe(55);
    expect(nameToMidi("D3")).toBe(50);
    expect(nameToMidi("A2")).toBe(45);
    expect(nameToMidi("E2")).toBe(40);
    expect(nameToMidi("Eb4")).toBe(63);
    expect(nameToMidi("D#4")).toBe(63);
    expect(nameToMidi("B0")).toBe(23);
    expect(nameToMidi("invalid")).toBeNull();
  });

  it("parses custom tuning strings", () => {
    expect(parseCustomTuning("E4 B3 G3 D3 A2 E2")).toEqual([64, 59, 55, 50, 45, 40]);
    expect(parseCustomTuning("D4, A3, G3, D3, A2, D2")).toEqual([62, 57, 55, 50, 45, 38]);
    expect(parseCustomTuning("")).toBeNull();
    expect(parseCustomTuning("E4 Foo G3")).toBeNull();
  });

  it("loads and saves tuner choices to localStorage", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
    });

    const initial = loadTunerChoice();
    expect(initial.instrument).toBe("guitar6");
    expect(initial.tuning).toBe("standard");

    saveTunerChoice({
      instrument: "bass4",
      tuning: "dropD",
      customMidi: [43, 38, 33, 26],
    });

    const loaded = loadTunerChoice();
    expect(loaded.instrument).toBe("bass4");
    expect(loaded.tuning).toBe("dropD");
    expect(loaded.customMidi).toEqual([43, 38, 33, 26]);
    vi.unstubAllGlobals();
  });
});

describe("ExpectedNotePrior", () => {
  const hz = (midi: number, cents = 0) => midiToFrequency(midi) * 2 ** (cents / 1200);

  it("always hints the locked string", () => {
    const prior = new ExpectedNotePrior();
    expect(prior.push(null, STANDARD, 440, 5)).toBe(40);
    expect(prior.push(hz(64), STANDARD, 440, 5)).toBe(40);
  });

  it("waits for a stable nearest string in auto mode", () => {
    const prior = new ExpectedNotePrior();
    expect(prior.push(hz(45, 4), STANDARD, 440, null)).toBeNull();
    expect(prior.push(hz(45, 3), STANDARD, 440, null)).toBeNull();
    expect(prior.push(hz(45, 5), STANDARD, 440, null)).toBe(45);
  });

  it("does not hint from a reading far from every string", () => {
    const prior = new ExpectedNotePrior();
    for (let i = 0; i < 6; i++) expect(prior.push(hz(47, 0), STANDARD, 440, null)).toBeNull();
  });

  it("does not count readings that alternate between strings", () => {
    const prior = new ExpectedNotePrior();
    for (let i = 0; i < 6; i++) {
      expect(prior.push(hz(i % 2 ? 45 : 50), STANDARD, 440, null)).toBeNull();
    }
  });

  it("clears the hint after a jump of more than 80 cents", () => {
    const prior = new ExpectedNotePrior();
    for (let i = 0; i < 3; i++) prior.push(hz(45), STANDARD, 440, null);
    expect(prior.push(hz(45, 70), STANDARD, 440, null)).toBe(45);
    expect(prior.push(hz(50), STANDARD, 440, null)).toBeNull();
    expect(prior.push(hz(50), STANDARD, 440, null)).toBeNull();
    expect(prior.push(hz(50), STANDARD, 440, null)).toBe(50);
  });

  it("clears the hint when the pitch drops out", () => {
    const prior = new ExpectedNotePrior();
    for (let i = 0; i < 3; i++) prior.push(hz(45), STANDARD, 440, null);
    expect(prior.push(null, STANDARD, 440, null)).toBeNull();
    expect(prior.push(hz(45), STANDARD, 440, null)).toBeNull();
  });
});
