import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AutoSyncProposal, Job, ScoreDocument } from "../lib/types";
import AutoSyncSheet from "./AutoSyncSheet.svelte";

const api = vi.hoisted(() => ({
  startAutoSync: vi.fn(),
  getJob: vi.fn(),
  dismissJob: vi.fn(),
}));
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  startAutoSync: api.startAutoSync,
  getJob: api.getJob,
  dismissJob: api.dismissJob,
}));

const clicker = vi.hoisted(() => ({ click: vi.fn(), unlock: vi.fn(), close: vi.fn() }));
vi.mock("../lib/clicker", () => ({
  Clicker: class {
    click = clicker.click;
    unlock = clicker.unlock;
    close = clicker.close;
  },
}));

const score = {
  version: 1,
  bpm: 120,
  bars: [0, 1, 2].map(() => ({
    signature: [4, 4],
    tempo: null,
    repeat_start: false,
    repeat_end: 0,
    alternate_endings: [],
    directions: [],
    section: null,
    extras: {},
  })),
  tracks: [],
  sync: { video_id: null, points: [], anchors: {}, keyed_by: "played" },
} as unknown as ScoreDocument;

const proposal: AutoSyncProposal = {
  anchors: { "0": 1, "1": 3, "2": 5, "3": 7 },
  confidence: { "0": 0.9, "1": 0.3, "2": 0.8, "3": 0.8 },
  overall: 0.7,
  tempo_bpm: 120.4,
  beat_count: 14,
  audio_seconds: 8,
  low_confidence: [1],
};

function job(partial: Partial<Job>): Job {
  return {
    id: "j1",
    kind: "audio.autosync",
    status: "done",
    result: null,
    error: null,
    error_key: "",
    error_params: {},
    progress: "",
    progress_key: "",
    ...partial,
  };
}

function mount(props: { existing?: number } = {}) {
  const onaccept = vi.fn();
  const onclose = vi.fn();
  render(AutoSyncSheet, {
    open: true,
    songId: "s1",
    document: score,
    audioUrl: "http://localhost/audio.mp3",
    existing: props.existing ?? 0,
    onclose,
    onaccept,
  });
  return { onaccept, onclose };
}

beforeEach(() => {
  api.startAutoSync.mockReset().mockResolvedValue({ job_id: "j1" });
  api.getJob.mockReset();
  api.dismissJob.mockReset().mockResolvedValue(undefined);
  clicker.click.mockReset();
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

describe("AutoSyncSheet", () => {
  it("estimates, shows what it found and hands the anchors over on accept", async () => {
    api.getJob.mockResolvedValue(job({ result: { autosync: proposal } }));
    const { onaccept } = mount();
    expect(api.startAutoSync).toHaveBeenCalledWith("s1");
    await waitFor(() => expect(api.dismissJob).toHaveBeenCalledWith("j1"));
    const summary = await screen.findByTestId("autosync-summary");
    expect(summary.textContent).toContain("3 bar marks found");
    expect(summary.textContent).toContain("70% confidence");
    expect(summary.textContent).toContain("120 BPM");
    expect(screen.getByTestId("autosync-check").textContent).toContain("bars 2");
    expect(screen.queryByTestId("autosync-replaces")).toBeNull();
    // The preview starts at the first bar worth checking.
    expect((screen.getByTestId("autosync-start") as HTMLInputElement).value).toBe("2");

    await fireEvent.click(screen.getByTestId("autosync-accept"));
    expect(onaccept).toHaveBeenCalledWith(proposal.anchors);
  });

  it("says how many existing marks accepting replaces", async () => {
    api.getJob.mockResolvedValue(job({ result: { autosync: proposal } }));
    mount({ existing: 5 });
    expect((await screen.findByTestId("autosync-replaces")).textContent).toContain(
      "5 current marks",
    );
  });

  it("waits while the job runs, then shows the result", async () => {
    api.getJob
      .mockResolvedValueOnce(job({ status: "running", progress_key: "autoSync.tracking" }))
      .mockResolvedValue(job({ result: { autosync: proposal } }));
    mount();
    await waitFor(() =>
      expect(screen.getByTestId("autosync-working").textContent).toContain("Finding the beats"),
    );
    await screen.findByTestId("autosync-summary", undefined, { timeout: 3000 });
  });

  it("shows a failed job's error in the reader's language and can try again", async () => {
    api.getJob.mockResolvedValueOnce(
      job({ status: "error", error: "no beat", error_key: "autosync.noBeat" }),
    );
    mount();
    const alert = await screen.findByTestId("autosync-error");
    expect(alert.textContent).toContain("No steady beat was found");
    expect(api.dismissJob).toHaveBeenCalledWith("j1");
    api.getJob.mockResolvedValue(job({ result: { autosync: proposal } }));
    await fireEvent.click(screen.getByTestId("autosync-retry"));
    await screen.findByTestId("autosync-summary");
    expect(api.startAutoSync).toHaveBeenCalledTimes(2);
  });

  it("shows an error when the request itself is refused", async () => {
    api.startAutoSync.mockRejectedValue(new Error("This song has no audio."));
    mount();
    expect((await screen.findByTestId("autosync-error")).textContent).toContain("no audio");
  });

  it("treats a finished job without a proposal as a failure", async () => {
    api.getJob.mockResolvedValue(job({ result: {} }));
    mount();
    expect((await screen.findByTestId("autosync-error")).textContent).toContain("without a result");
  });

  it("plays the audio with clicks over the proposed bars, and stops", async () => {
    api.getJob.mockResolvedValue(job({ result: { autosync: proposal } }));
    const audio = { currentTime: 0, play: vi.fn().mockResolvedValue(undefined), pause: vi.fn() };
    vi.stubGlobal(
      "Audio",
      vi.fn(() => audio),
    );
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      mount();
      await vi.waitFor(() => expect(screen.getByTestId("autosync-preview")).toBeTruthy());
      await fireEvent.click(screen.getByTestId("autosync-preview"));
      // Bar 2 starts at 3 s in the proposal.
      expect(audio.currentTime).toBe(3);
      expect(audio.play).toHaveBeenCalled();
      audio.currentTime = 3.02;
      vi.advanceTimersByTime(80);
      expect(clicker.click).toHaveBeenCalled();
      const [delay, accent] = clicker.click.mock.calls[0];
      expect(accent).toBe(true);
      expect(delay).toBeLessThan(0.1);
      await fireEvent.click(screen.getByTestId("autosync-stop"));
      expect(audio.pause).toHaveBeenCalled();
      expect(screen.getByTestId("autosync-preview")).toBeTruthy();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("keeps the starting bar inside the song", async () => {
    api.getJob.mockResolvedValue(job({ result: { autosync: proposal } }));
    mount();
    const input = (await screen.findByTestId("autosync-start")) as HTMLInputElement;
    input.value = "99";
    await fireEvent.change(input);
    await waitFor(() => expect(input.value).toBe("3"));
  });

  it("discards without handing anything over", async () => {
    api.getJob.mockResolvedValue(job({ result: { autosync: proposal } }));
    const { onaccept, onclose } = mount();
    await fireEvent.click(await screen.findByTestId("autosync-discard"));
    expect(onclose).toHaveBeenCalled();
    expect(onaccept).not.toHaveBeenCalled();
  });
});
