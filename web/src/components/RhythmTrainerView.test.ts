import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RhythmTrainerView from "./RhythmTrainerView.svelte";
import { startListening } from "../lib/listen/input";

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
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

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
