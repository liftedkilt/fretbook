// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  putSong: vi.fn(),
  noteRebase: vi.fn(),
  getSong: vi.fn(),
}));
vi.mock("../api", () => {
  class ApiError extends Error {
    status: number;
    key: string;
    constructor(status: number, message: string, key = "") {
      super(message);
      this.status = status;
      this.key = key;
    }
  }
  return {
    ApiError,
    getSong: api.getSong,
    putSong: api.putSong,
    noteRebase: api.noteRebase,
    isOfflineError: (error: unknown) =>
      error instanceof TypeError ||
      (error instanceof ApiError && error.key === "offline.unavailable"),
  };
});

const store = vi.hoisted(() => ({
  saveSong: vi.fn(),
  saveSetlistDocument: vi.fn(),
  forgetSong: vi.fn(async () => {}),
  forgetSetlist: vi.fn(async () => {}),
  clearAllData: vi.fn(async () => {}),
  warmEssentials: vi.fn(async () => {}),
}));
vi.mock("./store", () => ({ ...store, offlineSupported: () => true }));

import { ApiError } from "../api";
import {
  clearOfflineData,
  flushQueue,
  isSetlistSaved,
  isSongSaved,
  offline,
  queue,
  refreshSaved,
  removeSetlistOffline,
  removeSongOffline,
  resolveEdit,
  saveSetlistOffline,
  saveSongOffline,
} from "./offline.svelte";
import { queueEdit } from "./queueState.svelte";
import { emptyRegistry } from "./registry";

const edit = (songId: string, revision = 1) => ({
  songId,
  title: `Song ${songId}`,
  body: { title: `Song ${songId}`, artist: "", revision, chordpro: "x" },
  queuedAt: "2026-01-01T00:00:00Z",
  state: "pending" as const,
  message: "",
});

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  await clearOfflineData();
  offline.online = true;
  store.saveSong.mockImplementation(async (id: string) => ({
    id,
    title: `Song ${id}`,
    has_audio: false,
  }));
  store.saveSetlistDocument.mockResolvedValue({
    id: "s1",
    name: "Gig",
    entries: [{ song_id: "a" }, { song_id: "b" }, { song_id: "a" }],
  });
});

describe("saving for offline use", () => {
  it("saves a song and removes it again", async () => {
    await saveSongOffline("a", "Fallback");
    expect(isSongSaved("a")).toBe(true);
    expect(store.saveSong).toHaveBeenCalledWith("a");
    await removeSongOffline("a");
    expect(isSongSaved("a")).toBe(false);
    expect(store.forgetSong).toHaveBeenCalledWith("a");
  });

  it("saves a setlist with each of its songs once, and keeps a song that is saved on its own", async () => {
    await saveSongOffline("a", "A");
    await saveSetlistOffline("s1");
    expect(isSetlistSaved("s1")).toBe(true);
    expect(store.saveSong).toHaveBeenCalledTimes(3);
    expect(Object.keys(offline.saved.songs).sort()).toEqual(["a", "b"]);
    await removeSetlistOffline("s1");
    expect(isSetlistSaved("s1")).toBe(false);
    expect(isSongSaved("a")).toBe(true);
    expect(isSongSaved("b")).toBe(false);
    expect(store.forgetSong).toHaveBeenCalledWith("b");
    expect(store.forgetSong).not.toHaveBeenCalledWith("a");
    expect(store.forgetSetlist).toHaveBeenCalledWith("s1");
  });

  it("lets go of songs taken out of a saved setlist when it is refreshed", async () => {
    await saveSetlistOffline("s1");
    store.saveSetlistDocument.mockResolvedValue({
      id: "s1",
      name: "Gig",
      entries: [{ song_id: "a" }],
    });
    await refreshSaved();
    expect(isSongSaved("b")).toBe(false);
    expect(offline.saved.setlists.s1.songIds).toEqual(["a"]);
    expect(store.saveSong).toHaveBeenLastCalledWith("a", true);
  });

  it("refreshes songs saved on their own, and stays quiet when it cannot", async () => {
    await saveSongOffline("a", "A");
    await refreshSaved();
    expect(store.saveSong).toHaveBeenLastCalledWith("a", true);
    store.saveSong.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(refreshSaved()).resolves.toBeUndefined();
    offline.online = false;
    store.saveSong.mockClear();
    await refreshSaved();
    expect(store.saveSong).not.toHaveBeenCalled();
  });

  it("forgets everything on sign-out", async () => {
    await saveSongOffline("a", "A");
    queueEdit(edit("a"));
    await clearOfflineData();
    expect(store.clearAllData).toHaveBeenCalled();
    expect(offline.saved).toEqual(emptyRegistry());
    expect(queue.edits).toEqual([]);
  });
});

describe("flushQueue", () => {
  it("sends queued edits with the revision they were made on, and clears them", async () => {
    queueEdit(edit("a", 4));
    queueEdit(edit("b", 9));
    api.putSong.mockResolvedValue({});
    await flushQueue();
    expect(api.putSong).toHaveBeenNthCalledWith(1, "a", expect.objectContaining({ revision: 4 }));
    expect(api.putSong).toHaveBeenNthCalledWith(2, "b", expect.objectContaining({ revision: 9 }));
    expect(queue.edits).toEqual([]);
    expect(JSON.parse(localStorage.getItem("fretbook.offline.queue.v1") ?? "[]")).toEqual([]);
  });

  it("stops and keeps everything when the network is still down", async () => {
    queueEdit(edit("a"));
    queueEdit(edit("b"));
    api.putSong.mockRejectedValue(new TypeError("Failed to fetch"));
    await flushQueue();
    expect(api.putSong).toHaveBeenCalledTimes(1);
    expect(queue.edits).toHaveLength(2);
    expect(offline.syncing).toBe(false);
  });

  it("surfaces a conflict, carries on with the rest, and does not resend the conflicted edit", async () => {
    api.getSong.mockResolvedValue({
      id: "a",
      title: "Someone else",
      artist: "",
      chordpro: "y",
      revision: 9,
    });
    queueEdit(edit("a"));
    queueEdit(edit("b"));
    api.putSong.mockImplementation(async (id: string) => {
      if (id === "a") throw new ApiError(409, "changed elsewhere", "song.conflict");
      return {};
    });
    await flushQueue();
    expect(queue.edits.map((item) => [item.songId, item.state])).toEqual([["a", "conflict"]]);
    api.putSong.mockClear();
    await flushQueue();
    expect(api.putSong).not.toHaveBeenCalled();
  });

  it("treats a conflict with its own earlier send as done", async () => {
    queueEdit(edit("a", 4));
    api.putSong.mockRejectedValue(new ApiError(409, "changed", "song.conflict"));
    api.getSong.mockResolvedValue({
      id: "a",
      title: "Song a",
      artist: "",
      chordpro: "x",
      revision: 5,
    });
    await flushQueue();
    expect(queue.edits).toEqual([]);
    expect(api.noteRebase).toHaveBeenCalledWith("a", 4, 5);
  });

  describe("merging with a newer revision", () => {
    const bars = [{ signature: [4, 4], extras: {} }];
    const document = (bpm: number, points: number[] = []) => ({
      bpm,
      bars,
      tracks: [{ id: "t", bars: [] }],
      sync: { video_id: "v", points, anchors: {}, keyed_by: "played" },
    });
    const content = JSON.stringify({ bars, tracks: [{ id: "t", bars: [] }] });
    const tabEdit = (revision = 4, content_ = content) => ({
      ...edit("a", revision),
      body: {
        title: "Song a",
        artist: "",
        revision,
        document: document(100) as never,
      },
      base: { content: content_, bpm: 100, origin: [0] },
    });

    it("sends the edit on top of a newer revision when only sync marks or BPM moved", async () => {
      queueEdit(tabEdit());
      api.putSong
        .mockRejectedValueOnce(new ApiError(409, "changed", "song.conflict"))
        .mockResolvedValueOnce({ revision: 8 });
      api.getSong.mockResolvedValue({
        id: "a",
        title: "Song a",
        artist: "",
        revision: 7,
        document: document(120, [5]),
      });
      await flushQueue();
      expect(api.putSong).toHaveBeenLastCalledWith(
        "a",
        expect.objectContaining({
          revision: 7,
          document: expect.objectContaining({
            bpm: 120,
            sync: expect.objectContaining({ points: [5] }),
          }),
        }),
      );
      expect(api.noteRebase).toHaveBeenCalledWith("a", 4, 8);
      expect(queue.edits).toEqual([]);
    });

    it("still reports a conflict when the content changed, or the edit has no base", async () => {
      queueEdit(tabEdit(4, "something else"));
      queueEdit({ ...tabEdit(), songId: "b", base: undefined });
      api.putSong.mockRejectedValue(new ApiError(409, "changed", "song.conflict"));
      api.getSong.mockResolvedValue({ id: "x", revision: 7, document: document(120) });
      await flushQueue();
      expect(queue.edits.map((item) => item.state)).toEqual(["conflict", "conflict"]);
      expect(api.putSong).toHaveBeenCalledTimes(2);
    });

    it("reports a conflict when the song moves again during the merge", async () => {
      queueEdit(tabEdit());
      api.putSong.mockRejectedValue(new ApiError(409, "changed", "song.conflict"));
      api.getSong.mockResolvedValue({ id: "a", revision: 7, document: document(120) });
      await flushQueue();
      expect(queue.edits[0].state).toBe("conflict");
    });

    it("keeps the edit when the network drops during the merge", async () => {
      queueEdit(tabEdit());
      api.putSong
        .mockRejectedValueOnce(new ApiError(409, "changed", "song.conflict"))
        .mockRejectedValueOnce(new TypeError("Failed to fetch"));
      api.getSong.mockResolvedValue({ id: "a", revision: 7, document: document(120) });
      await flushQueue();
      expect(queue.edits[0].state).toBe("pending");
    });
  });

  it("keeps the edit when it cannot tell, because the song could not be fetched", async () => {
    queueEdit(edit("a", 4));
    api.putSong.mockRejectedValue(new ApiError(409, "changed", "song.conflict"));
    api.getSong.mockRejectedValue(new TypeError("Failed to fetch"));
    await flushQueue();
    expect(queue.edits[0].state).toBe("pending");
  });

  it("marks other refusals as failed, and gives up quietly on an unexpected error", async () => {
    queueEdit(edit("a"));
    api.putSong.mockRejectedValue(new ApiError(422, "bad", "request.invalid"));
    await flushQueue();
    expect(queue.edits[0]).toMatchObject({ state: "failed", message: "bad" });
    queueEdit(edit("b"));
    api.putSong.mockRejectedValue(new Error("boom"));
    await flushQueue();
    expect(queue.edits.find((item) => item.songId === "b")?.state).toBe("pending");
  });

  it("does not run twice at once", async () => {
    queueEdit(edit("a"));
    let release = () => {};
    api.putSong.mockImplementation(() => new Promise((resolve) => (release = () => resolve({}))));
    const first = flushQueue();
    await flushQueue();
    expect(api.putSong).toHaveBeenCalledTimes(1);
    release();
    await first;
  });
});

describe("resolveEdit", () => {
  async function conflicted() {
    queueEdit(edit("a", 1));
    api.putSong.mockRejectedValueOnce(new ApiError(409, "changed", "song.conflict"));
    await flushQueue();
    api.putSong.mockReset();
  }

  it("keeping mine saves the edit on top of the newer revision", async () => {
    await conflicted();
    api.getSong.mockResolvedValue({ id: "a", revision: 8 });
    api.putSong.mockResolvedValue({});
    await resolveEdit("a", "mine");
    expect(api.putSong).toHaveBeenCalledWith("a", expect.objectContaining({ revision: 8 }));
    expect(queue.edits).toEqual([]);
  });

  it("keeping mine stays a conflict if the song moved again", async () => {
    await conflicted();
    api.getSong.mockResolvedValue({ id: "a", revision: 8 });
    api.putSong.mockRejectedValue(new ApiError(409, "again", "song.conflict"));
    await expect(resolveEdit("a", "mine")).rejects.toThrow("again");
    expect(queue.edits[0].state).toBe("conflict");
  });

  it("using the other version drops the edit and refreshes a saved copy", async () => {
    await saveSongOffline("a", "A");
    await conflicted();
    api.getSong.mockResolvedValue({ id: "a", revision: 8 });
    store.saveSong.mockClear();
    await resolveEdit("a", "theirs");
    expect(queue.edits).toEqual([]);
    expect(store.saveSong).toHaveBeenCalledWith("a", true);
    expect(api.putSong).not.toHaveBeenCalled();
  });

  it("ignores a song with nothing queued", async () => {
    await resolveEdit("zzz", "mine");
    expect(api.getSong).not.toHaveBeenCalled();
  });
});
