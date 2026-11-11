import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import type { SongDetail } from "../lib/types";
import ChordEditor from "./ChordEditor.svelte";

vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {
    status = 500;
  },
  getSong: vi.fn(),
  updateSong: vi.fn(),
}));

describe("ChordEditor header", () => {
  it("matches the tab editor: back to the song, the title, and a labelled Preview", async () => {
    const song = {
      id: "c1",
      title: "Sunny Day",
      artist: "Ada",
      revision: 1,
      content_kind: "chords",
      chordpro: "[C]Hello",
    } as SongDetail;
    render(ChordEditor, { song });

    expect(screen.getByTestId("editor-back")).toHaveTextContent("Back to song");
    expect(screen.getByTestId("editor-title")).toHaveTextContent("Sunny Day");
    expect(screen.getByTestId("editor-preview")).toHaveTextContent("Preview");
    expect(screen.queryByTestId("editor-play")).not.toBeInTheDocument();
    expect(screen.getByTestId("editor-save")).toHaveTextContent("Save");

    await fireEvent.input(screen.getByTestId("chord-text"), { target: { value: "[G]Hello" } });
    expect(screen.getByTestId("editor-unsaved")).toBeInTheDocument();
    await fireEvent.click(screen.getByTestId("editor-preview"));
    expect(screen.getByTestId("editor-preview")).toHaveAttribute("aria-pressed", "true");
  });
});

describe("ChordEditor undo and redo", () => {
  const sheet = () =>
    ({
      id: "c1",
      title: "Sunny Day",
      artist: "Ada",
      revision: 1,
      content_kind: "chords",
      chordpro: "[C]Hello",
    }) as SongDetail;

  it("undoes and redoes the text with the buttons, and the state is clean after undo", async () => {
    render(ChordEditor, { song: sheet() });
    const text = screen.getByTestId("chord-text") as HTMLTextAreaElement;
    expect(screen.getByTestId("editor-undo")).toBeDisabled();
    await fireEvent.input(text, { target: { value: "[C]Hello there" } });
    expect(screen.getByTestId("editor-unsaved")).toBeInTheDocument();

    await fireEvent.click(screen.getByTestId("editor-undo"));
    expect(text).toHaveValue("[C]Hello");
    expect(screen.queryByTestId("editor-unsaved")).not.toBeInTheDocument();
    await vi.waitFor(() => expect(text.selectionStart).toBe(8));

    await fireEvent.click(screen.getByTestId("editor-redo"));
    expect(text).toHaveValue("[C]Hello there");
    await vi.waitFor(() => expect(text.selectionStart).toBe(14));
  });

  it("drives the same history from Ctrl+Z in the text area and the Edit menu", async () => {
    render(ChordEditor, { song: sheet() });
    const text = screen.getByTestId("chord-text");
    await fireEvent.input(text, { target: { value: "[G]Hello" } });
    const undo = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    await fireEvent(text, undo);
    expect(undo.defaultPrevented).toBe(true);
    expect(text).toHaveValue("[C]Hello");

    const redo = new InputEvent("beforeinput", {
      inputType: "historyRedo",
      bubbles: true,
      cancelable: true,
    });
    await fireEvent(text, redo);
    expect(redo.defaultPrevented).toBe(true);
    expect(text).toHaveValue("[G]Hello");
    await fireEvent(
      text,
      new InputEvent("beforeinput", { inputType: "historyUndo", bubbles: true, cancelable: true }),
    );
    expect(text).toHaveValue("[C]Hello");
    // Other input is left alone.
    const typing = new InputEvent("beforeinput", {
      inputType: "insertText",
      bubbles: true,
      cancelable: true,
    });
    await fireEvent(text, typing);
    expect(typing.defaultPrevented).toBe(false);
  });

  it("leaves Ctrl+Z to the browser in the title field", async () => {
    render(ChordEditor, { song: sheet() });
    const title = screen.getAllByRole("textbox")[0];
    await fireEvent.input(title, { target: { value: "Rainy Day" } });
    const event = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    title.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    await fireEvent.keyDown(window, { key: "q", ctrlKey: true });
    await fireEvent.click(screen.getByTestId("editor-undo"));
    expect(title).toHaveValue("Sunny Day");
  });

  it("keeps the history across a save", async () => {
    const api = await import("../lib/api");
    vi.mocked(api.updateSong).mockImplementation(
      async (_id, body) => ({ ...sheet(), ...body, revision: 2 }) as never,
    );
    render(ChordEditor, { song: sheet() });
    const text = screen.getByTestId("chord-text");
    await fireEvent.input(text, { target: { value: "[Am]Hello" } });
    await fireEvent.click(screen.getByTestId("editor-save"));
    await vi.waitFor(() => expect(screen.getByTestId("editor-status")).toBeInTheDocument());
    await fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(text).toHaveValue("[C]Hello");
    expect(screen.getByTestId("editor-unsaved")).toBeInTheDocument();
    await fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(text).toHaveValue("[Am]Hello");
  });
});
