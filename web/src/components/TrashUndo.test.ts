import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetTrashState, trashSong } from "../lib/trash.svelte";
import TrashUndo from "./TrashUndo.svelte";

const api = vi.hoisted(() => ({ deleteSong: vi.fn(), listTrash: vi.fn(), restoreSong: vi.fn() }));
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  ...api,
}));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("../lib/ui.svelte", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/ui.svelte")>()),
  refreshSongs: refresh,
}));

describe("TrashUndo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTrashState();
    refresh.mockResolvedValue(undefined);
    api.deleteSong.mockResolvedValue(undefined);
    api.restoreSong.mockResolvedValue({});
    api.listTrash.mockResolvedValue({ retention_days: 30, items: [] });
  });

  it("shows nothing until a song is deleted", () => {
    render(TrashUndo);
    expect(screen.queryByTestId("trash-undo")).toBeNull();
  });

  it("restores the song from the toast and refreshes the library", async () => {
    render(TrashUndo);
    await trashSong({ id: "s1", title: "Harbour Lights" });
    expect(await screen.findByTestId("trash-undo")).toHaveTextContent("Harbour Lights");
    await fireEvent.click(screen.getByTestId("trash-undo-button"));
    await waitFor(() => expect(screen.queryByTestId("trash-undo")).toBeNull());
    expect(api.restoreSong).toHaveBeenCalledWith("s1");
    expect(refresh).toHaveBeenCalled();
  });

  it("says when the restore failed, and can be dismissed", async () => {
    render(TrashUndo);
    await trashSong({ id: "s1", title: "Harbour Lights" });
    api.restoreSong.mockRejectedValue(new Error("gone"));
    await fireEvent.click(await screen.findByTestId("trash-undo-button"));
    await waitFor(() =>
      expect(screen.getByTestId("trash-undo")).toHaveTextContent("could not be restored"),
    );
    expect(refresh).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByTestId("trash-undo-dismiss"));
    await waitFor(() => expect(screen.queryByTestId("trash-undo")).toBeNull());
  });
});
