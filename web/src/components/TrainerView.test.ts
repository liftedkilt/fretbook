import { fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TrainerView from "./TrainerView.svelte";
import { startListening, type ChromaEvent, type ListenSession } from "../lib/listen";

const mocks = vi.hoisted(() => ({
  record: vi.fn(async () => undefined),
  playMelodic: vi.fn(async () => undefined),
  playChord: vi.fn(async () => undefined),
}));

vi.mock("../lib/api", () => ({ recordPracticeExercise: mocks.record }));
vi.mock("../lib/trainer/audio", () => ({
  playMelodic: mocks.playMelodic,
  playChord: mocks.playChord,
  playNote: vi.fn(),
}));
vi.mock("../lib/listen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/listen")>()),
  startListening: vi.fn(async () => {
    throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
  }),
}));

describe("TrainerView", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    vi.spyOn(Math, "random").mockReturnValue(0);
    localStorage.clear();
    mocks.record.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("asks for a note on a string, scores a tap, and logs the game", async () => {
    render(TrainerView);
    await fireEvent.change(screen.getByTestId("trainer-time"), { target: { value: "0" } });
    await fireEvent.click(screen.getByTestId("trainer-start"));
    // random() = 0 asks for C on the high E string; that is the 8th fret.
    expect(screen.getByTestId("trainer-note")).toHaveTextContent("C");
    expect(screen.getByTestId("trainer-prompt")).toHaveTextContent("string 1");
    await fireEvent.click(screen.getByTestId("fret-tap-0-8"));
    expect(screen.getByTestId("trainer-score")).toHaveTextContent("1 of 1");
    expect(screen.getByTestId("trainer-feedback")).toHaveTextContent("Right");
    await vi.advanceTimersByTimeAsync(1000);
    // A tap on the wrong string is wrong even when the note is right.
    await fireEvent.click(screen.getByTestId("fret-tap-1-1"));
    expect(screen.getByTestId("trainer-score")).toHaveTextContent("1 of 2");
    expect(screen.getByTestId("trainer-feedback")).toHaveTextContent("Not quite");
    await vi.advanceTimersByTimeAsync(5000);
    await fireEvent.click(screen.getByTestId("trainer-stop"));

    expect(screen.getByTestId("trainer-final-score")).toHaveTextContent("50%");
    expect(screen.getByTestId("trainer-new-best")).toBeInTheDocument();
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "fretboard", rounds: 2, correct: 1, score: 50 }),
    );
    // The per-string table remembers the high string.
    expect(screen.getByTestId("trainer-string-0")).toHaveTextContent("50%");
    expect(JSON.parse(localStorage.getItem("fretbook.trainer")!).bests).toBeTruthy();
  });

  it("ends a timed round when the time is up", async () => {
    render(TrainerView);
    await fireEvent.change(screen.getByTestId("trainer-time"), { target: { value: "30" } });
    await fireEvent.click(screen.getByTestId("trainer-start"));
    expect(screen.getByTestId("trainer-remaining")).toHaveTextContent("30");
    await vi.advanceTimersByTimeAsync(31_000);
    expect(screen.getByTestId("trainer-results")).toHaveTextContent("No rounds");
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("plays an interval, takes a button answer and shows the right one when wrong", async () => {
    render(TrainerView);
    await fireEvent.click(screen.getByTestId("trainer-tab-interval"));
    await fireEvent.change(screen.getByTestId("trainer-time"), { target: { value: "0" } });
    await fireEvent.click(screen.getByTestId("trainer-start"));
    expect(mocks.playMelodic).toHaveBeenCalledTimes(1);
    // random() = 0 on the easy set is a minor third going up.
    await fireEvent.click(screen.getByTestId("trainer-choice-P5"));
    expect(screen.getByTestId("trainer-reveal")).toHaveTextContent("Minor 3rd");
    await vi.advanceTimersByTimeAsync(2000);
    await fireEvent.click(screen.getByTestId("trainer-choice-m3"));
    expect(screen.getByTestId("trainer-score")).toHaveTextContent("1 of 2");
    await vi.advanceTimersByTimeAsync(2000);
    await fireEvent.click(screen.getByTestId("trainer-stop"));
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "interval", rounds: 2, correct: 1 }),
    );
  });

  it("plays a chord and checks its quality", async () => {
    render(TrainerView);
    await fireEvent.click(screen.getByTestId("trainer-tab-chord"));
    expect(screen.getByTestId("trainer-answer-by")).toHaveValue("buttons");
    await fireEvent.change(screen.getByTestId("trainer-time"), { target: { value: "0" } });
    await fireEvent.click(screen.getByTestId("trainer-start"));
    expect(mocks.playChord).toHaveBeenCalledTimes(1);
    await fireEvent.click(screen.getByTestId("trainer-choice-major"));
    expect(screen.getByTestId("trainer-score")).toHaveTextContent("1 of 1");
    expect(screen.getByTestId("trainer-streak")).toHaveTextContent("1");
  });

  it("explains a microphone that cannot be used and does not start", async () => {
    render(TrainerView);
    await fireEvent.change(screen.getByTestId("trainer-answer-by"), { target: { value: "play" } });
    await fireEvent.click(screen.getByTestId("trainer-start"));
    expect(await screen.findByTestId("trainer-problem")).toBeInTheDocument();
    expect(screen.queryByTestId("trainer-hud")).toBeNull();
  });

  it("shows the listen panel only when answering by playing, and uses the chosen input", async () => {
    localStorage.setItem("fretbook.listen.device", "scarlett");
    let onLevel: ((level: { rms: number; peak: number }) => void) | undefined;
    const session = { channelCount: 1, setChroma: vi.fn(), stop: vi.fn(async () => undefined) };
    vi.mocked(startListening).mockImplementationOnce(async (options) => {
      onLevel = options?.onLevel;
      expect(options?.deviceId).toBe("scarlett");
      return session as unknown as ListenSession;
    });
    render(TrainerView);
    expect(screen.queryByTestId("listen-panel")).toBeNull();
    await fireEvent.change(screen.getByTestId("trainer-answer-by"), { target: { value: "play" } });
    expect(screen.getByTestId("listen-panel")).toBeInTheDocument();
    await fireEvent.click(screen.getByTestId("trainer-start"));
    await vi.advanceTimersByTimeAsync(0);
    onLevel?.({ rms: 1, peak: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByTestId("listen-meter")).toHaveAttribute("aria-valuenow", "100");
  });

  it("answers the chord game by playing the chord", async () => {
    let onChroma: ((event: ChromaEvent) => void) | undefined;
    const session = { setChroma: vi.fn(), stop: vi.fn(async () => undefined) };
    vi.mocked(startListening).mockImplementationOnce(async (options) => {
      onChroma = options?.onChroma;
      return session as unknown as ListenSession;
    });
    // Strums of C major (random() = 0 asks for a major chord on C) and then of C minor.
    const strum = (time: number, pcs: number[], onset = false): ChromaEvent => ({
      time,
      span: 0.05,
      onset,
      onsetTime: onset ? time - 0.1 : null,
      bins: Array.from({ length: 12 }, (_, pc) => (pcs.includes(pc) ? 1 : 0)),
    });
    render(TrainerView);
    await fireEvent.click(screen.getByTestId("trainer-tab-chord"));
    await fireEvent.change(screen.getByTestId("trainer-answer-by"), { target: { value: "play" } });
    await fireEvent.change(screen.getByTestId("trainer-time"), { target: { value: "0" } });
    await fireEvent.click(screen.getByTestId("trainer-start"));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.setChroma).toHaveBeenCalledWith(true);
    expect(screen.queryByTestId("trainer-choices")).toBeNull();
    expect(screen.getByTestId("trainer-prompt")).toHaveTextContent("Play the chord");

    onChroma!(strum(1, [0, 4, 7], true));
    onChroma!(strum(1.05, [0, 4, 7]));
    onChroma!(strum(1.1, [0, 4, 7]));
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByTestId("trainer-score")).toHaveTextContent("1 of 1");
    expect(screen.getByTestId("trainer-feedback")).toHaveTextContent("Right");
    await vi.advanceTimersByTimeAsync(1000);

    // The next question is also a major chord on C; a minor chord is the wrong answer, and the
    // reveal names the root as well as the quality.
    onChroma!(strum(5, [0, 3, 7], true));
    for (let i = 1; i <= 6; i += 1) onChroma!(strum(5 + i * 0.05, [0, 3, 7]));
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByTestId("trainer-score")).toHaveTextContent("1 of 2");
    expect(screen.getByTestId("trainer-reveal")).toHaveTextContent("It was: C Major");
    await vi.advanceTimersByTimeAsync(3000);
    await fireEvent.click(screen.getByTestId("trainer-stop"));
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "chord", rounds: 2, correct: 1 }),
    );
  });
});
