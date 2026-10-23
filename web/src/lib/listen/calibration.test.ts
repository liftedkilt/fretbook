import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());
import {
  CalibrationWizard,
  computeJitter,
  computeMedian,
  filterOutliers,
  getLocalCalibration,
  isBluetoothDevice,
  isHighJitter,
  listOutputDevices,
  scheduleClick,
  setLocalCalibration,
} from "./calibration";
import type { PitchEvent } from "./engine";
import * as inputModule from "./input";

describe("isBluetoothDevice", () => {
  it("detects common Bluetooth brand names and keywords", () => {
    expect(isBluetoothDevice("AirPods Pro")).toBe(true);
    expect(isBluetoothDevice("Galaxy Buds Live")).toBe(true);
    expect(isBluetoothDevice("WH-1000XM4")).toBe(true);
    expect(isBluetoothDevice("Bose QC35")).toBe(true);
    expect(isBluetoothDevice("Beats Solo3 Wireless")).toBe(true);
    expect(isBluetoothDevice("Bluetooth Hands-Free")).toBe(true);
    expect(isBluetoothDevice("External BT Headset")).toBe(true);
  });

  it("returns false for wired and built-in devices", () => {
    expect(isBluetoothDevice("MacBook Pro Speakers")).toBe(false);
    expect(isBluetoothDevice("Built-in Output")).toBe(false);
    expect(isBluetoothDevice("Scarlett 2i2 USB")).toBe(false);
    expect(isBluetoothDevice("Realtek High Definition Audio")).toBe(false);
    expect(isBluetoothDevice("")).toBe(false);
  });
});

describe("isHighJitter", () => {
  it("flags jitter above the default threshold (30ms)", () => {
    expect(isHighJitter(35)).toBe(true);
    expect(isHighJitter(30)).toBe(false);
    expect(isHighJitter(15)).toBe(false);
  });

  it("supports custom thresholds", () => {
    expect(isHighJitter(25, 20)).toBe(true);
    expect(isHighJitter(25, 30)).toBe(false);
  });
});

describe("computeMedian", () => {
  it("returns 0 for empty arrays", () => {
    expect(computeMedian([])).toBe(0);
  });

  it("computes median for odd counts", () => {
    expect(computeMedian([42])).toBe(42);
    expect(computeMedian([30, 10, 20])).toBe(20);
    expect(computeMedian([5, 1, 9, 7, 3])).toBe(5);
  });

  it("computes median for even counts", () => {
    expect(computeMedian([10, 20])).toBe(15);
    expect(computeMedian([40, 10, 20, 30])).toBe(25);
  });

  it("rounds to 1 decimal place", () => {
    expect(computeMedian([10.12, 20.34])).toBe(15.2);
  });
});

describe("computeJitter", () => {
  it("returns 0 for fewer than 2 samples", () => {
    expect(computeJitter([])).toBe(0);
    expect(computeJitter([50])).toBe(0);
  });

  it("returns 0 for identical values", () => {
    expect(computeJitter([40, 40, 40])).toBe(0);
  });

  it("computes sample standard deviation", () => {
    // values 10, 20, 30 -> mean 20, variance = (100 + 0 + 100) / 2 = 100 -> stddev = 10
    expect(computeJitter([10, 20, 30])).toBe(10);
  });
});

describe("filterOutliers", () => {
  it("preserves small arrays", () => {
    expect(filterOutliers([10, 20, 30])).toEqual([10, 20, 30]);
  });

  it("removes extreme values outside 1.5 * IQR", () => {
    const data = [50, 52, 49, 51, 50, 500];
    const filtered = filterOutliers(data);
    expect(filtered).not.toContain(500);
    expect(filtered.length).toBe(5);
  });

  it("keeps all values if there are no outliers", () => {
    const data = [48, 49, 50, 51, 52];
    expect(filterOutliers(data)).toEqual([48, 49, 50, 51, 52]);
  });
});

describe("storage helpers", () => {
  it("gets and sets local calibration in localStorage", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => store.set(key, val),
    });

    setLocalCalibration("out-1", "in-1", 45.5);
    expect(getLocalCalibration("out-1", "in-1")).toBe(45.5);
    expect(getLocalCalibration("unknown", "unknown")).toBeNull();
  });
});

describe("listOutputDevices", () => {
  it("returns fallback device when navigator is missing", async () => {
    vi.stubGlobal("navigator", undefined);
    const devices = await listOutputDevices();
    expect(devices).toEqual([{ deviceId: "default", label: "Default" }]);
  });

  it("filters for audiooutput devices", async () => {
    const mockEnumerate = vi.fn().mockResolvedValue([
      { kind: "audioinput", deviceId: "in-1", label: "Mic" },
      { kind: "audiooutput", deviceId: "out-1", label: "Speakers" },
      { kind: "audiooutput", deviceId: "out-2", label: "Headphones" },
    ]);
    vi.stubGlobal("navigator", {
      mediaDevices: { enumerateDevices: mockEnumerate },
    });
    const devices = await listOutputDevices();
    expect(devices).toHaveLength(2);
    expect(devices[0].deviceId).toBe("out-1");
    expect(devices[1].deviceId).toBe("out-2");
  });
});

describe("scheduleClick", () => {
  it("creates and schedules oscillator and gain nodes", () => {
    const mockOsc = {
      type: "",
      frequency: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const mockGain = {
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    };
    const mockCtx = {
      createOscillator: vi.fn().mockReturnValue(mockOsc),
      createGain: vi.fn().mockReturnValue(mockGain),
      destination: {},
    } as unknown as AudioContext;

    scheduleClick(mockCtx, 1.5, 1200, 0.03);

    expect(mockCtx.createOscillator).toHaveBeenCalled();
    expect(mockCtx.createGain).toHaveBeenCalled();
    expect(mockOsc.frequency.setValueAtTime).toHaveBeenCalledWith(1200, 1.5);
    expect(mockOsc.start).toHaveBeenCalledWith(1.5);
    expect(mockOsc.stop).toHaveBeenCalledWith(1.53);
    expect(mockOsc.connect).toHaveBeenCalledWith(mockGain);
    expect(mockGain.connect).toHaveBeenCalledWith(mockCtx.destination);
  });
});

describe("CalibrationWizard", () => {
  it("runs a calibration session and computes result", async () => {
    vi.useFakeTimers();

    let onPitchCb: (event: PitchEvent) => void = () => {};
    const mockSession = {
      sampleRate: 44100,
      channelCount: 1,
      setChannel: vi.fn(),
      setExpectedMidi: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(inputModule, "startListening").mockImplementation(async (opts) => {
      onPitchCb = opts.onPitch;
      return mockSession;
    });

    const mockCtx = {
      currentTime: 10.0,
      state: "running",
      resume: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      createOscillator: vi.fn().mockReturnValue({
        frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      }),
      createGain: vi.fn().mockReturnValue({
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      }),
      destination: {},
    };
    globalThis.AudioContext = vi
      .fn()
      .mockImplementation(() => mockCtx) as unknown as typeof AudioContext;

    const wizard = new CalibrationWizard();
    const progressEvents: unknown[] = [];
    const detectedOffsets: number[] = [];

    const runPromise = wizard.run({
      outputDeviceId: "default",
      inputDeviceId: "default",
      clickInterval: 0.5,
      clickCount: 4,
      leadInClicks: 1, // Total 5 clicks: index 0 (lead-in), 1, 2, 3, 4
      onProgress: (p) => progressEvents.push(p),
      onDetectedOnset: (offset) => detectedOffsets.push(offset),
    });

    // Advance to start
    await vi.advanceTimersByTimeAsync(100);

    // Click 0 at t=10.1 (lead in)
    // Click 1 at t=10.6
    // Simulate onset for Click 1 at t=10.65 (50ms offset)
    onPitchCb({
      time: 10.65,
      frequency: 220,
      clarity: 0.9,
      midi: 57,
      cents: 0,
      onset: true,
      onsetTime: 10.65,
    });

    // Click 2 at t=11.1
    // Simulate onset for Click 2 at t=11.152 (52ms offset)
    onPitchCb({
      time: 11.152,
      frequency: 220,
      clarity: 0.9,
      midi: 57,
      cents: 0,
      onset: true,
      onsetTime: 11.152,
    });

    // Click 3 at t=11.6
    // Simulate onset for Click 3 at t=11.648 (48ms offset)
    onPitchCb({
      time: 11.648,
      frequency: 220,
      clarity: 0.9,
      midi: 57,
      cents: 0,
      onset: true,
      onsetTime: 11.648,
    });

    // Click 4 at t=12.1
    // Simulate onset for Click 4 at t=12.15 (50ms offset)
    onPitchCb({
      time: 12.15,
      frequency: 220,
      clarity: 0.9,
      midi: 57,
      cents: 0,
      onset: true,
      onsetTime: 12.15,
    });

    // Fast-forward through duration
    await vi.advanceTimersByTimeAsync(3500);

    const result = await runPromise;
    expect(result.sampleCount).toBe(4);
    expect(result.medianOffsetMs).toBe(50);
    expect(result.jitterMs).toBeLessThan(5);
    expect(result.isBluetooth).toBe(false);
    expect(result.highJitter).toBe(false);

    expect(detectedOffsets).toHaveLength(4);
    expect(mockSession.stop).toHaveBeenCalled();
    expect(mockCtx.close).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("can be cancelled cleanly", async () => {
    vi.useFakeTimers();

    const mockSession = {
      sampleRate: 44100,
      channelCount: 1,
      setChannel: vi.fn(),
      setExpectedMidi: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(inputModule, "startListening").mockResolvedValue(mockSession);

    const mockCtx = {
      currentTime: 10.0,
      state: "running",
      resume: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      createOscillator: vi.fn().mockReturnValue({
        frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      }),
      createGain: vi.fn().mockReturnValue({
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      }),
      destination: {},
    };
    globalThis.AudioContext = vi
      .fn()
      .mockImplementation(() => mockCtx) as unknown as typeof AudioContext;

    const wizard = new CalibrationWizard();
    void wizard.run({ clickInterval: 0.5, clickCount: 5 });
    await vi.advanceTimersByTimeAsync(50);

    await wizard.cancel();
    expect(mockSession.stop).toHaveBeenCalled();
    expect(mockCtx.close).toHaveBeenCalled();

    vi.useRealTimers();
  });
});
