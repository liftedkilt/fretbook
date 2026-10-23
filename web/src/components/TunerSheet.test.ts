import { fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { midiToFrequency } from "../lib/listen/notes";
import { openTuner, ui } from "../lib/ui.svelte";
import TunerSheet from "./TunerSheet.svelte";

let emit: (frequency: number | null) => void = () => {};
const stopSession = vi.fn(async () => {});
const startListening = vi.fn();

vi.mock("../lib/api", () => ({
  getMe: vi.fn(),
  getMeta: vi.fn(),
  listSongs: vi.fn(),
  saveSettings: vi.fn(),
}));

vi.mock("../lib/listen", async () => {
  return {
    ListenError: class ListenError extends Error {
      constructor(readonly problem: string) {
        super(problem);
      }
    },
    describeProblem: (problem: string) => `problem:${problem}`,
    startListening: (options: { onPitch: (event: unknown) => void }) => startListening(options),
  };
});

// The real playReferenceTone runs against a fake AudioContext, so its tone code is exercised too.
const oscillators: { frequency: { value: number }; stop: ReturnType<typeof vi.fn> }[] = [];
const contextClose = vi.fn(async () => {});
class FakeAudioContext {
  currentTime = 0;
  destination = {};
  close = contextClose;
  createOscillator() {
    const oscillator = {
      type: "",
      frequency: { value: 0 },
      connect: (node: unknown) => node,
      start: vi.fn(),
      stop: vi.fn(),
    };
    oscillators.push(oscillator);
    return oscillator;
  }
  createGain() {
    const param = {
      value: 0,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
    };
    return { gain: param, connect: (node: unknown) => node };
  }
}
vi.stubGlobal("AudioContext", FakeAudioContext);

function event(frequency: number | null) {
  return {
    time: 0,
    frequency,
    clarity: 1,
    midi: null,
    cents: null,
    onset: false,
    onsetTime: null,
  };
}

beforeEach(() => {
  ui.sheet = "";
  ui.tunerRequest = null;
  stopSession.mockClear();
  oscillators.length = 0;
  contextClose.mockClear();
  startListening.mockReset();
  startListening.mockImplementation(async (options: { onPitch: (event: unknown) => void }) => {
    emit = (frequency) => options.onPitch(event(frequency));
    return { stop: stopSession };
  });
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

describe("TunerSheet", () => {
  it("preloads the song's tuning and shows the nearest string with its cents", async () => {
    render(TunerSheet);
    openTuner({ tuning: [64, 59, 55, 50, 45, 40], capo: 0 });
    expect(await screen.findByTestId("tuner-string-5")).toHaveTextContent("E2");
    await fireEvent.click(screen.getByTestId("tuner-start"));
    emit(midiToFrequency(45) * 2 ** (-12 / 1200));
    expect(await screen.findByTestId("tuner-note")).toHaveTextContent("A2");
    expect(screen.getByTestId("tuner-cents")).toHaveTextContent("-12");
    expect(screen.getByTestId("tuner-needle").dataset.position).toBe("-0.24");
    expect(screen.getByTestId("tuner-string-4")).toHaveClass("tuner-string-active");
  });

  it("ticks once the string has held steady in tune", async () => {
    render(TunerSheet);
    openTuner({ tuning: [64, 59, 55, 50, 45, 40], capo: 0 });
    await fireEvent.click(await screen.findByTestId("tuner-start"));
    for (let i = 0; i < 6; i++) emit(midiToFrequency(50));
    expect(await screen.findByTestId("tuner-tick")).toHaveTextContent(/in tune/i);
  });

  it("offers the capo and tunes the raised pitches on request", async () => {
    render(TunerSheet);
    openTuner({ tuning: [64, 59, 55, 50, 45, 40], capo: 2 });
    await fireEvent.click(await screen.findByTestId("tuner-capo"));
    expect(screen.getByTestId("tuner-string-5")).toHaveTextContent("F#2");
  });

  it("is chromatic from the top bar and has the presets", async () => {
    render(TunerSheet);
    openTuner();
    const source = (await screen.findByTestId("tuner-source")) as HTMLSelectElement;
    expect(source.value).toBe("chromatic");
    expect(screen.queryByTestId("tuner-strings")).not.toBeInTheDocument();
    expect(source.options.length).toBe(9);
    await fireEvent.click(screen.getByTestId("tuner-start"));
    emit(midiToFrequency(61));
    expect(await screen.findByTestId("tuner-note")).toHaveTextContent("C#4");
    await fireEvent.change(source, { target: { value: "bass4" } });
    expect(screen.getByTestId("tuner-string-3")).toHaveTextContent("E1");
  });

  it("uses the chosen A4 and plays a reference tone for a tapped string", async () => {
    render(TunerSheet);
    openTuner({ tuning: [69], capo: 0 });
    await fireEvent.input(await screen.findByTestId("tuner-a4"), { target: { value: "432" } });
    expect(screen.getByTestId("tuner-a4-value")).toHaveTextContent("432 Hz");
    await fireEvent.click(screen.getByTestId("tuner-string-0"));
    expect(oscillators).toHaveLength(1);
    expect(oscillators[0].frequency.value).toBeCloseTo(432, 5);
    await fireEvent.click(screen.getByTestId("tuner-string-0"));
    expect(oscillators[0].stop).toHaveBeenCalled();
  });

  it("explains a blocked microphone and releases it when closed", async () => {
    startListening.mockRejectedValueOnce(
      Object.assign(new Error("x"), { problem: "denied", name: "ListenError" }),
    );
    render(TunerSheet);
    openTuner();
    await fireEvent.click(await screen.findByTestId("tuner-start"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/problem:/);

    await fireEvent.click(screen.getByTestId("tuner-start"));
    ui.sheet = "";
    await vi.waitFor(() => expect(stopSession).toHaveBeenCalled());
  });
});
