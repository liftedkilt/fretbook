import { fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SongSummary } from "../lib/types";
import { ui } from "../lib/ui.svelte";
import LibraryView from "./LibraryView.svelte";

const mockDeleteSong = vi.fn();
const mockListSongs = vi.fn();

vi.mock("../lib/api", () => ({
  deleteSong: (...args: unknown[]) => mockDeleteSong(...args),
  listSongs: (...args: unknown[]) => mockListSongs(...args),
  apiUrl: (p: string) => p,
}));

function makeSong(overrides: Partial<SongSummary>): SongSummary {
  return {
    id: "song-1",
    slug: "song-1",
    title: "Test Song",
    artist: "Test Artist",
    content_kind: "tab",
    source_kind: "user",
    revision: 1,
    bpm: 120,
    measure_count: 10,
    track_count: 1,
    string_count: 4,
    preferred_instrument: "bass-4",
    has_sync: false,
    has_audio: false,
    duration: 180,
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("LibraryView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ui.songs = [];
    ui.loaded = true;
    ui.filter = "all";
    ui.search = "";
    ui.sheet = "";
    ui.error = "";
  });

  it("renders empty state when library has no songs", async () => {
    ui.loaded = true;
    ui.songs = [];

    render(LibraryView);

    expect(screen.getByTestId("library-empty")).toBeInTheDocument();

    const addButtons = screen.getAllByRole("button", { name: /new/i });
    expect(addButtons.length).toBeGreaterThan(0);
    await fireEvent.click(addButtons[0]);
    expect(ui.sheet).toBe("add");
  });

  it("filters songs by instrument family and chords", async () => {
    const bassSong = makeSong({
      id: "1",
      title: "Hysteria",
      artist: "Muse",
      preferred_instrument: "bass-4",
      content_kind: "tab",
    });
    const electricSong = makeSong({
      id: "2",
      title: "Plug In Baby",
      artist: "Muse",
      preferred_instrument: "guitar-electric",
      content_kind: "tab",
    });
    const acousticSong = makeSong({
      id: "3",
      title: "Wonderwall",
      artist: "Oasis",
      preferred_instrument: "guitar-acoustic",
      content_kind: "tab",
    });
    const chordSong = makeSong({
      id: "4",
      title: "Let It Be",
      artist: "The Beatles",
      content_kind: "chords",
    });

    ui.songs = [bassSong, electricSong, acousticSong, chordSong];

    render(LibraryView);

    expect(screen.getAllByTestId("song-card")).toHaveLength(4);

    // Filter by bass
    await fireEvent.click(screen.getByTestId("library-filter-bass"));
    expect(screen.getAllByTestId("song-card")).toHaveLength(1);
    expect(screen.getByText("Hysteria")).toBeInTheDocument();

    // Filter by chords
    await fireEvent.click(screen.getByTestId("library-filter-chords"));
    expect(screen.getAllByTestId("song-card")).toHaveLength(1);
    expect(screen.getByText("Let It Be")).toBeInTheDocument();

    // Filter by electric
    await fireEvent.click(screen.getByTestId("library-filter-electric"));
    expect(screen.getAllByTestId("song-card")).toHaveLength(1);
    expect(screen.getByText("Plug In Baby")).toBeInTheDocument();

    // Back to all
    await fireEvent.click(screen.getByTestId("library-filter-all"));
    expect(screen.getAllByTestId("song-card")).toHaveLength(4);
  });

  it("filters songs by search query and shows empty search message", async () => {
    const song1 = makeSong({ id: "1", title: "Hysteria", artist: "Muse" });
    const song2 = makeSong({ id: "2", title: "Yellow", artist: "Coldplay" });

    ui.songs = [song1, song2];

    render(LibraryView);

    const searchInput = screen.getByTestId("library-search");
    await fireEvent.input(searchInput, { target: { value: "Muse" } });

    expect(screen.getAllByTestId("song-card")).toHaveLength(1);
    expect(screen.getByText("Hysteria")).toBeInTheDocument();

    // Search matching nothing
    await fireEvent.input(searchInput, { target: { value: "Nonexistent" } });
    expect(screen.queryByTestId("song-card")).toBeNull();
    expect(screen.getByTestId("library-filter-empty")).toBeInTheDocument();
  });

  it("handles song deletion with confirmation", async () => {
    const song = makeSong({ id: "song-to-delete", title: "Delete Me", artist: "Artist" });
    ui.songs = [song];
    mockDeleteSong.mockResolvedValueOnce(undefined);
    mockListSongs.mockResolvedValueOnce([]);

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(LibraryView);

    const deleteBtn = screen.getByTestId("song-delete");
    await fireEvent.click(deleteBtn);

    expect(confirmSpy).toHaveBeenCalled();
    expect(mockDeleteSong).toHaveBeenCalledWith("song-to-delete");
    expect(mockListSongs).toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it("does not delete song if confirmation is cancelled", async () => {
    const song = makeSong({ id: "keep-me", title: "Keep Me", artist: "Artist" });
    ui.songs = [song];

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(LibraryView);

    const deleteBtn = screen.getByTestId("song-delete");
    await fireEvent.click(deleteBtn);

    expect(confirmSpy).toHaveBeenCalled();
    expect(mockDeleteSong).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it("displays error alert if deletion fails", async () => {
    const song = makeSong({ id: "fail-song", title: "Fail", artist: "Artist" });
    ui.songs = [song];
    mockDeleteSong.mockRejectedValueOnce(new Error("Failed to delete"));

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(LibraryView);

    const deleteBtn = screen.getByTestId("song-delete");
    await fireEvent.click(deleteBtn);

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to delete");
    confirmSpy.mockRestore();
  });
});
