import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import { defaultPractice } from "../lib/practice";
import { saveSheetTab } from "../lib/playerSheet";
import PlayerSheet from "./PlayerSheet.svelte";

function props(extra: Record<string, unknown> = {}) {
  return {
    songId: "song-1",
    practice: defaultPractice(),
    hasAudio: false,
    readOnly: false,
    demo: false,
    tracks: [
      { id: "bass", name: "Bass" },
      { id: "guitar", name: "Guitar" },
    ],
    audioUrl: "",
    audioEl: null,
    canTranscribe: true,
    anchorCount: 0,
    publishedSync: false,
    pendingSync: false,
    bpm: 96,
    tapIndex: 2,
    saveLabel: "",
    loopA: null,
    loopB: null,
    activeLoopId: null,
    speedTrainerRunning: false,
    speedTrainerPercent: 100,
    speedTrainerPass: 1,
    speedTrainerCompleted: false,
    rate: 1,
    waitOn: false,
    waitAvailable: true,
    waitError: "",
    scoreOn: false,
    scoreSummary: null,
    scoreBleed: false,
    scoreCalibrated: true,
    scoreError: "",
    listenSession: null,
    listenDevice: "",
    listenChannel: 0,
    listenLevel: 0,
    notation: false,
    stage: false,
    onclose: vi.fn(),
    onpractice: vi.fn(),
    onfree: vi.fn(),
    onwait: vi.fn(),
    onscore: vi.fn(),
    onwaitoptions: vi.fn(),
    onloop: vi.fn(),
    onclearloop: vi.fn(),
    onjump: vi.fn(),
    onrate: vi.fn(),
    ontap: vi.fn(),
    onnudge: vi.fn(),
    onclearanchor: vi.fn(),
    onrestore: vi.fn(),
    onclearall: vi.fn(),
    onautosync: vi.fn(),
    ontranscribe: vi.fn(),
    onbpm: vi.fn(),
    onupload: vi.fn(),
    onyoutube: vi.fn(),
    onstems: vi.fn(),
    onnotation: vi.fn(),
    onstage: vi.fn(),
    onlistenDevice: vi.fn(),
    onlistenChannel: vi.fn(),
    ...extra,
  };
}

describe("PlayerSheet", () => {
  it("opens on Practice with modes, the loop and the speed, and keeps the other tools on their tabs", async () => {
    localStorage.clear();
    const given = props();
    render(PlayerSheet, { props: given });

    expect(screen.getByTestId("practice-mode-free").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("wait-toggle")).toBeTruthy();
    expect(screen.getByTestId("wait-silent")).toBeTruthy();
    expect(screen.getByTestId("listen-panel")).toBeTruthy();
    expect(screen.getByTestId("loop-panel")).toBeTruthy();
    expect(screen.getByTestId("player-rate")).toBeTruthy();
    expect(screen.getByTestId("speed-trainer-panel")).toBeTruthy();
    expect(screen.queryByTestId("metronome-toggle")).toBeNull();
    expect(screen.queryByTestId("player-tap")).toBeNull();
    expect(screen.queryByTestId("fretboard-on")).toBeNull();

    await fireEvent.click(screen.getByTestId("score-toggle"));
    expect(given.onscore).toHaveBeenCalledOnce();
    await fireEvent.click(screen.getByTestId("practice-mode-free"));
    expect(given.onfree).toHaveBeenCalledOnce();

    await fireEvent.click(screen.getByTestId("player-sheet-tab-audio"));
    expect(screen.getByTestId("metronome-toggle")).toBeTruthy();
    expect(screen.getByTestId("player-upload")).toBeTruthy();
    expect(screen.queryByTestId("loop-panel")).toBeNull();

    await fireEvent.click(screen.getByTestId("player-sheet-tab-sync"));
    expect(screen.queryByTestId("player-tap")).toBeNull();
    expect(screen.queryByTestId("player-transcribe")).toBeNull();
    expect(screen.getByRole("spinbutton")).toBeTruthy();

    await fireEvent.click(screen.getByTestId("player-sheet-tab-view"));
    expect(screen.getByTestId("fretboard-on")).toBeTruthy();
    expect(screen.getByTestId("player-notation")).toBeTruthy();
    expect(screen.getByTestId("stage-toggle")).toBeTruthy();
    expect(screen.queryByTestId("player-track")).toBeNull();
    expect(localStorage.getItem("fretbook.playerSheetTab")).toBe("view");
  });

  it("puts the recording tools on Audio and Sync, and explains why wait mode is off when unavailable", async () => {
    localStorage.clear();
    const given = props({
      hasAudio: true,
      waitAvailable: false,
      audioUrl: "/api/songs/song-1/audio",
    });
    render(PlayerSheet, { props: given });

    expect(screen.getByTestId("wait-unavailable").textContent).toMatch(/not available/i);
    expect(screen.queryByTestId("wait-toggle")).toBeNull();
    expect(screen.queryByTestId("wait-panel")).toBeNull();
    expect(screen.queryByTestId("listen-panel")).toBeNull();

    await fireEvent.click(screen.getByTestId("player-sheet-tab-audio"));
    expect(screen.getByTestId("player-upload")).toBeTruthy();
    expect(screen.getByTestId("player-download-audio").getAttribute("href")).toBe(
      "/api/songs/song-1/audio",
    );

    await fireEvent.click(screen.getByTestId("player-sheet-tab-sync"));
    expect(screen.getByTestId("player-tap")).toBeTruthy();
    expect(screen.getByTestId("player-autosync")).toBeTruthy();
    expect(screen.getByTestId("player-transcribe")).toBeTruthy();
    await fireEvent.click(screen.getByTestId("player-autosync"));
    expect(given.onautosync).toHaveBeenCalledOnce();
  });

  it("restores the last tab and closes from Escape or the close button", async () => {
    localStorage.clear();
    saveSheetTab("audio", "ada");
    const given = props({ userId: "ada" });
    render(PlayerSheet, { props: given });
    expect(screen.getByTestId("metronome-toggle")).toBeTruthy();

    await fireEvent.keyDown(screen.getByTestId("player-sheet"), { key: "Escape" });
    expect(given.onclose).toHaveBeenCalledOnce();
    await fireEvent.click(screen.getByTestId("player-sheet-close"));
    expect(given.onclose).toHaveBeenCalledTimes(2);

    await fireEvent.keyDown(screen.getByTestId("player-sheet-tab-audio"), { key: "ArrowLeft" });
    expect(screen.getByTestId("player-sheet-tab-practice").getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("hides editing tools while the song is read-only", async () => {
    localStorage.clear();
    render(PlayerSheet, { props: props({ readOnly: true, hasAudio: true, demo: true }) });
    expect(screen.queryByTestId("player-upload")).toBeNull();
    await fireEvent.click(screen.getByTestId("player-sheet-tab-sync"));
    expect(screen.queryByTestId("player-tap")).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    await fireEvent.click(screen.getByTestId("player-sheet-tab-audio"));
    expect(screen.queryByTestId("player-upload")).toBeNull();
  });
});
