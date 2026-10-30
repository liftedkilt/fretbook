import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import type { Settings, model } from "@coderline/alphatab";
import { flushSync } from "svelte";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { TabSong } from "../lib/types";
import TabPlayer from "./TabPlayer.svelte";

const lifecycle = vi.hoisted(() => ({
  created: vi.fn(),
  destroyed: vi.fn(),
  loaded: vi.fn(),
  rendered: vi.fn(),
  instances: [] as {
    playbackSpeed: number;
    tickPosition: number;
    settings: Settings;
    updateSettings: ReturnType<typeof vi.fn>;
    playedBeatChanged: { emit: (beat: unknown) => void };
    uiFacade: { _scrollContainer?: unknown };
  }[],
}));

vi.mock("@coderline/alphatab", async (importOriginal) => {
  const original = await importOriginal<typeof import("@coderline/alphatab")>();
  const event = () => {
    const handlers: ((...args: unknown[]) => void)[] = [];
    return {
      on: vi.fn((handler: (...args: unknown[]) => void) => handlers.push(handler)),
      emit: (...args: unknown[]) => handlers.forEach((handler) => handler(...args)),
    };
  };
  return {
    ...original,
    AlphaTabApi: class {
      settings: Settings;
      score = new original.model.Score();
      tracks: model.Track[] = [];
      player = { output: { updatePosition: vi.fn() } };
      uiFacade: { _scrollContainer?: unknown } = { _scrollContainer: {} };
      playbackSpeed = 1;
      tickPosition = 0;
      playerState = original.synth.PlayerState.Paused;
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
      updateSettings = vi.fn();
      changeTrackVolume = vi.fn();
      changeTrackMute = vi.fn();
      changeTrackSolo = vi.fn();
      play = vi.fn(() => {
        this.playerState = original.synth.PlayerState.Playing;
        this.playerStateChanged.emit({ state: this.playerState });
      });
      pause = vi.fn(() => {
        this.playerState = original.synth.PlayerState.Paused;
        this.playerStateChanged.emit({ state: this.playerState });
      });
      destroy = lifecycle.destroyed;

      constructor(_element: HTMLElement, settings: Settings) {
        this.settings = settings;
        lifecycle.instances.push(this);
        lifecycle.created();
      }
    },
  };
});

const PHONE = "(max-width: 767px)";
const mediaQueries = new Map<string, { matches: boolean; listeners: Set<() => void> }>();

function matchMediaMock(query: string) {
  let entry = mediaQueries.get(query);
  if (!entry) {
    entry = { matches: false, listeners: new Set() };
    mediaQueries.set(query, entry);
  }
  return {
    get matches() {
      return entry.matches;
    },
    addEventListener: (_type: string, listener: () => void) => {
      entry.listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => {
      entry.listeners.delete(listener);
    },
  };
}

function setPhone(matches: boolean) {
  for (const [query, entry] of mediaQueries) {
    if (!query.includes(PHONE)) continue;
    entry.matches = matches;
    for (const listener of entry.listeners) listener();
  }
}

const bar = {
  signature: [4, 4] as [number, number],
  repeat_start: false,
  repeat_end: 0,
  alternate_endings: [] as number[],
};
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
  lifecycle.instances.length = 0;
  mediaQueries.clear();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("matchMedia", vi.fn(matchMediaMock));
  Object.defineProperty(document, "scrollingElement", {
    configurable: true,
    get: () => document.documentElement,
  });
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

it("keeps speed, loop, and playback when the layout crosses the phone breakpoint", async () => {
  const looped: TabSong = {
    ...song,
    id: "breakpoint-loop",
    has_audio: false,
    audio_url: null,
    document: {
      ...song.document,
      bars: Array.from({ length: 8 }, () => ({ ...bar })),
      tracks: [
        {
          ...song.document.tracks[0],
          bars: Array.from({ length: 8 }, () => ({ voices: [{ beats: [] }] })),
        },
      ],
    },
  };
  render(TabPlayer, { song: looped, readOnly: true });
  await waitFor(() => expect(lifecycle.created).toHaveBeenCalledTimes(1));
  const api = lifecycle.instances[0];

  await fireEvent.click(screen.getByTestId("player-speed"));
  await fireEvent.click(screen.getByTestId("player-speed-0.75"));
  await fireEvent.input(screen.getByRole("slider", { name: "Position" }), {
    target: { value: "5" },
  });
  await fireEvent.click(screen.getByTestId("player-loop-toggle"));
  await fireEvent.click(screen.getByTestId("player-play"));

  expect(api.playbackSpeed).toBe(0.75);
  expect(screen.getByTestId("player-loop-chip")).toHaveTextContent("A6–B6");
  expect(screen.getByTestId("player-status")).toHaveAttribute("data-measure", "5");
  expect(screen.getByTestId("player-play")).toHaveAttribute("data-playing", "true");
  const position = api.tickPosition;
  expect(position).toBeGreaterThan(0);
  api.updateSettings.mockClear();

  flushSync(() => setPhone(true));

  expect(lifecycle.created).toHaveBeenCalledTimes(1);
  expect(lifecycle.destroyed).not.toHaveBeenCalled();
  expect(api.playbackSpeed).toBe(0.75);
  expect(api.tickPosition).toBe(position);
  expect(screen.getByTestId("player-loop-chip")).toHaveTextContent("A6–B6");
  expect(screen.getByTestId("player-status")).toHaveAttribute("data-measure", "5");
  expect(screen.getByTestId("player-play")).toHaveAttribute("data-playing", "true");
  expect(api.settings.player.scrollElement).toBe(document.scrollingElement);
  expect(api.uiFacade._scrollContainer).toBeNull();
  expect(api.updateSettings).toHaveBeenCalled();

  // The loop is enforced by the live player, not only the chip: a beat past the range wraps back.
  flushSync(() => {
    api.playedBeatChanged.emit({
      notes: [],
      displayStart: 0,
      voice: { bar: { index: 6, staff: { track: { index: 0 } } } },
    });
  });
  expect(screen.getByTestId("player-status")).toHaveAttribute("data-measure", "5");
  expect(api.tickPosition).toBe(position);
  expect(api.playbackSpeed).toBe(0.75);

  api.updateSettings.mockClear();
  flushSync(() => setPhone(false));

  expect(lifecycle.created).toHaveBeenCalledTimes(1);
  expect(lifecycle.destroyed).not.toHaveBeenCalled();
  expect(api.playbackSpeed).toBe(0.75);
  expect(api.tickPosition).toBe(position);
  expect(screen.getByTestId("player-play")).toHaveAttribute("data-playing", "true");
  expect(screen.getByTestId("player-loop-chip")).toHaveTextContent("A6–B6");
  expect(api.settings.player.scrollElement).toBe(screen.getByTestId("player-score"));
  expect(api.updateSettings).toHaveBeenCalled();
});
