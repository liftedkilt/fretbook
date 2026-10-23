// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { listSongs } from "./api";
import { loadLibrary, setSort, ui } from "./ui.svelte";
import type { SongPage } from "./types";

function page(title: string): SongPage {
  return {
    items: [{ id: title, title } as SongPage["items"][number]],
    total: 1,
    next_cursor: null,
    counts: { all: 1, bass: 0, electric: 0, acoustic: 0, chords: 0 },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("listSongs", () => {
  it("sends only the parameters that are set", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(page("x")), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await listSongs({ q: "blue note", sort: "title", order: "asc", instrument: "all" });
    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    const params = new URL(url, "http://x").searchParams;
    expect(params.get("q")).toBe("blue note");
    expect(params.get("sort")).toBe("title");
    expect(params.has("cursor")).toBe(false);
    await listSongs({});
    expect(String((fetchMock.mock.calls[1] as unknown[])[0])).toMatch(/api\/songs$/);
  });
});

describe("loadLibrary", () => {
  it("lets a newer search win over a slower, older response", async () => {
    let release: (response: Response) => void = () => {};
    const slow = new Promise<Response>((resolve) => (release = resolve));
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(slow)
      .mockResolvedValueOnce(new Response(JSON.stringify(page("new")), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    ui.search = "old";
    const first = loadLibrary();
    ui.search = "new";
    await loadLibrary();
    release(new Response(JSON.stringify(page("old")), { status: 200 }));
    await first;

    expect(ui.songs.map((song) => song.title)).toEqual(["new"]);
  });
});

describe("setSort", () => {
  it("stores the sort and uses the natural order when none is given", () => {
    setSort("title");
    expect([ui.sort, ui.order]).toEqual(["title", "asc"]);
    setSort("opened");
    expect([ui.sort, ui.order]).toEqual(["opened", "desc"]);
    setSort("added", "asc");
    expect(JSON.parse(localStorage.getItem("fretbook.librarySort") ?? "{}")).toEqual({
      sort: "added",
      order: "asc",
    });
  });
});
