import { render, waitFor } from "@testing-library/svelte";
import { beforeEach, expect, it, vi } from "vitest";

import { invalidateSong } from "../lib/songUpdates.svelte";
import { handsFree, setStage } from "../lib/handsFree.svelte";
import SongView from "./SongView.svelte";

const api = vi.hoisted(() => ({ getSong: vi.fn(), markSongOpened: vi.fn() }));

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  ...api,
}));

beforeEach(() => {
  vi.clearAllMocks();
  api.getSong.mockImplementation(() => new Promise(() => {}));
  api.markSongOpened.mockResolvedValue(undefined);
});

it("fetches the active song again after that song is imported", async () => {
  render(SongView, { id: "same-song" });
  await waitFor(() => expect(api.getSong).toHaveBeenCalledTimes(1));

  invalidateSong("same-song");

  await waitFor(() => expect(api.getSong).toHaveBeenCalledTimes(2));
  expect(api.getSong).toHaveBeenLastCalledWith("same-song");
});

it("keeps the active song when another song is imported", async () => {
  render(SongView, { id: "active-song" });
  await waitFor(() => expect(api.getSong).toHaveBeenCalledTimes(1));

  invalidateSong("other-song");

  await new Promise<void>((resolve) => queueMicrotask(resolve));
  expect(api.getSong).toHaveBeenCalledTimes(1);
});

it("resets stage mode when opening a song outside a setlist", async () => {
  setStage(true);
  expect(handsFree.stage).toBe(true);
  render(SongView, { id: "outside-setlist" });
  await waitFor(() => expect(handsFree.stage).toBe(false));
});

it("preserves stage mode when inside a setlist", async () => {
  setStage(true);
  expect(handsFree.stage).toBe(true);
  render(SongView, { id: "inside-setlist", inSetlist: true });
  expect(handsFree.stage).toBe(true);
});
