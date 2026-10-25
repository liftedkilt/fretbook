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
