import { render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type { SongDetail } from "../lib/types";
import SongDetails from "./SongDetails.svelte";

vi.mock("../lib/api", () => ({
  getSongPractice: vi.fn().mockResolvedValue({ session_count: 0, sessions: [] }),
}));

function makeSong(overrides: Partial<SongDetail> = {}): SongDetail {
  return {
    id: "s1",
    title: "Riff",
    content_kind: "tab",
    genre: "",
    album: "",
    year: null,
    notes: "",
    preferred_track_id: "t1",
    difficulty_tracks: [],
    ...overrides,
  } as unknown as SongDetail;
}

describe("SongDetails", () => {
  it("shows genre, year and album as facts", () => {
    render(SongDetails, { song: makeSong({ genre: "Blues", album: "Live", year: 1999 }) });
    expect(screen.getByRole("heading", { level: 2, name: "Details" })).toBeInTheDocument();
    expect(screen.getByTestId("song-genre")).toHaveTextContent("Blues");
    expect(screen.getByTestId("song-year")).toHaveTextContent("1999");
    expect(screen.getByTestId("song-album")).toHaveTextContent("Live");
  });

  it("renders the notes as safe Markdown", () => {
    render(SongDetails, {
      song: makeSong({ notes: "play **slow**\n\n<img src=x onerror=alert(1)>" }),
    });
    const notes = screen.getByTestId("song-notes");
    expect(notes.querySelector("strong")).toHaveTextContent("slow");
    expect(notes.querySelector("img")).toBeNull();
  });

  it("leaves out facts and notes a song does not have", () => {
    render(SongDetails, { song: makeSong() });
    expect(screen.queryByTestId("song-genre")).toBeNull();
    expect(screen.queryByTestId("song-notes")).toBeNull();
  });
});
