import { beforeEach, describe, expect, it, vi } from "vitest";

const listSongs = vi.fn();
const listTags = vi.fn();
const getMeta = vi.fn();
const getMe = vi.fn();
const saveSettings = vi.fn();

vi.mock("./api", () => ({
  listSongs: (...args: unknown[]) => listSongs(...args),
  listTags: () => listTags(),
  getMeta: () => getMeta(),
  getMe: () => getMe(),
  saveSettings: (...args: unknown[]) => saveSettings(...args),
}));

import {
  closeSheet,
  countFor,
  defaultFamily,
  loadLibrary,
  loadMeta,
  loadMore,
  openSheet,
  openTuner,
  refreshSongs,
  setDefaultInstrument,
  setNotation,
  setPlayerView,
  setSort,
  setTheme,
  storedPlayerView,
  ui,
} from "./ui.svelte";

const counts = { all: 3, bass: 1, electric: 1, acoustic: 1 };

function page(ids: string[], nextCursor: string | null = null) {
  return {
    items: ids.map((id) => ({ id })),
    total: 3,
    next_cursor: nextCursor,
    counts,
  };
}

beforeEach(() => {
  listSongs.mockReset();
  listTags.mockReset();
  listTags.mockResolvedValue([]);
  getMeta.mockReset();
  getMe.mockReset();
  saveSettings.mockReset();
  ui.search = "";
  ui.sheet = "";
  ui.tunerRequest = null;
});

describe("sheets", () => {
  it("opens and closes sheets", () => {
    openSheet("settings");
    expect(ui.sheet).toBe("settings");
    closeSheet();
    expect(ui.sheet).toBe("");
  });

  it("opens the tuner with or without a song's tuning", () => {
    openTuner({ tuning: [64, 59], capo: 2 });
    expect(ui.sheet).toBe("tuner");
    expect(ui.tunerRequest).toEqual({ tuning: [64, 59], capo: 2 });
    openTuner();
    expect(ui.tunerRequest).toBeNull();
  });
});

describe("library", () => {
  it("loads the first page and skips an unchanged query", async () => {
    listSongs.mockResolvedValue(page(["a", "b"], "next"));
    await loadLibrary({ force: true });
    expect(ui.songs.map((song) => song.id)).toEqual(["a", "b"]);
    expect(ui.nextCursor).toBe("next");
    expect(countFor("bass")).toBe(1);
    await loadLibrary();
    expect(listSongs).toHaveBeenCalledTimes(1);
  });

  it("appends the next page without duplicates", async () => {
    listSongs.mockResolvedValueOnce(page(["a", "b"], "next"));
    await loadLibrary({ force: true });
    listSongs.mockResolvedValueOnce(page(["b", "c"]));
    await loadMore();
    expect(ui.songs.map((song) => song.id)).toEqual(["a", "b", "c"]);
    expect(ui.nextCursor).toBeNull();
    expect(ui.loadingMore).toBe(false);
    await loadMore();
    expect(listSongs).toHaveBeenCalledTimes(2);
  });

  it("refreshes the library and the recent list together", async () => {
    listSongs.mockResolvedValue(page(["a"]));
    listTags.mockResolvedValue([{ tag: "Funk", count: 1 }]);
    await refreshSongs();
    expect(ui.recent.map((song) => song.id)).toEqual(["a"]);
    expect(ui.favourites.map((song) => song.id)).toEqual(["a"]);
    expect(ui.tagList).toEqual([{ tag: "Funk", count: 1 }]);
  });

  it("remembers the sort in its natural order", () => {
    setSort("title", "asc");
    expect(ui.sort).toBe("title");
    expect(ui.order).toBe("asc");
    setSort("updated");
    expect(ui.sort).toBe("updated");
  });
});

describe("settings", () => {
  it("loads the server's presets and the user's default instrument", async () => {
    getMeta.mockResolvedValue({
      instruments: [{ id: "bass-4", family: "bass" }],
      ytdlp: null,
      version: "1.2.3",
      commit: "abc",
    });
    getMe.mockResolvedValue({ settings: { default_instrument: "bass-4" } });
    await loadMeta();
    expect(ui.version).toBe("1.2.3");
    expect(ui.defaultInstrument).toBe("bass-4");
    expect(defaultFamily()).toBe("bass");
    await loadMeta();
    expect(getMeta).toHaveBeenCalledTimes(1);
  });

  it("saves the default instrument", async () => {
    saveSettings.mockResolvedValue({ default_instrument: "guitar-6" });
    await setDefaultInstrument("guitar-6");
    expect(saveSettings).toHaveBeenCalledWith({ default_instrument: "guitar-6" });
    expect(ui.defaultInstrument).toBe("guitar-6");
    expect(defaultFamily()).toBe("bass");
  });

  it("keeps the theme, notation and player view when storage is unavailable", () => {
    setTheme("light");
    expect(ui.theme).toBe("light");
    setTheme("system");
    expect(ui.theme).toBe("system");
    setNotation(true);
    expect(ui.notation).toBe(true);
    setNotation(false);
    expect(ui.notation).toBe(false);
    setPlayerView("highway");
    expect(ui.playerView).toBe("highway");
    setPlayerView("split");
    expect(ui.playerView).toBe("split");
    setPlayerView("tab");
    expect(ui.playerView).toBe("tab");
    expect(storedPlayerView("user-1")).toBe("tab");
  });
});
