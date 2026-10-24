// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { songsPath } from "./songQuery";
import type { SongPage, SongQuery } from "./types";
import * as api from "./api";
import {
  countFor,
  loadLibrary,
  loadMore,
  refreshSongs,
  setSort,
  toggleTagFilter,
  ui,
} from "./ui.svelte";

const mockListSongs = vi.fn<(query?: SongQuery) => Promise<SongPage>>();

vi.mock("./api", () => ({
  listSongs: (query?: SongQuery) => mockListSongs(query),
  getMe: vi.fn(),
  getMeta: vi.fn(),
  saveSettings: vi.fn(),
  listTags: vi.fn().mockResolvedValue([]),
  getFacets: vi.fn().mockResolvedValue({ keys: [], genres: [] }),
}));

function page(title: string): SongPage {
  return {
    items: [{ id: title, title } as SongPage["items"][number]],
    total: 1,
    next_cursor: null,
    counts: { all: 1, bass: 0, electric: 0, acoustic: 0, chords: 0, favourites: 0 },
  };
}

beforeEach(() => {
  mockListSongs.mockReset();
  ui.search = "";
  ui.filter = "all";
  ui.tags = [];
  ui.favouritesOnly = false;
  ui.level = "all";
});

afterEach(() => {
  localStorage.clear();
});

describe("songsPath", () => {
  it("sends only the parameters that are set", () => {
    const url = songsPath({
      q: "blue note",
      sort: "title",
      order: "asc",
      instrument: "all",
      cursor: "",
    });
    const params = new URL(url, "http://x").searchParams;
    expect(params.get("q")).toBe("blue note");
    expect(params.get("sort")).toBe("title");
    expect(params.has("cursor")).toBe(false);
    expect(songsPath()).toBe("/api/songs");
  });

  it("sends a key and genre filter, and leaves empty ones out", () => {
    const params = new URL(songsPath({ key: "F#m", genre: "Blues" }), "http://x").searchParams;
    expect(params.get("key")).toBe("F#m");
    expect(params.get("genre")).toBe("Blues");
    expect(songsPath({ key: "", genre: "" })).toBe("/api/songs");
  });

  it("sends each tag as its own parameter and drops a false favourite", () => {
    const params = new URL(songsPath({ tag: ["funk", "warm up"], favourite: true }), "http://x")
      .searchParams;
    expect(params.getAll("tag")).toEqual(["funk", "warm up"]);
    expect(params.get("favourite")).toBe("true");
    expect(songsPath({ tag: [], favourite: false })).toBe("/api/songs");
  });
});

describe("loadLibrary", () => {
  it("lets a newer search win over a slower, older response", async () => {
    let release: (value: SongPage) => void = () => {};
    mockListSongs
      .mockReturnValueOnce(new Promise<SongPage>((resolve) => (release = resolve)))
      .mockResolvedValueOnce(page("new"));

    ui.search = "old";
    const first = loadLibrary();
    ui.search = "new";
    await loadLibrary();
    release(page("old"));
    await first;

    expect(ui.songs.map((song) => song.title)).toEqual(["new"]);
  });
});

describe("tag and favourite filters", () => {
  it("sends the selected tags and the favourites switch with the query", async () => {
    mockListSongs.mockResolvedValue(page("x"));
    toggleTagFilter("Funk");
    toggleTagFilter("slap");
    ui.favouritesOnly = true;
    await loadLibrary();
    expect(mockListSongs.mock.calls[0][0]).toMatchObject({
      tag: ["Funk", "slap"],
      favourite: true,
    });
  });

  it("toggles a tag without caring about case", () => {
    toggleTagFilter("Funk");
    toggleTagFilter("funk");
    expect(ui.tags).toEqual([]);
  });

  it("drops a selected tag that no song has any more", async () => {
    mockListSongs.mockResolvedValue(page("x"));
    vi.mocked(api.listTags).mockResolvedValue([{ tag: "Funk", count: 2 }]);
    ui.tags = ["funk", "gone"];
    await refreshSongs();
    expect(ui.tags).toEqual(["funk"]);
    expect(ui.tagList).toEqual([{ tag: "Funk", count: 2 }]);
    vi.mocked(api.listTags).mockResolvedValue([]);
  });
});

describe("setSort", () => {
  it("stores the sort and uses the natural order when none is given", () => {
    setSort("title");
    expect([ui.sort, ui.order]).toEqual(["title", "asc"]);
    setSort("opened");
    expect([ui.sort, ui.order]).toEqual(["opened", "desc"]);
    setSort("difficulty");
    expect([ui.sort, ui.order]).toEqual(["difficulty", "asc"]);
    setSort("added", "asc");
    expect(JSON.parse(localStorage.getItem("fretbook.librarySort") ?? "{}")).toEqual({
      sort: "added",
      order: "asc",
    });
  });
});

describe("paging", () => {
  it("appends the next page without duplicating songs and keeps the counts", async () => {
    const first = { ...page("a"), total: 2, next_cursor: "c1" };
    const second = { ...page("b"), total: 2, next_cursor: null };
    second.items.push(first.items[0]);
    mockListSongs.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    await loadLibrary({ force: true });
    expect(ui.nextCursor).toBe("c1");
    expect(countFor("all")).toBe(1);
    await loadMore();

    expect(mockListSongs.mock.calls[1][0]).toMatchObject({ cursor: "c1" });
    expect(ui.songs.map((song) => song.title)).toEqual(["a", "b"]);
    expect(ui.nextCursor).toBeNull();
    expect(ui.loadingMore).toBe(false);
    // Nothing more to load: no request.
    await loadMore();
    expect(mockListSongs).toHaveBeenCalledTimes(2);
  });

  it("skips the request when nothing about the query changed", async () => {
    mockListSongs.mockResolvedValue(page("same"));
    await loadLibrary({ force: true });
    await loadLibrary();
    expect(mockListSongs).toHaveBeenCalledTimes(1);
  });
});

describe("refreshSongs", () => {
  it("reloads the library and the sidebar's recent songs", async () => {
    mockListSongs.mockImplementation(async (query) =>
      page(query?.limit === 5 ? "recent" : "listed"),
    );
    await refreshSongs();
    expect(ui.songs.map((song) => song.title)).toEqual(["listed"]);
    expect(ui.recent.map((song) => song.title)).toEqual(["recent"]);
    expect(mockListSongs).toHaveBeenCalledWith(expect.objectContaining({ favourite: true }));
  });
});

describe("the remembered sort", () => {
  async function importFresh() {
    vi.resetModules();
    return (await import("./ui.svelte")).ui;
  }

  it("is restored from storage", async () => {
    localStorage.setItem("fretbook.librarySort", JSON.stringify({ sort: "artist", order: "desc" }));
    const fresh = await importFresh();
    expect([fresh.sort, fresh.order]).toEqual(["artist", "desc"]);
  });

  it("falls back to the natural order, and ignores junk", async () => {
    localStorage.setItem(
      "fretbook.librarySort",
      JSON.stringify({ sort: "title", order: "sideways" }),
    );
    expect((await importFresh()).order).toBe("asc");
    localStorage.setItem("fretbook.librarySort", JSON.stringify({ sort: "nope" }));
    expect((await importFresh()).sort).toBe("updated");
    localStorage.setItem("fretbook.librarySort", "{not json");
    expect((await importFresh()).sort).toBe("updated");
  });
});
