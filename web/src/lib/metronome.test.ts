import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Clicker } from "./clicker";
import {
  DEFAULT_BPM,
  MAX_BPM,
  MIN_BPM,
  MetronomeEngine,
  TapTempoTracker,
  clampBpm,
  loadMetronomeConfig,
  saveMetronomeConfig,
  tempoMarking,
} from "./metronome";

function memoryStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  };
}

describe("metronome utils", () => {
  it("clamps bpm correctly", () => {
    expect(clampBpm(120)).toBe(120);
    expect(clampBpm(10)).toBe(MIN_BPM);
    expect(clampBpm(500)).toBe(MAX_BPM);
    expect(clampBpm(NaN)).toBe(DEFAULT_BPM);
    expect(clampBpm(Infinity)).toBe(DEFAULT_BPM);
  });

  it("returns appropriate tempo marking", () => {
    expect(tempoMarking(50)).toBe("Largo");
    expect(tempoMarking(70)).toBe("Adagio");
    expect(tempoMarking(90)).toBe("Andante");
    expect(tempoMarking(115)).toBe("Moderato");
    expect(tempoMarking(140)).toBe("Allegro");
    expect(tempoMarking(180)).toBe("Presto");
    expect(tempoMarking(240)).toBe("Prestissimo");
  });

  it("calculates tap tempo accurately", () => {
    const tracker = new TapTempoTracker(2000, 4);
    expect(tracker.tap(1000)).toBeNull(); // First tap has no interval

    // Second tap 500ms later -> 120 BPM (60000 / 500 = 120)
    expect(tracker.tap(1500)).toBe(120);

    // Third tap 500ms later -> still 120 BPM
    expect(tracker.tap(2000)).toBe(120);

    // 4th tap 500ms later -> still 120 BPM
    expect(tracker.tap(2500)).toBe(120);

    // Reset after timeout (>2000ms later)
    expect(tracker.tap(6000)).toBeNull();
    expect(tracker.tap(6500)).toBe(120);

    // Manual reset
    tracker.reset();
    expect(tracker.tap(7000)).toBeNull();
  });

  it("loads and saves config to localStorage", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const initial = loadMetronomeConfig();
    expect(initial.bpm).toBe(120);
    expect(initial.signature).toBe("4/4");
    expect(initial.accentBeat1).toBe(true);

    saveMetronomeConfig({
      bpm: 145,
      signature: "3/4",
      accentBeat1: false,
      subdivisions: 2,
      volume: 0.8,
    });

    const loaded = loadMetronomeConfig();
    expect(loaded.bpm).toBe(145);
    expect(loaded.signature).toBe("3/4");
    expect(loaded.accentBeat1).toBe(false);
    expect(loaded.subdivisions).toBe(2);
    expect(loaded.volume).toBe(0.8);

    // Corrupted localStorage
    vi.stubGlobal("localStorage", memoryStorage({ "fretbook.metronome.settings": "invalid-json" }));
    expect(loadMetronomeConfig().bpm).toBe(120);
  });
});

describe("MetronomeEngine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts, schedules clicks, and stops", () => {
    const clicker = new Clicker();
    const clickSpy = vi.spyOn(clicker, "click").mockImplementation(() => {});
    const unlockSpy = vi.spyOn(clicker, "unlock").mockImplementation(() => {});
    vi.spyOn(clicker, "currentTime", "get").mockReturnValue(1.0);

    const onTick = vi.fn();
    const engine = new MetronomeEngine(
      clicker,
      { bpm: 120, signature: "4/4", accentBeat1: true, subdivisions: 1, volume: 0.7 },
      onTick,
    );

    expect(engine.isRunning).toBe(false);
    engine.start();
    expect(engine.isRunning).toBe(true);
    expect(unlockSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();

    // Advance timers by 250ms
    vi.advanceTimersByTime(250);
    expect(onTick).toHaveBeenCalled();

    engine.stop();
    expect(engine.isRunning).toBe(false);
  });

  it("handles subdivisions and config updates", () => {
    const clicker = new Clicker();
    const clickSpy = vi.spyOn(clicker, "click").mockImplementation(() => {});
    vi.spyOn(clicker, "unlock").mockImplementation(() => {});
    let audioTime = 1.0;
    vi.spyOn(clicker, "currentTime", "get").mockImplementation(() => audioTime);

    const onTick = vi.fn();
    const engine = new MetronomeEngine(
      clicker,
      { bpm: 120, signature: "3/4", accentBeat1: true, subdivisions: 2, volume: 0.7 },
      onTick,
    );

    engine.start();
    clickSpy.mockClear();

    engine.updateConfig({ bpm: 140, subdivisions: 3 });
    audioTime = 1.5;
    vi.advanceTimersByTime(200);
    expect(clickSpy).toHaveBeenCalled();

    engine.close();
    expect(engine.isRunning).toBe(false);
  });
});
