import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import type { InstrumentPreset, TabSong } from "../lib/types";
import TabEditor from "./TabEditor.svelte";

vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {
    status = 500;
  },
  getSong: vi.fn(),
  updateSong: vi.fn(),
}));

const preset: InstrumentPreset = {
  id: "bass-4",
  label_key: "instruments.bass4",
  label: "4-string bass",
  instrument: "bass",
  name: "Bass",
  tuning_midi: [43, 38, 33, 28],
  string_count: 4,
  family: "bass",
};

function song(): TabSong {
  const beat = () => ({ position: 0, duration: 960, notes: [], extras: {} });
  return {
    id: "s1",
    title: "Walking Home",
    artist: "Ada",
    revision: 1,
    content_kind: "tab",
    preferred_track_id: "bass",
    document: {
      version: 1,
      bpm: 96,
      bars: [
        { signature: [4, 4], extras: {} },
        { signature: [4, 4], section: "Chorus", extras: {} },
      ],
      sync: { video_id: null, points: [], anchors: {} },
      tracks: [
        {
          id: "bass",
          name: "Bass",
          instrument: "bass-guitar",
          capo: 0,
          tuning_midi: [43, 38, 33, 28],
          preferred: true,
          bars: [
            { voices: [{ beats: [beat(), beat(), beat(), beat()] }], extras: {} },
            { voices: [{ beats: [] }], extras: {} },
          ],
        },
      ],
    },
  } as unknown as TabSong;
}

function renderEditor() {
  return render(TabEditor, { song: song(), presets: [preset], defaultPreset: "bass-4" });
}

describe("TabEditor layout", () => {
  it("uses one header: back to the song, a labelled Play button, and Save", () => {
    renderEditor();
    const back = screen.getByTestId("editor-back");
    const play = screen.getByTestId("editor-play");
    expect(back).toHaveTextContent("Back to song");
    expect(back).not.toHaveTextContent("Play");
    expect(play).toHaveTextContent("Play");
    expect(play.tagName).toBe("A");
    expect(back).not.toBe(play);
    expect(screen.getByTestId("editor-title")).toHaveTextContent("Walking Home");
    expect(screen.getByTestId("editor-save")).toHaveTextContent("Save");
    expect(screen.queryByTestId("editor-unsaved")).not.toBeInTheDocument();
  });

  it("shows unsaved changes when the title is edited", async () => {
    renderEditor();
    await fireEvent.input(screen.getByTestId("editor-song-title"), {
      target: { value: "Walking" },
    });
    expect(screen.getByTestId("editor-unsaved")).toHaveTextContent("Unsaved changes");
  });

  it("puts bar actions in a menu, with delete last", async () => {
    renderEditor();
    expect(screen.queryByTestId("editor-add-measure")).not.toBeInTheDocument();
    await fireEvent.click(screen.getByTestId("editor-bar-menu"));
    const items = screen.getAllByRole("menuitem").map((item) => item.textContent?.trim());
    expect(items).toEqual(["Insert bar before", "Insert bar after", "Duplicate bar", "Delete bar"]);
    expect(screen.getByTestId("editor-delete-measure")).toHaveClass("danger");
    await fireEvent.click(screen.getByTestId("editor-add-measure"));
    expect(screen.getByTestId("editor-measure")).toHaveAttribute("data-bar", "1");
    expect(screen.queryAllByTestId("beat-card")).toHaveLength(0);
  });

  it("duplicates the current bar, notes and all", async () => {
    renderEditor();
    await fireEvent.input(screen.getAllByTestId("fret-input-0")[0], { target: { value: "3" } });
    await fireEvent.click(screen.getByTestId("editor-bar-menu"));
    await fireEvent.click(screen.getByTestId("editor-duplicate-bar"));
    expect(screen.getByTestId("editor-measure")).toHaveAttribute("data-bar", "1");
    expect(screen.getAllByTestId("beat-card")).toHaveLength(4);
    expect(screen.getAllByTestId("fret-input-0")[0]).toHaveValue("3");
  });

  it("edits duration with icons and keeps delete and grace in the beat menu", async () => {
    renderEditor();
    const card = screen.getAllByTestId("beat-card")[0];
    expect(card.querySelector("select")).toBeNull();
    const quarter = screen.getAllByTestId("duration-quarter")[0];
    expect(quarter).toHaveAttribute("aria-checked", "true");
    expect(quarter).toHaveTextContent("Quarter");
    await fireEvent.click(screen.getAllByTestId("duration-eighth")[0]);
    expect(screen.getAllByTestId("duration-eighth")[0]).toHaveAttribute("aria-checked", "true");

    expect(screen.queryByRole("button", { name: "Delete beat" })).not.toBeInTheDocument();
    await fireEvent.click(screen.getAllByTestId("editor-beat-menu")[0]);
    const items = screen.getAllByRole("menuitem");
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      "No grace note",
      "On the beat",
      "Before the beat",
      "Delete beat",
    ]);
    expect(items[0]).toHaveAttribute("aria-current", "true");
    expect(items[3]).toHaveClass("danger");
    await fireEvent.click(items[1]);
    await fireEvent.click(screen.getAllByTestId("editor-beat-menu")[0]);
    expect(screen.getAllByRole("menuitem")[1]).toHaveAttribute("aria-current", "true");
  });

  it("uses a switch for repeat start, on the same line as its label", () => {
    renderEditor();
    const start = screen.getByTestId("repeat-start");
    const label = start.closest("label");
    expect(label).toHaveClass("switch");
    expect(label).toHaveTextContent("Repeat starts here");
  });
});

describe("TabEditor undo and redo", () => {
  const chips = () => screen.queryAllByTestId(/^bar-chip-/);

  it("undoes and redoes a deleted bar, and the state is clean again after undo", async () => {
    renderEditor();
    expect(screen.getByTestId("editor-undo")).toBeDisabled();
    expect(screen.getByTestId("editor-redo")).toBeDisabled();
    await fireEvent.click(screen.getByTestId("bar-chip-1"));
    await fireEvent.click(screen.getByTestId("editor-bar-menu"));
    await fireEvent.click(screen.getByTestId("editor-delete-measure"));
    expect(chips()).toHaveLength(1);
    expect(screen.getByTestId("editor-unsaved")).toBeInTheDocument();

    await fireEvent.click(screen.getByTestId("editor-undo"));
    expect(chips()).toHaveLength(2);
    expect(screen.queryByTestId("editor-unsaved")).not.toBeInTheDocument();
    expect(screen.getByTestId("editor-undo")).toBeDisabled();

    await fireEvent.click(screen.getByTestId("editor-redo"));
    expect(chips()).toHaveLength(1);
    expect(screen.getByTestId("editor-redo")).toBeDisabled();
  });

  it("undoes a note with Ctrl+Z, redoes it with Ctrl+Shift+Z and Ctrl+Y", async () => {
    renderEditor();
    const fret = () => screen.getAllByTestId("fret-input-1")[0];
    await fireEvent.input(fret(), { target: { value: "5" } });
    expect(fret()).toHaveValue("5");

    // In the cell itself the browser's own undo applies.
    const native = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    fret().dispatchEvent(native);
    expect(native.defaultPrevented).toBe(false);
    await fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(fret()).toHaveValue("");
    expect(screen.queryByTestId("editor-unsaved")).not.toBeInTheDocument();
    await fireEvent.keyDown(window, { key: "Z", metaKey: true, shiftKey: true });
    expect(fret()).toHaveValue("5");
    await fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(fret()).toHaveValue("5");
  });

  it("leaves Ctrl+Z to the browser in the title field", async () => {
    renderEditor();
    const title = screen.getByTestId("editor-song-title");
    await fireEvent.input(title, { target: { value: "Walking" } });
    const event = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    title.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(title).toHaveValue("Walking");
    // The button still undoes the title change.
    await fireEvent.click(screen.getByTestId("editor-undo"));
    expect(title).toHaveValue("Walking Home");
  });

  it("undoes a duration and an added track", async () => {
    renderEditor();
    await fireEvent.click(screen.getAllByTestId("duration-eighth")[0]);
    await fireEvent.click(screen.getByRole("button", { name: /Add track/ }));
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    await fireEvent.click(screen.getByTestId("editor-undo"));
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    await fireEvent.click(screen.getByTestId("editor-undo"));
    expect(screen.getAllByTestId("duration-quarter")[0]).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByTestId("editor-unsaved")).not.toBeInTheDocument();
  });

  it("undoes a repeat and a time signature change", async () => {
    renderEditor();
    const start = screen.getByTestId("repeat-start") as HTMLInputElement;
    const beats = screen.getByLabelText("Beats per bar") as HTMLInputElement;
    await fireEvent.click(start);
    expect(start.checked).toBe(true);
    await fireEvent.change(beats, { target: { value: "3" } });
    expect(beats).toHaveValue(3);

    await fireEvent.click(screen.getByTestId("editor-undo"));
    expect(beats).toHaveValue(4);
    expect(start.checked).toBe(true);
    await fireEvent.click(screen.getByTestId("editor-undo"));
    expect((screen.getByTestId("repeat-start") as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByTestId("editor-unsaved")).not.toBeInTheDocument();
  });

  it("keeps the history across a save", async () => {
    const api = await import("../lib/api");
    vi.mocked(api.updateSong).mockImplementation(
      async (_id, body) =>
        ({
          ...song(),
          title: body.title,
          artist: body.artist,
          revision: 2,
          document: body.document,
        }) as never,
    );
    renderEditor();
    await fireEvent.click(screen.getByTestId("editor-bar-menu"));
    await fireEvent.click(screen.getByTestId("editor-add-measure"));
    expect(chips()).toHaveLength(3);
    await fireEvent.click(screen.getByTestId("editor-save"));
    await vi.waitFor(() => expect(screen.getByTestId("editor-status")).toBeInTheDocument());
    expect(screen.getByTestId("editor-undo")).not.toBeDisabled();

    await fireEvent.click(screen.getByTestId("editor-undo"));
    expect(chips()).toHaveLength(2);
    expect(screen.getByTestId("editor-unsaved")).toBeInTheDocument();
    await fireEvent.click(screen.getByTestId("editor-redo"));
    expect(chips()).toHaveLength(3);
    expect(screen.queryByTestId("editor-unsaved")).not.toBeInTheDocument();
  });
});
