import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RhythmTrainerView from "./RhythmTrainerView.svelte";
import { startListening } from "../lib/listen/input";

const api = vi.hoisted(() => ({
  listSongs: vi.fn(),
  getSong: vi.fn(),
  recordPracticeExercise: vi.fn(async () => undefined),
}));
vi.mock("../lib/api", () => api);
vi.mock("../lib/listen/input", async (original) => ({
  ...(await original<typeof import("../lib/listen/input")>()),
  startListening: vi.fn(),
}));

class FakeAudioContext {
  currentTime = 0;
  destination = {};
  state = "running";
  resume = vi.fn();
  close = vi.fn();
  createOscillator() {
    return {
      type: "",
      frequency: { value: 0 },
      connect: vi.fn((node) => node),
      start: vi.fn(),
      stop: vi.fn(),
    };
  }
  createGain() {
    return {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn((node) => node),
    };
  }
}
vi.stubGlobal("AudioContext", FakeAudioContext);

describe("RhythmTrainerView", () => {
  beforeEach(() => {
    localStorage.clear();
    api.recordPracticeExercise.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("draws connected beams for eighth notes, sixteenths, and triplets", async () => {
    render(RhythmTrainerView);

    // Default is eighths: 8 cells, 4 beamed pairs of span 1
    const eighthBeams = screen.getAllByTestId("rhythm-beam");
    expect(eighthBeams).toHaveLength(4);
    eighthBeams.forEach((beam) => {
      expect(beam.getAttribute("data-span")).toBe("1");
      expect(beam.getAttribute("style")).toContain("calc(1 * (100% + var(--rhythm-gap)) + 2px)");
    });
    expect(screen.queryAllByTestId("rhythm-beam-secondary")).toHaveLength(0);

    // Switch to sixteenths: 16 cells, 4 groups of 4 with primary and secondary beams of span 3
    await fireEvent.change(screen.getByTestId("rhythm-pattern"), {
      target: { value: "sixteenths" },
    });
    const sixteenthPrimary = screen.getAllByTestId("rhythm-beam");
    const sixteenthSecondary = screen.getAllByTestId("rhythm-beam-secondary");
    expect(sixteenthPrimary).toHaveLength(4);
    expect(sixteenthSecondary).toHaveLength(4);
    sixteenthPrimary.forEach((beam) => {
      expect(beam.getAttribute("data-span")).toBe("3");
      expect(beam.getAttribute("style")).toContain("calc(3 * (100% + var(--rhythm-gap)) + 2px)");
    });
    sixteenthSecondary.forEach((beam) => {
      expect(beam.getAttribute("data-span")).toBe("3");
    });

    // Switch to triplets: 12 cells, 4 groups of 3 with beam of span 2
    await fireEvent.change(screen.getByTestId("rhythm-pattern"), {
      target: { value: "triplets" },
    });
    const tripletBeams = screen.getAllByTestId("rhythm-beam");
    expect(tripletBeams).toHaveLength(4);
    tripletBeams.forEach((beam) => {
      expect(beam.getAttribute("data-span")).toBe("2");
      expect(beam.getAttribute("style")).toContain("calc(2 * (100% + var(--rhythm-gap)) + 2px)");
    });

    // Switch to quarters: 4 quarter notes, no beams
    await fireEvent.change(screen.getByTestId("rhythm-pattern"), {
      target: { value: "quarters" },
    });
    expect(screen.queryAllByTestId("rhythm-beam")).toHaveLength(0);
  });

  it("draws the chosen pattern with rests and strum arrows", async () => {
    render(RhythmTrainerView);
    await fireEvent.change(screen.getByTestId("rhythm-pattern"), {
      target: { value: "syncopation" },
    });
    const states = Array.from({ length: 8 }, (_, i) =>
      screen.getByTestId(`rhythm-cell-${i}`).getAttribute("data-state"),
    );
    expect(states).toEqual(["hit", "rest", "rest", "hit", "hit", "rest", "hit", "rest"]);
    expect(document.querySelectorAll(".rhythm-strum")).toHaveLength(4);
  });

  it("scores Space presses against the click and tells a rushing player", async () => {
    render(RhythmTrainerView);
    await fireEvent.change(screen.getByTestId("rhythm-pattern"), { target: { value: "quarters" } });
    await fireEvent.input(screen.getByTestId("rhythm-bpm"), { target: { value: "120" } });
    await fireEvent.change(screen.getByTestId("rhythm-bars"), { target: { value: "2" } });
    await fireEvent.click(screen.getByTestId("rhythm-start"));
    // Count-in starts after 300 ms and lasts one 2 s bar; play 40 ms ahead of every beat.
    const first = 300 + 2000;
    vi.advanceTimersByTime(first - 40);
    for (let beat = 0; beat < 8; beat++) {
      await fireEvent.keyDown(window, { code: "Space" });
      vi.advanceTimersByTime(500);
    }
    vi.advanceTimersByTime(3000);
    await tick();
    expect(screen.getByTestId("rhythm-results")).toBeTruthy();
    expect(screen.getByTestId("rhythm-hit-count").textContent).toBe("8 / 8");
    expect(screen.getByTestId("rhythm-verdict").getAttribute("data-tendency")).toBe("rushing");
    expect(screen.getByTestId("rhythm-mean").textContent).toContain("-");
    expect(screen.getByTestId("rhythm-histogram").querySelectorAll(".rhythm-bin")).toHaveLength(10);
  });

  async function playTwoBarsOfQuarters(offsetMs: number) {
    await fireEvent.change(screen.getByTestId("rhythm-pattern"), { target: { value: "quarters" } });
    await fireEvent.input(screen.getByTestId("rhythm-bpm"), { target: { value: "120" } });
    await fireEvent.change(screen.getByTestId("rhythm-bars"), { target: { value: "2" } });
    await fireEvent.click(screen.getByTestId("rhythm-start"));
    vi.advanceTimersByTime(300 + 2000 + offsetMs);
    for (let beat = 0; beat < 8; beat++) {
      // The second bar drifts 30 ms later than the first.
      await fireEvent.keyDown(window, { code: "Space" });
      vi.advanceTimersByTime(beat === 3 ? 530 : 500);
    }
    vi.advanceTimersByTime(3000);
    await tick();
  }

  it("shows the timing error of every bar and logs the run to the practice log", async () => {
    render(RhythmTrainerView);
    await playTwoBarsOfQuarters(-40);
    expect(screen.getByTestId("rhythm-per-bar").querySelectorAll("li")).toHaveLength(2);
    const first = screen.getByTestId("rhythm-bar-stat-0").textContent ?? "";
    const second = screen.getByTestId("rhythm-bar-stat-1").textContent ?? "";
    expect(first).toContain("4/4");
    expect(first).toContain("-");
    expect(second).toContain("4/4");
    expect(second).not.toBe(first);
    expect(api.recordPracticeExercise).toHaveBeenCalledTimes(1);
    expect(api.recordPracticeExercise).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "rhythm",
        pattern: "quarters",
        bpm: 120,
        rounds: 8,
        correct: 8,
        score: 100,
        mean_error_ms: expect.any(Number),
      }),
    );
  });

  it("does not log a run that was stopped early", async () => {
    render(RhythmTrainerView);
    await fireEvent.click(screen.getByTestId("rhythm-start"));
    vi.advanceTimersByTime(1000);
    await fireEvent.click(screen.getByTestId("rhythm-stop"));
    expect(api.recordPracticeExercise).not.toHaveBeenCalled();
  });

  it("drills the bars of a song", async () => {
    const document = {
      version: 1,
      bpm: 100,
      bars: [{ signature: [4, 4] }, { signature: [4, 4] }],
      tracks: [
        {
          id: "t",
          name: "Guitar",
          instrument: "guitar",
          capo: 0,
          tuning_midi: [64],
          preferred: true,
          bars: [
            [0, 960, 1920, 2880],
            [0, 480, 960, 1440, 1920, 2400, 2880, 3360],
          ].map((positions) => ({
            voices: [
              {
                beats: positions.map((position) => ({
                  position,
                  duration: 480,
                  notes: [{ string: 0, fret: 0 }],
                })),
              },
            ],
          })),
        },
      ],
      sync: { video_id: null, points: [], anchors: {} },
    };
    api.listSongs.mockResolvedValue({
      items: [
        { id: "a", title: "My riff", content_kind: "tab" },
        { id: "b", title: "Lead sheet", content_kind: "chords" },
      ],
    });
    api.getSong.mockResolvedValue({ id: "a", content_kind: "tab", document });
    render(RhythmTrainerView);
    await fireEvent.change(screen.getByTestId("rhythm-source"), { target: { value: "song" } });
    await vi.advanceTimersByTimeAsync(0);
    const options = Array.from(screen.getByTestId("rhythm-song").querySelectorAll("option"));
    expect(options.map((o) => o.textContent)).toEqual(["Choose a song…", "My riff"]);
    await fireEvent.change(screen.getByTestId("rhythm-song"), { target: { value: "a" } });
    await vi.advanceTimersByTimeAsync(0);
    const rhythm = screen.getByTestId("rhythm-song-rhythm");
    expect(rhythm.querySelectorAll("option")).toHaveLength(2);
    await fireEvent.change(rhythm, { target: { value: "song:2:xxxxxxxx" } });
    const states = Array.from({ length: 8 }, (_, i) =>
      screen.getByTestId(`rhythm-cell-${i}`).getAttribute("data-state"),
    );
    expect(states).toEqual(Array(8).fill("hit"));
    expect(screen.getByTestId("rhythm-bar").getAttribute("aria-label")).toContain("Bar 2");

    // A finished run is logged under a short, locale-free name however long the title is.
    await fireEvent.input(screen.getByTestId("rhythm-bpm"), { target: { value: "240" } });
    await fireEvent.change(screen.getByTestId("rhythm-bars"), { target: { value: "2" } });
    await fireEvent.click(screen.getByTestId("rhythm-start"));
    vi.advanceTimersByTime(10000);
    await tick();
    expect(api.recordPracticeExercise).toHaveBeenCalledWith(
      expect.objectContaining({ pattern: "song:a:2", mean_error_ms: null, correct: 0 }),
    );
  });

  it("says so when the song cannot be loaded", async () => {
    api.listSongs.mockResolvedValue({
      items: [{ id: "a", title: "My riff", content_kind: "tab" }],
    });
    api.getSong.mockRejectedValue(new Error("offline"));
    render(RhythmTrainerView);
    await fireEvent.change(screen.getByTestId("rhythm-source"), { target: { value: "song" } });
    await vi.advanceTimersByTimeAsync(0);
    await fireEvent.change(screen.getByTestId("rhythm-song"), { target: { value: "a" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByTestId("rhythm-song-error")).toBeInTheDocument();
  });

  it("accepts taps on the pad and reports no hits when nothing is played", async () => {
    render(RhythmTrainerView);
    await fireEvent.input(screen.getByTestId("rhythm-bpm"), { target: { value: "240" } });
    await fireEvent.change(screen.getByTestId("rhythm-bars"), { target: { value: "2" } });
    await fireEvent.click(screen.getByTestId("rhythm-start"));
    expect((screen.getByTestId("rhythm-pad") as HTMLButtonElement).disabled).toBe(false);
    vi.advanceTimersByTime(10000);
    await tick();
    expect(screen.getByTestId("rhythm-verdict").getAttribute("data-tendency")).toBe("none");
    expect((screen.getByTestId("rhythm-pad") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the listen panel with the microphone and opens the chosen input", async () => {
    localStorage.setItem("fretbook.listen.device", "scarlett");
    let onLevel: ((level: { rms: number; peak: number }) => void) | undefined;
    vi.mocked(startListening).mockImplementationOnce(async (options) => {
      onLevel = options.onLevel;
      return { channelCount: 1, currentTime: 0, stop: vi.fn(async () => undefined) } as never;
    });
    render(RhythmTrainerView);
    expect(screen.queryByTestId("listen-panel")).toBeNull();
    await fireEvent.click(screen.getByTestId("rhythm-mic"));
    expect(screen.getByTestId("listen-panel")).toBeInTheDocument();
    await fireEvent.click(screen.getByTestId("rhythm-start"));
    await vi.advanceTimersByTimeAsync(0);
    expect(startListening).toHaveBeenCalledWith(expect.objectContaining({ deviceId: "scarlett" }));
    onLevel?.({ rms: 1, peak: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByTestId("listen-meter")).toHaveAttribute("aria-valuenow", "100");
  });

  it("explains that the microphone needs calibration", async () => {
    render(RhythmTrainerView);
    await fireEvent.click(screen.getByTestId("rhythm-mic"));
    expect(screen.getByTestId("rhythm-mic-hint").textContent).toContain("calibration");
  });
});
