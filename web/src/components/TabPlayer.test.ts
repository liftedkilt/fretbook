import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import type { Settings, model } from "@coderline/alphatab";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { TabSong } from "../lib/types";
import TabPlayer from "./TabPlayer.svelte";

const lifecycle = vi.hoisted(() => ({
  created: vi.fn(),
  destroyed: vi.fn(),
  loaded: vi.fn(),
  rendered: vi.fn(),
}));

vi.mock("@coderline/alphatab", async (importOriginal) => {
  const original = await importOriginal<typeof import("@coderline/alphatab")>();
  const event = () => {
    const handlers: (() => void)[] = [];
    return {
      on: vi.fn((handler: () => void) => handlers.push(handler)),
      emit: () => handlers.forEach((handler) => handler()),
    };
  };
  return {
    ...original,
    AlphaTabApi: class {
      settings: Settings;
      score = new original.model.Score();
      tracks: model.Track[] = [];
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
      tex = vi.fn((source: string, indexes: number[]) => {
        const importer = new original.importer.AlphaTexImporter();
        importer.initFromString(source, this.settings);
        this.score = importer.readScore();
        this.tracks = indexes.map((index) => this.score.tracks[index]);
        lifecycle.loaded(this.score.tracks.length);
        this.scoreLoaded.emit();
      });
      renderTracks = vi.fn((tracks: model.Track[]) => {
        this.tracks = tracks;
        lifecycle.rendered(tracks.map((track) => track.index));
      });
      updateSyncPoints = vi.fn();
      changeTrackVolume = vi.fn();
      changeTrackMute = vi.fn();
      changeTrackSolo = vi.fn();
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
  expect(screen.queryByTestId("player-track")).toBeNull();

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

it("switches between imported instruments above the score without recreating the player", async () => {
  const guitar = song.document.tracks[0];
  const multiTrackSong: TabSong = {
    ...song,
    id: "multi-track",
    document: {
      ...song.document,
      tracks: [
        guitar,
        {
          ...guitar,
          id: "bass",
          name: "Bass",
          instrument: "bass-guitar",
          tuning_midi: [43, 38, 33, 28],
          preferred: false,
        },
      ],
    },
  };
  render(TabPlayer, { song: multiTrackSong, readOnly: true });
  await waitFor(() => expect(lifecycle.loaded).toHaveBeenCalledWith(2));
  const selector = screen.getByRole("combobox", { name: "Track" });
  expect(screen.getByTestId("player-view-row")).toContainElement(selector);
  expect(screen.queryByTestId("player-sheet")).toBeNull();
  expect(selector).toHaveValue("guitar");

  await fireEvent.change(selector, { target: { value: "bass" } });
  await waitFor(() => expect(lifecycle.rendered).toHaveBeenLastCalledWith([1]));
  expect(selector).toHaveValue("bass");

  await fireEvent.change(selector, { target: { value: "guitar" } });
  await waitFor(() => expect(lifecycle.rendered).toHaveBeenLastCalledWith([0]));
  expect(lifecycle.created).toHaveBeenCalledTimes(1);
  expect(lifecycle.destroyed).not.toHaveBeenCalled();
});
