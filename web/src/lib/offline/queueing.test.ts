// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getSong, isOfflineError, updateSong, ApiError } from "../api";
import { queue } from "./queueState.svelte";
import { clearOfflineData, flushQueue } from "./offline.svelte";

const song = {
  id: "s1",
  title: "Old",
  artist: "Me",
  revision: 3,
  document: null,
  chordpro: "{title: Old}",
  content_kind: "chords",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(async () => {
  localStorage.clear();
  await clearOfflineData();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("updateSong with no network", () => {
  it("queues the edit and answers with the song as it would be saved, at the same revision", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") throw new TypeError("Failed to fetch");
      return json(song);
    });
    vi.stubGlobal("fetch", fetcher);
    await getSong("s1");
    const saved = await updateSong("s1", {
      title: "New",
      artist: "Me",
      revision: 3,
      chordpro: "{title: New}",
    });
    expect(saved).toMatchObject({ title: "New", chordpro: "{title: New}", revision: 3 });
    expect(queue.edits).toHaveLength(1);
    expect(queue.edits[0]).toMatchObject({ songId: "s1", state: "pending" });
    expect(queue.edits[0].body.revision).toBe(3);

    // A second offline save builds on the first and still goes out on the original revision.
    await updateSong("s1", { title: "Newer", artist: "Me", revision: 3, chordpro: "x" });
    expect(queue.edits).toHaveLength(1);
    expect(queue.edits[0].body).toMatchObject({ title: "Newer", revision: 3 });
  });

  it("does not queue what the server refused, or an edit to a song this page never loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === "PUT"
          ? json({ detail: { key: "song.conflict", message: "changed", params: {} } }, 409)
          : json(song),
      ),
    );
    await getSong("s1");
    await expect(
      updateSong("s1", { title: "New", artist: "Me", revision: 1, chordpro: "x" }),
    ).rejects.toMatchObject({ status: 409 });
    expect(queue.edits).toEqual([]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(
      updateSong("never-seen", { title: "x", artist: "", revision: 1, chordpro: "x" }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(queue.edits).toEqual([]);
  });

  it("recognises both kinds of offline failure", () => {
    expect(isOfflineError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isOfflineError(new ApiError(503, "x", "offline.unavailable"))).toBe(true);
    expect(isOfflineError(new ApiError(503, "x", "other"))).toBe(false);
    expect(isOfflineError(new Error("x"))).toBe(false);
  });

  it("a save after the queued edit was sent builds on the revision that edit produced", async () => {
    let online = false;
    const puts: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== "PUT") return json(song);
        if (!online) throw new TypeError("Failed to fetch");
        const body = JSON.parse(String(init.body)) as { revision: number };
        puts.push(body.revision);
        return json({ ...song, revision: body.revision + 1 });
      }),
    );
    await getSong("s1");
    await updateSong("s1", { title: "A", artist: "", revision: 3, chordpro: "a" });
    online = true;
    await flushQueue();
    expect(queue.edits).toEqual([]);
    // The editor still holds revision 3, but the server moved on to 4 because of its own edit.
    const saved = await updateSong("s1", { title: "B", artist: "", revision: 3, chordpro: "b" });
    expect(puts).toEqual([3, 4]);
    expect(saved.revision).toBe(5);
  });

  it("an online save replaces an edit still waiting to be sent", async () => {
    let online = false;
    const puts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== "PUT") return json(song);
        if (!online) throw new TypeError("Failed to fetch");
        puts.push((JSON.parse(String(init.body)) as { title: string }).title);
        return json({ ...song, revision: 4 });
      }),
    );
    await getSong("s1");
    await updateSong("s1", { title: "Queued", artist: "", revision: 3, chordpro: "a" });
    expect(queue.edits).toHaveLength(1);
    online = true;
    await updateSong("s1", { title: "Newer", artist: "", revision: 3, chordpro: "b" });
    expect(queue.edits).toEqual([]);
    await flushQueue();
    expect(puts).toEqual(["Newer"]);
  });
});
