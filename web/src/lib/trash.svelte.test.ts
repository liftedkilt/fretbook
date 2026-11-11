import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ deleteSong: vi.fn(), listTrash: vi.fn(), restoreSong: vi.fn() }));
vi.mock("./api", () => api);

import {
  UNDO_MS,
  dismissUndo,
  resetTrashState,
  trashEnabled,
  trashSong,
  trashUndo,
  undoDelete,
} from "./trash.svelte";

const song = { id: "s1", title: "Harbour Lights" };

describe("trash undo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetTrashState();
    api.deleteSong.mockResolvedValue(undefined);
    api.restoreSong.mockResolvedValue({});
    api.listTrash.mockResolvedValue({ retention_days: 30, items: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("offers an undo after a delete and withdraws it after a while", async () => {
    await trashSong(song);
    expect(api.deleteSong).toHaveBeenCalledWith("s1");
    expect(trashUndo.current).toEqual({ id: "s1", title: "Harbour Lights", failed: false });
    vi.advanceTimersByTime(UNDO_MS);
    expect(trashUndo.current).toBeNull();
  });

  it("asks the server once whether it keeps deleted songs", async () => {
    await trashSong(song);
    await trashSong({ id: "s2", title: "Two" });
    expect(api.listTrash).toHaveBeenCalledTimes(1);
    expect(trashUndo.current?.id).toBe("s2");
  });

  it("offers nothing when the server has no trash", async () => {
    api.listTrash.mockResolvedValue({ retention_days: 0, items: [] });
    await trashSong(song);
    expect(trashUndo.current).toBeNull();
    expect(await undoDelete()).toBe(false);
  });

  it("offers nothing when the trash cannot be read, and asks again next time", async () => {
    api.listTrash.mockRejectedValueOnce(new Error("offline"));
    expect(await trashEnabled()).toBe(false);
    expect(await trashEnabled()).toBe(true);
    expect(api.listTrash).toHaveBeenCalledTimes(2);
  });

  it("does not offer an undo when the delete failed", async () => {
    api.deleteSong.mockRejectedValue(new Error("nope"));
    await expect(trashSong(song)).rejects.toThrow("nope");
    expect(trashUndo.current).toBeNull();
  });

  it("restores the song and clears the offer", async () => {
    await trashSong(song);
    expect(await undoDelete()).toBe(true);
    expect(api.restoreSong).toHaveBeenCalledWith("s1");
    expect(trashUndo.current).toBeNull();
  });

  it("keeps the offer, marked, when the restore fails", async () => {
    await trashSong(song);
    api.restoreSong.mockRejectedValue(new Error("gone"));
    expect(await undoDelete()).toBe(false);
    expect(trashUndo.current).toEqual({ id: "s1", title: "Harbour Lights", failed: true });
    vi.advanceTimersByTime(UNDO_MS);
    expect(trashUndo.current?.failed).toBe(true);
    dismissUndo();
    expect(trashUndo.current).toBeNull();
  });
});
