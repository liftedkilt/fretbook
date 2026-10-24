import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConvertBody } from "../lib/api-types";
import type { InstrumentPreset, TabSong, Track } from "../lib/types";
import RetuneSheet from "./RetuneSheet.svelte";

const api = vi.hoisted(() => ({ convertTrack: vi.fn() }));
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  convertTrack: api.convertTrack,
}));
// The preview draws with alphaTab, which needs a real layout engine; a stand-in keeps the test about the dialog.
vi.mock("@coderline/alphatab", () => ({
  Settings: class {
    core = {};
    player = {};
    display = {};
  },
  LogLevel: { Warning: 0 },
  PlayerMode: { Disabled: 0 },
  StaveProfile: { Tab: 0 },
  AlphaTabApi: class {
    tex() {}
    destroy() {}
  },
}));

const track: Track = {
  id: "t1",
  name: "Guitar",
  instrument: "guitar",
  capo: 0,
  tuning_midi: [64, 59, 55, 50, 45, 40],
  preferred: true,
  bars: [],
};

const presets: InstrumentPreset[] = [
  {
    id: "bass-4",
    label_key: "instrument.bass4",
    label: "4-string bass",
    instrument: "bass-guitar",
    name: "Bass",
    tuning_midi: [43, 38, 33, 28],
    string_count: 4,
    family: "bass",
  },
];

const song = {
  id: "s1",
  title: "Riff",
  revision: 3,
  document: { tracks: [track], bars: [], bpm: 120 },
} as unknown as TabSong;

function outcome(extra: Partial<{ song: TabSong | null }> = {}) {
  return {
    track,
    report: {
      notes: 4,
      refretted: 3,
      reduced: 0,
      shifted_bars: [],
      dropped_bars: [],
      dropped: 0,
      techniques_dropped: 0,
    },
    song: null,
    ...extra,
  };
}

function mount(onsaved = vi.fn()) {
  render(RetuneSheet, { props: { open: true, song, track, presets, onclose: vi.fn(), onsaved } });
  return onsaved;
}

const lastBody = (): ConvertBody => api.convertTrack.mock.calls.at(-1)![1];

describe("RetuneSheet", () => {
  beforeEach(() => {
    api.convertTrack.mockReset();
    api.convertTrack.mockResolvedValue(outcome());
  });

  it("previews a transposition without saving", async () => {
    mount();
    expect(screen.getByTestId("retune-nothing")).toBeInTheDocument();
    expect(api.convertTrack).not.toHaveBeenCalled();
    await fireEvent.change(screen.getByTestId("retune-semitones"), { target: { value: "2" } });
    await waitFor(() => expect(screen.getByTestId("retune-report")).toBeInTheDocument());
    expect(lastBody()).toMatchObject({ track_id: "t1", mode: "preview", semitones: 2 });
    expect(screen.getByTestId("retune-report")).toHaveTextContent("3 of 4 notes moved");
  });

  it("fills in the tuning from an instrument and asks for a bass line", async () => {
    mount();
    await fireEvent.change(screen.getByTestId("retune-goal"), { target: { value: "bassLine" } });
    expect(screen.getByTestId("retune-tuning")).toHaveValue("G2 D2 A1 E1");
    expect(screen.getByTestId("retune-semitones")).toHaveValue(-12);
    await waitFor(() => expect(api.convertTrack).toHaveBeenCalled());
    expect(lastBody()).toMatchObject({ reduce: "lowest", preset: "bass-4", semitones: -12 });
  });

  it("refuses a tuning it cannot read and does not call the server", async () => {
    mount();
    await fireEvent.change(screen.getByTestId("retune-goal"), { target: { value: "retune" } });
    await fireEvent.input(screen.getByTestId("retune-tuning"), { target: { value: "nope" } });
    expect(screen.getByRole("alert")).toHaveTextContent("cannot be read");
    expect(api.convertTrack).not.toHaveBeenCalled();
    expect(screen.getByTestId("retune-add")).toBeDisabled();
  });

  it("saves as a new track with the loaded revision and shows the new track", async () => {
    const saved = {
      ...song,
      revision: 4,
      document: { ...song.document, tracks: [track, { ...track, id: "t1-2" }] },
    } as unknown as TabSong;
    const onsaved = mount();
    await fireEvent.change(screen.getByTestId("retune-semitones"), { target: { value: "2" } });
    await waitFor(() => expect(screen.getByTestId("retune-add")).toBeEnabled());
    api.convertTrack.mockResolvedValue(outcome({ song: saved }));
    await fireEvent.click(screen.getByTestId("retune-add"));
    await waitFor(() => expect(onsaved).toHaveBeenCalled());
    expect(lastBody()).toMatchObject({ mode: "add", revision: 3, name: "Guitar (converted)" });
    expect(onsaved).toHaveBeenCalledWith(saved, "t1-2");
  });

  it("replaces the track and keeps showing it", async () => {
    const saved = { ...song, revision: 4 } as unknown as TabSong;
    const onsaved = mount();
    await fireEvent.change(screen.getByTestId("retune-semitones"), { target: { value: "-1" } });
    await waitFor(() => expect(screen.getByTestId("retune-replace")).toBeEnabled());
    api.convertTrack.mockResolvedValue(outcome({ song: saved }));
    await fireEvent.click(screen.getByTestId("retune-replace"));
    await waitFor(() => expect(onsaved).toHaveBeenCalledWith(saved, "t1"));
    expect(lastBody()).toMatchObject({ mode: "replace", revision: 3, name: "Guitar" });
  });

  it("shows a server error and stays open", async () => {
    const { ApiError } = await import("../lib/api");
    const onsaved = mount();
    await fireEvent.change(screen.getByTestId("retune-semitones"), { target: { value: "2" } });
    await waitFor(() => expect(screen.getByTestId("retune-add")).toBeEnabled());
    api.convertTrack.mockRejectedValue(new ApiError(409, "changed", "song.conflict"));
    await fireEvent.click(screen.getByTestId("retune-add"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(onsaved).not.toHaveBeenCalled();
  });
});
