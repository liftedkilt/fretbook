// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  audioUrl,
  clearAllData,
  forgetSetlist,
  forgetSong,
  offlineSupported,
  refreshSavedSong,
  saveSetlistDocument,
  saveSong,
  setlistUrl,
  songUrl,
  warmEssentials,
} from "./store";
import { DATA_CACHE } from "./swCore";

const entries = new Map<string, Response>();
const cache = {
  match: async (key: string) => entries.get(key)?.clone(),
  put: async (key: string, response: Response) => void entries.set(key, response),
  delete: async (key: string) => entries.delete(key),
};
const caches = {
  open: vi.fn(async () => cache),
  delete: vi.fn(async () => true),
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  entries.clear();
  vi.stubGlobal("caches", caches);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("store", () => {
  it("saves a song and its audio under the URLs the worker looks up", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === songUrl("a") ? json({ id: "a", has_audio: true }) : new Response("audio"),
      ),
    );
    const song = await saveSong("a");
    expect(song.id).toBe("a");
    expect(entries.has(songUrl("a"))).toBe(true);
    expect(await entries.get(audioUrl("a"))!.text()).toBe("audio");
  });

  it("does not download audio again on a refresh, and skips it for a song without any", async () => {
    const fetcher = vi.fn(async (url: string) =>
      url === songUrl("a") ? json({ id: "a", has_audio: true }) : new Response("audio"),
    );
    vi.stubGlobal("fetch", fetcher);
    await saveSong("a");
    fetcher.mockClear();
    await saveSong("a", true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockImplementation(async () => json({ id: "b", has_audio: false }));
    fetcher.mockClear();
    await saveSong("b");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("throws rather than report a song as saved when a download fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ detail: "no" }, 404)),
    );
    await expect(saveSong("a")).rejects.toThrow("404");
    expect(entries.size).toBe(0);
  });

  it("saves and forgets a setlist and a song", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ id: "s", entries: [] })),
    );
    await saveSetlistDocument("s");
    expect(entries.has(setlistUrl("s"))).toBe(true);
    await forgetSetlist("s");
    expect(entries.has(setlistUrl("s"))).toBe(false);
    entries.set(songUrl("a"), json({}));
    entries.set(audioUrl("a"), new Response("x"));
    await forgetSong("a");
    expect(entries.size).toBe(0);
  });

  it("refreshes only songs that were saved", async () => {
    const song = { id: "a", title: "New" } as never;
    await refreshSavedSong(song);
    expect(entries.size).toBe(0);
    entries.set(songUrl("a"), json({ id: "a", title: "Old" }));
    await refreshSavedSong(song);
    expect(await entries.get(songUrl("a"))!.json()).toMatchObject({ title: "New" });
  });

  it("keeps the meta and account answers the app starts with", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ ok: true })),
    );
    await warmEssentials();
    expect([...entries.keys()].map((key) => new URL(key).pathname)).toEqual([
      "/api/meta",
      "/api/me",
    ]);
  });

  it("clears the data cache", async () => {
    await clearAllData();
    expect(caches.delete).toHaveBeenCalledWith(DATA_CACHE);
  });

  it("does nothing, and says so, in a browser without the Cache API", async () => {
    vi.stubGlobal("caches", undefined);
    expect(offlineSupported()).toBe(false);
    await expect(saveSong("a")).rejects.toThrow("not available");
    await forgetSong("a");
    await forgetSetlist("a");
    await refreshSavedSong({ id: "a" } as never);
    await clearAllData();
  });
});
