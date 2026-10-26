import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import type { Settings } from "@coderline/alphatab";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { TabSong } from "../lib/types";
import TabPlayer from "./TabPlayer.svelte";

const lifecycle = vi.hoisted(() => ({ created: vi.fn(), destroyed: vi.fn() }));

vi.mock("@coderline/alphatab", async (importOriginal) => {
  const original = await importOriginal<typeof import("@coderline/alphatab")>();
  const event = () => ({ on: vi.fn() });
  return {
    ...original,
    AlphaTabApi: class {
      settings: Settings;
      score = { tracks: [] };
      tracks = [];
      player = { output: { updatePosition: vi.fn() } };
      scoreLoaded = event();
      playerReady = { on: (handler: () => void) => handler() };
      playedBeatChanged = event();
      beatMouseDown = event();
      beatMouseMove = event();
      beatMouseUp = event();
      playerFinished = event();
      playerPositionChanged = event();
      playerStateChanged = event();
      tex = vi.fn();
      destroy = lifecycle.destroyed;

      constructor(_element: HTMLElement, settings: Settings) {
        this.settings = settings;
        lifecycle.created();
      }
    },
  };
});

const song = {
  id: "mute-regression",
  title: "Riff",
  artist: "",
  tags: [],
  source_ref: {},
  has_audio: true,
  audio_url: "/recording.mp3",
  preferred_track_id: "guitar",
  document: {
    version: 1,
    bpm: 120,
    bars: [{ signature: [4, 4], repeat_start: false, repeat_end: 0, alternate_endings: [] }],
    tracks: [
      {
        id: "guitar",
        name: "Guitar",
        instrument: "guitar",
        capo: 0,
        tuning_midi: [64, 59, 55, 50, 45, 40],
        preferred: true,
        bars: [{ voices: [{ beats: [] }] }],
      },
    ],
    sync: { video_id: null, points: [], anchors: {} },
  },
} as unknown as TabSong;

beforeEach(() => {
  vi.clearAllMocks();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => vi.unstubAllGlobals());

it("keeps the loaded player when muting after a synchronous ready callback", async () => {
  render(TabPlayer, { song, readOnly: true });
  await waitFor(() => expect(lifecycle.created).toHaveBeenCalledTimes(1));
  const audio = screen.getByTestId("player-audio") as HTMLAudioElement;
  audio.currentTime = 0.75;
  const mute = screen.getByTestId("player-mute");

  await fireEvent.click(mute);
  expect(audio.muted).toBe(true);
  expect(audio.currentTime).toBe(0.75);
  expect(mute).toHaveAttribute("aria-pressed", "true");
  expect(lifecycle.created).toHaveBeenCalledTimes(1);
  expect(lifecycle.destroyed).not.toHaveBeenCalled();

  await fireEvent.click(mute);
  expect(audio.muted).toBe(false);
  expect(audio.currentTime).toBe(0.75);
  expect(mute).toHaveAttribute("aria-pressed", "false");
  expect(lifecycle.created).toHaveBeenCalledTimes(1);
  expect(lifecycle.destroyed).not.toHaveBeenCalled();
});
