import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SongPage, SongQuery, SongSummary } from "../lib/types";
import { ui } from "../lib/ui.svelte";
import LibraryView from "./LibraryView.svelte";

const mockDeleteSong = vi.fn();
const mockListSongs = vi.fn();
const mockListJobs = vi.fn().mockResolvedValue([]);

vi.mock("../lib/api", () => ({
  deleteSong: (...args: unknown[]) => mockDeleteSong(...args),
  listSongs: (...args: unknown[]) => mockListSongs(...args),
  markSongOpened: vi.fn(),
  listJobs: (...args: unknown[]) => mockListJobs(...args),
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

/** A tiny stand-in for the server: filters, searches, and pages `songs` the way `GET /api/songs` does. */
let songs: SongSummary[] = [];

function family(song: SongSummary): string {
  if (song.content_kind === "chords") return "chords";
  if (song.preferred_instrument.includes("bass")) return "bass";
  if (song.preferred_instrument.includes("acoustic")) return "acoustic";
  return "electric";
}

function fakeServer(query: SongQuery = {}): SongPage {
  const words = (query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const matching = songs
    .filter(
      (song) =>
        !query.instrument || query.instrument === "all" || family(song) === query.instrument,
    )
    .filter((song) =>
      words.every((word) => `${song.title} ${song.artist}`.toLowerCase().includes(word)),
    );
  const start = Number(query.cursor ?? 0);
  const limit = query.limit ?? 50;
  const items = matching.slice(start, start + limit);
  const counts = { all: songs.length, bass: 0, electric: 0, acoustic: 0, chords: 0 };
  for (const song of songs) counts[family(song) as "bass"] += 1;
  return {
    items,
    total: matching.length,
    next_cursor: start + items.length < matching.length ? String(start + items.length) : null,
    counts,
  };
}

async function load(list: SongSummary[]) {
  songs = list;
  const page = fakeServer({ limit: 48 });
  ui.songs = page.items;
  ui.total = page.total;
  ui.nextCursor = page.next_cursor;
  ui.counts = page.counts;
  ui.loaded = true;
}

describe("LibraryView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    songs = [];
    mockListSongs.mockImplementation(async (query?: SongQuery) => fakeServer(query));
    ui.songs = [];
    ui.total = 0;
    ui.nextCursor = null;
    ui.counts = { all: 0, bass: 0, electric: 0, acoustic: 0, chords: 0 };
    ui.loaded = true;
    ui.filter = "all";
    ui.search = "";
    ui.sheet = "";
    ui.error = "";
  });

  it("renders empty state when library has no songs", async () => {
    render(LibraryView);

    expect(screen.getByTestId("library-empty")).toBeInTheDocument();

    const addButtons = screen.getAllByRole("button", { name: /new/i });
    expect(addButtons.length).toBeGreaterThan(0);
    await fireEvent.click(addButtons[0]);
    expect(ui.sheet).toBe("add");
  });

  it("asks the server to filter by instrument family and chords", async () => {
    await load([
      makeSong({ id: "1", title: "Hysteria", artist: "Muse", preferred_instrument: "bass-4" }),
      makeSong({
        id: "2",
        title: "Plug In Baby",
        artist: "Muse",
        preferred_instrument: "guitar-electric",
      }),
      makeSong({
        id: "3",
        title: "Wonderwall",
        artist: "Oasis",
        preferred_instrument: "guitar-acoustic",
      }),
      makeSong({ id: "4", title: "Let It Be", artist: "The Beatles", content_kind: "chords" }),
    ]);
    render(LibraryView);
    expect(screen.getAllByTestId("song-card")).toHaveLength(4);
    expect(screen.getByTestId("library-filter-bass")).toHaveTextContent("1");

    await fireEvent.click(screen.getByTestId("library-filter-bass"));
    await waitFor(() => expect(screen.getAllByTestId("song-card")).toHaveLength(1));
    expect(screen.getByText("Hysteria")).toBeInTheDocument();
    expect(mockListSongs).toHaveBeenLastCalledWith(expect.objectContaining({ instrument: "bass" }));

    await fireEvent.click(screen.getByTestId("library-filter-chords"));
    await waitFor(() => expect(screen.getByText("Let It Be")).toBeInTheDocument());

    await fireEvent.click(screen.getByTestId("library-filter-all"));
    await waitFor(() => expect(screen.getAllByTestId("song-card")).toHaveLength(4));
  });

  it("searches on the server and explains an empty result", async () => {
    await load([
      makeSong({ id: "1", title: "Hysteria", artist: "Muse" }),
      makeSong({ id: "2", title: "Yellow", artist: "Coldplay" }),
    ]);
    render(LibraryView);

    const searchInput = screen.getByTestId("library-search");
    await fireEvent.input(searchInput, { target: { value: "Muse" } });
    await waitFor(() => expect(screen.getAllByTestId("song-card")).toHaveLength(1));
    expect(mockListSongs).toHaveBeenLastCalledWith(expect.objectContaining({ q: "Muse" }));

    await fireEvent.input(searchInput, { target: { value: "Nonexistent" } });
    await waitFor(() => expect(screen.getByTestId("library-filter-empty")).toBeInTheDocument());
    expect(screen.getByTestId("library-filter-empty")).toHaveTextContent("Nonexistent");
    // The toolbar stays so the search can be corrected.
    expect(screen.getByTestId("library-search")).toBeInTheDocument();

    await fireEvent.click(screen.getByTestId("library-clear-search"));
    await waitFor(() => expect(screen.getAllByTestId("song-card")).toHaveLength(2));
  });

  it("sorts through the server and remembers the choice", async () => {
    await load([makeSong({ id: "1", title: "B" }), makeSong({ id: "2", title: "A" })]);
    render(LibraryView);

    await fireEvent.change(screen.getByTestId("library-sort"), { target: { value: "title" } });
    await waitFor(() =>
      expect(mockListSongs).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: "title", order: "asc" }),
      ),
    );
    await fireEvent.click(screen.getByTestId("library-order"));
    await waitFor(() =>
      expect(mockListSongs).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: "title", order: "desc" }),
      ),
    );
    expect(JSON.parse(localStorage.getItem("fretbook.librarySort") ?? "{}")).toEqual({
      sort: "title",
      order: "desc",
    });
  });

  it("loads further pages on request", async () => {
    await load(
      Array.from({ length: 60 }, (_, index) =>
        makeSong({ id: `s${index}`, title: `Song ${String(index).padStart(2, "0")}` }),
      ),
    );
    render(LibraryView);
    expect(screen.getAllByTestId("song-card")).toHaveLength(48);
    expect(screen.getByTestId("library-showing")).toHaveTextContent("48");

    await fireEvent.click(screen.getByTestId("library-load-more"));
    await waitFor(() => expect(screen.getAllByTestId("song-card")).toHaveLength(60));
    expect(screen.queryByTestId("library-load-more")).toBeNull();
  });

  it("focuses the search box on / but not while typing elsewhere", async () => {
    await load([makeSong({ id: "1" })]);
    render(LibraryView);
    const search = screen.getByTestId("library-search");

    await fireEvent.keyDown(document.body, { key: "/" });
    expect(search).toHaveFocus();

    // A slash typed into a form control is text, not a shortcut.
    const sort = screen.getByTestId("library-sort");
    sort.focus();
    await fireEvent.keyDown(sort, { key: "/" });
    expect(sort).toHaveFocus();
  });

  it("handles song deletion with confirmation", async () => {
    const song = makeSong({ id: "song-to-delete", title: "Delete Me", artist: "Artist" });
    await load([song]);
    mockDeleteSong.mockResolvedValueOnce(undefined);

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(LibraryView);

    const deleteBtn = screen.getByTestId("song-delete");
    await fireEvent.click(deleteBtn);

    expect(confirmSpy).toHaveBeenCalled();
    expect(mockDeleteSong).toHaveBeenCalledWith("song-to-delete");
    await waitFor(() => expect(mockListSongs).toHaveBeenCalled());

    confirmSpy.mockRestore();
  });

  it("does not delete song if confirmation is cancelled", async () => {
    const song = makeSong({ id: "keep-me", title: "Keep Me", artist: "Artist" });
    await load([song]);

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
    await load([song]);
    mockDeleteSong.mockRejectedValueOnce(new Error("Failed to delete"));

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(LibraryView);

    const deleteBtn = screen.getByTestId("song-delete");
    await fireEvent.click(deleteBtn);

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to delete");
    confirmSpy.mockRestore();
  });
});
