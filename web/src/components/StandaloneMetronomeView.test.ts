import { fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

import StandaloneMetronomeView from "./StandaloneMetronomeView.svelte";

// Mock Web Audio
class FakeAudioContext {
  currentTime = 0;
  destination = {};
  state = "suspended";
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
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn((node) => node),
    };
  }
}
vi.stubGlobal("AudioContext", FakeAudioContext);

describe("StandaloneMetronomeView", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders with default controls and tempo", () => {
    render(StandaloneMetronomeView);

    expect(screen.getByTestId("standalone-metronome-view")).toBeInTheDocument();
    expect(screen.getByTestId("tool-back")).toHaveAttribute("href", "/tools");
    expect(screen.getByTestId("metronome-bpm-display")).toHaveTextContent("120");
    expect(screen.getByTestId("metronome-bpm-input")).toHaveValue(120);
    expect(screen.getByTestId("metronome-bpm-slider")).toHaveValue("120");
    expect(screen.getByTestId("metronome-visual")).toBeInTheDocument();
    expect(screen.getAllByTestId(/metronome-beat-\d+/)).toHaveLength(4);
  });

  it("adjusts BPM via slider and steppers", async () => {
    render(StandaloneMetronomeView);

    const slider = screen.getByTestId("metronome-bpm-slider");
    await fireEvent.input(slider, { target: { value: "140" } });
    expect(screen.getByTestId("metronome-bpm-display")).toHaveTextContent("140");
    expect(screen.getByTestId("metronome-bpm-input")).toHaveValue(140);

    await fireEvent.click(screen.getByTestId("metronome-bpm-plus-1"));
    expect(screen.getByTestId("metronome-bpm-display")).toHaveTextContent("141");

    await fireEvent.click(screen.getByTestId("metronome-bpm-minus-5"));
    expect(screen.getByTestId("metronome-bpm-display")).toHaveTextContent("136");
  });

  it("updates visual beat count on time signature change", async () => {
    render(StandaloneMetronomeView);

    const sigSelect = screen.getByTestId("metronome-time-signature");
    await fireEvent.change(sigSelect, { target: { value: "3/4" } });
    expect(screen.getAllByTestId(/metronome-beat-\d+/)).toHaveLength(3);

    await fireEvent.change(sigSelect, { target: { value: "6/8" } });
    expect(screen.getAllByTestId(/metronome-beat-\d+/)).toHaveLength(6);
  });

  it("toggles start and stop", async () => {
    render(StandaloneMetronomeView);

    const toggleBtn = screen.getByTestId("metronome-toggle");
    expect(toggleBtn).toHaveTextContent(/start/i);

    await fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveTextContent(/stop/i);

    await fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveTextContent(/start/i);
  });

  it("responds to tap tempo", async () => {
    render(StandaloneMetronomeView);

    const tapBtn = screen.getByTestId("metronome-tap");
    await fireEvent.click(tapBtn);
    await fireEvent.click(tapBtn);
    expect(screen.getByTestId("metronome-bpm-display")).toBeInTheDocument();
  });
});
