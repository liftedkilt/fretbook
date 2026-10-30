import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { midiToFrequency } from "../lib/listen/notes";
import { openTuner, ui } from "../lib/ui.svelte";
import TunerSheet from "./TunerSheet.svelte";

let emit: (frequency: number | null, time?: number) => void = () => {};
const stopSession = vi.fn(async () => {});
const setExpectedMidi = vi.fn();
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

function event(frequency: number | null, time = 0) {
  return {
    time,
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
  setExpectedMidi.mockClear();
  oscillators.length = 0;
  contextClose.mockClear();
  startListening.mockReset();
  startListening.mockImplementation(async (options: { onPitch: (event: unknown) => void }) => {
    emit = (frequency, time) => options.onPitch(event(frequency, time));
    return { stop: stopSession, setExpectedMidi };
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
    emit(midiToFrequency(50), 0);
    emit(midiToFrequency(50), 0.5);
    expect(screen.getByTestId("tuner-tick")).not.toHaveTextContent(/in tune/i);
    emit(midiToFrequency(50), 1);
    expect(await screen.findByTestId("tuner-tick")).toHaveTextContent(/in tune/i);
    expect(screen.getByTestId("tuner-string-3")).toHaveClass("tuner-string-tuned");
    expect(oscillators.length).toBeGreaterThan(0); // the success chime
  });

  it("stays quiet when muted, and says when every string is in tune", async () => {
    render(TunerSheet);
    openTuner({ tuning: [50, 45], capo: 0 });
    await fireEvent.click(await screen.findByTestId("tuner-mute"));
    await fireEvent.click(screen.getByTestId("tuner-start"));
    let time = 0;
    for (const midi of [50, 45]) {
      emit(midiToFrequency(midi), time);
      emit(midiToFrequency(midi), time + 1);
      time += 2;
    }
    expect(oscillators).toHaveLength(0);
    expect(await screen.findByTestId("tuner-all-tuned")).toHaveTextContent(/all strings in tune/i);
    await fireEvent.click(screen.getByTestId("tuner-restart"));
    expect(screen.queryByTestId("tuner-all-tuned")).not.toBeInTheDocument();
    expect(screen.getByTestId("tuner-string-0")).not.toHaveClass("tuner-string-tuned");
  });

  it("steadies the readout: one stray reading and a short dropout do not move it", async () => {
    render(TunerSheet);
    openTuner({ tuning: [64, 59, 55, 50, 45, 40], capo: 0 });
    await fireEvent.click(await screen.findByTestId("tuner-start"));
    [0, 0.05, 0.1, 0.15].forEach((time) => emit(midiToFrequency(50), time));
    emit(midiToFrequency(50) * 2 ** (30 / 1200), 0.2);
    await tick();
    expect(screen.getByTestId("tuner-needle").dataset.position).toBe("0.00");
    emit(null, 0.3);
    await tick();
    expect(screen.getByTestId("tuner-note")).toHaveTextContent("D3");
    emit(null, 1);
    await tick();
    expect(screen.getByTestId("tuner-note")).toHaveTextContent("–");
  });

  it("tells you which way to tune", async () => {
    render(TunerSheet);
    openTuner({ tuning: [64, 59, 55, 50, 45, 40], capo: 0 });
    await fireEvent.click(await screen.findByTestId("tuner-start"));
    emit(midiToFrequency(50) * 2 ** (-20 / 1200), 0);
    await tick();
    expect(screen.getByTestId("tuner-direction")).toHaveTextContent("Tune up");
    emit(midiToFrequency(50) * 2 ** (20 / 1200), 5);
    emit(midiToFrequency(50) * 2 ** (20 / 1200), 5.01);
    emit(midiToFrequency(50) * 2 ** (20 / 1200), 5.02);
    await tick();
    expect(screen.getByTestId("tuner-direction")).toHaveTextContent("Tune down");
  });

  it("locks to a tapped string when Auto is off", async () => {
    render(TunerSheet);
    openTuner({ tuning: [64, 59, 55, 50, 45, 40], capo: 0 });
    await fireEvent.click(await screen.findByTestId("tuner-auto"));
    await fireEvent.click(screen.getByTestId("tuner-string-5"));
    await fireEvent.click(screen.getByTestId("tuner-string-5")); // stop the reference tone it started
    await fireEvent.click(screen.getByTestId("tuner-start"));
    emit(midiToFrequency(45), 0);
    await tick();
    expect(screen.getByTestId("tuner-note")).toHaveTextContent("E2");
    expect(screen.getByTestId("tuner-cents")).toHaveTextContent("+500");
  });

  it("ignores the mic while the reference tone plays, and listens again when it stops", async () => {
    render(TunerSheet);
    openTuner({ tuning: [64, 59, 55, 50, 45, 40], capo: 0 });
    await fireEvent.click(await screen.findByTestId("tuner-start"));
    await fireEvent.click(screen.getByTestId("tuner-string-3"));
    emit(midiToFrequency(50), 0);
    await tick();
    expect(screen.getByTestId("tuner-note")).toHaveTextContent("–");
    await fireEvent.click(screen.getByTestId("tuner-string-3"));
    emit(midiToFrequency(50), 1);
    await tick();
    expect(screen.getByTestId("tuner-note")).toHaveTextContent("D3");
  });

  it("tells the detector the locked string", async () => {
    render(TunerSheet);
    openTuner({ tuning: [64, 59, 55, 50, 45, 40], capo: 0 });
    await fireEvent.click(await screen.findByTestId("tuner-auto"));
    await fireEvent.click(screen.getByTestId("tuner-string-5"));
    await fireEvent.click(screen.getByTestId("tuner-start"));
    await tick();
    expect(setExpectedMidi).toHaveBeenLastCalledWith(40, false);
    await fireEvent.click(screen.getByTestId("tuner-string-4"));
    await tick();
    expect(setExpectedMidi).toHaveBeenLastCalledWith(45, false);
  });

  it("hints in auto mode only once a string is steady, and drops it after a jump", async () => {
    render(TunerSheet);
    openTuner({ tuning: [64, 59, 55, 50, 45, 40], capo: 0 });
    await fireEvent.click(await screen.findByTestId("tuner-start"));
    await tick();
    expect(setExpectedMidi).not.toHaveBeenCalledWith(45, false);
    for (let i = 0; i < 3; i++) emit(midiToFrequency(45), i * 0.02);
    expect(setExpectedMidi).toHaveBeenLastCalledWith(45, false);
    for (let i = 0; i < 2; i++) emit(midiToFrequency(50), 1 + i * 0.02);
    expect(setExpectedMidi).toHaveBeenLastCalledWith(null, false);
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
