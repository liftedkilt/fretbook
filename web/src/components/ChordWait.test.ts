import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ChordWait from "./ChordWait.svelte";

let options: { onChroma?: (event: unknown) => void } = {};
const stopSession = vi.fn(async () => {});
const startListening = vi.fn();

vi.mock("../lib/listen/input", async (original) => ({
  ...(await original<typeof import("../lib/listen/input")>()),
  ListenError: class ListenError extends Error {
    constructor(readonly problem: string) {
      super(problem);
    }
  },
  describeProblem: (problem: string) => `problem:${problem}`,
  startListening: (given: unknown) => startListening(given),
}));

const SHEET = "[C]one [G]two {comment: x}\n[N.C.]rest [Am]three";

function chroma(pcs: number[], time: number) {
  const bins = new Array(12).fill(0);
  for (const pc of pcs) bins[pc] = 1;
  return { time, bins, span: 0.17, onset: true, onsetTime: time - 0.2 };
}

function setup(text = SHEET, transpose = 0) {
  const onactive = vi.fn();
  render(ChordWait, { props: { text, transpose, onactive } });
  return onactive;
}

describe("ChordWait", () => {
  beforeEach(() => {
    options = {};
    stopSession.mockClear();
    startListening.mockReset();
    startListening.mockImplementation(async (given) => {
      options = given;
      return {
        sampleRate: 48000,
        channelCount: 1,
        setChannel: () => undefined,
        setExpectedMidi: () => undefined,
        setChroma: () => undefined,
        stop: stopSession,
      };
    });
  });

  it("opens the chosen input and shows the level meter", async () => {
    localStorage.clear();
    localStorage.setItem("fretbook.listen.device", "scarlett");
    localStorage.setItem("fretbook.listen.channels", JSON.stringify({ scarlett: 1 }));
    setup();
    await fireEvent.click(screen.getByTestId("chord-wait-toggle"));
    await tick();
    expect(startListening).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: "scarlett", channel: 1 }),
    );
    expect(screen.getByTestId("listen-meter")).toHaveAttribute("aria-valuenow", "0");
    (options as { onLevel?: (level: { rms: number; peak: number }) => void }).onLevel?.({
      rms: 1,
      peak: 1,
    });
    await tick();
    expect(screen.getByTestId("listen-meter")).toHaveAttribute("aria-valuenow", "100");
  });

  it("says when a sheet has no chords", () => {
    setup("just words");
    expect(screen.getByTestId("chord-wait-empty")).toBeTruthy();
    expect(screen.queryByTestId("chord-wait-toggle")).toBeNull();
  });

  it("lights the first chord, advances on the right strum and finishes", async () => {
    const onactive = setup();
    await fireEvent.click(screen.getByTestId("chord-wait-toggle"));
    await tick();
    const status = screen.getByTestId("chord-wait-status");
    expect(status.dataset.state).toBe("waiting");
    expect(status.dataset.total).toBe("3");
    expect(status.textContent).toContain("Play C");
    expect(onactive).toHaveBeenLastCalledWith("0:0:0");

    // A G chord is not C; the cursor stays.
    options.onChroma?.(chroma([7, 11, 2], 1));
    await tick();
    expect(status.textContent).toContain("Play C");

    options.onChroma?.(chroma([0, 4, 7], 2));
    await tick();
    expect(status.textContent).toContain("Play G");
    expect(status.dataset.hits).toBe("1");
    expect(onactive).toHaveBeenLastCalledWith("0:0:1");

    options.onChroma?.(chroma([7, 11, 2], 3));
    await tick();
    // N.C. is not a chord, so the next one is Am.
    expect(status.textContent).toContain("Play Am");
    expect(onactive).toHaveBeenLastCalledWith("0:1:1");

    options.onChroma?.(chroma([9, 0, 4], 4));
    await tick();
    expect(status.dataset.state).toBe("done");
    expect(status.dataset.hits).toBe("3");
    expect(status.textContent).toContain("Done: 3 of 3");
    expect(onactive).toHaveBeenLastCalledWith(null);
  });

  it("skips a chord without counting it", async () => {
    setup();
    await fireEvent.click(screen.getByTestId("chord-wait-toggle"));
    await tick();
    await fireEvent.click(screen.getByTestId("chord-wait-skip"));
    const status = screen.getByTestId("chord-wait-status");
    expect(status.textContent).toContain("Play G");
    expect(status.dataset.hits).toBe("0");
  });

  it("stops listening and clears the highlight when switched off", async () => {
    const onactive = setup();
    await fireEvent.click(screen.getByTestId("chord-wait-toggle"));
    await tick();
    await fireEvent.click(screen.getByTestId("chord-wait-toggle"));
    await tick();
    expect(stopSession).toHaveBeenCalled();
    expect(screen.queryByTestId("chord-wait-status")).toBeNull();
    expect(onactive).toHaveBeenLastCalledWith(null);
  });

  it("explains a microphone that would not open", async () => {
    startListening.mockRejectedValue(
      new (await import("../lib/listen/input")).ListenError("denied"),
    );
    setup();
    await fireEvent.click(screen.getByTestId("chord-wait-toggle"));
    await tick();
    expect(screen.getByTestId("chord-wait-error").textContent).toContain("problem:denied");
    expect(screen.queryByTestId("chord-wait-status")).toBeNull();
  });
});
