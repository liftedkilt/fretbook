import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ui } from "../lib/ui.svelte";
import TrashSettings from "./TrashSettings.svelte";

const api = vi.hoisted(() => ({
  listTrash: vi.fn(),
  restoreSong: vi.fn(),
  deleteTrashedSong: vi.fn(),
  emptyTrash: vi.fn(),
}));
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  ...api,
}));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("../lib/ui.svelte", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/ui.svelte")>()),
  refreshSongs: refresh,
}));

function row(id: string, title: string, artist = "Ada") {
  return {
    id,
    title,
    artist,
    content_kind: "chords",
    deleted_at: "2026-03-01T10:00:00+00:00",
    purge_at: "2026-03-31T10:00:00+00:00",
    media_bytes: 0,
  };
}

describe("TrashSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ui.libraryId = "";
    refresh.mockResolvedValue(undefined);
    api.listTrash.mockResolvedValue({
      retention_days: 30,
      items: [row("s1", "Harbour Lights"), row("s2", "Quay Song", "")],
    });
    api.restoreSong.mockResolvedValue({});
    api.deleteTrashedSong.mockResolvedValue(undefined);
    api.emptyTrash.mockResolvedValue(1);
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("lists deleted songs with when they go for good", async () => {
    render(TrashSettings);
    const rows = await screen.findAllByTestId("trash-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Harbour Lights");
    expect(rows[0]).toHaveTextContent("Ada");
    expect(rows[0]).toHaveTextContent(
      new Date("2026-03-31T10:00:00+00:00").toLocaleDateString("en"),
    );
    expect(screen.getByTestId("trash-settings")).toHaveTextContent("30 days");
    expect(api.listTrash).toHaveBeenCalledWith("");
  });

  it("is hidden when the server has no trash or the library cannot be edited", async () => {
    api.listTrash.mockResolvedValueOnce({ retention_days: 0, items: [] });
    const first = render(TrashSettings);
    await waitFor(() => expect(api.listTrash).toHaveBeenCalled());
    expect(screen.queryByTestId("trash-settings")).toBeNull();
    first.unmount();

    ui.libraryId = "band";
    api.listTrash.mockRejectedValueOnce(new Error("read only"));
    render(TrashSettings);
    await waitFor(() => expect(api.listTrash).toHaveBeenCalledWith("band"));
    expect(screen.queryByTestId("trash-settings")).toBeNull();
  });

  it("says so when the trash is empty", async () => {
    api.listTrash.mockResolvedValue({ retention_days: 7, items: [] });
    render(TrashSettings);
    expect(await screen.findByTestId("trash-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("trash-clear")).toBeNull();
  });

  it("restores a song and refreshes the library", async () => {
    render(TrashSettings);
    await fireEvent.click((await screen.findAllByTestId("trash-restore"))[0]);
    await waitFor(() => expect(screen.getAllByTestId("trash-row")).toHaveLength(1));
    expect(api.restoreSong).toHaveBeenCalledWith("s1");
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByTestId("trash-notice")).toHaveTextContent("Harbour Lights");
  });

  it("deletes one for good only after a confirmation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(TrashSettings);
    const buttons = await screen.findAllByTestId("trash-delete");
    await fireEvent.click(buttons[1]);
    expect(api.deleteTrashedSong).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await fireEvent.click(buttons[1]);
    await waitFor(() => expect(screen.getAllByTestId("trash-row")).toHaveLength(1));
    expect(api.deleteTrashedSong).toHaveBeenCalledWith("s2");
  });

  it("empties the trash after a confirmation and shows a failure", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(TrashSettings);
    const clear = await screen.findByTestId("trash-clear");
    await fireEvent.click(clear);
    expect(api.emptyTrash).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    api.emptyTrash.mockRejectedValueOnce(new Error("server said no"));
    await fireEvent.click(clear);
    expect(await screen.findByRole("alert")).toHaveTextContent("server said no");
    api.emptyTrash.mockRejectedValueOnce("odd");
    await fireEvent.click(clear);
    await waitFor(() => expect(api.emptyTrash).toHaveBeenCalledTimes(2));
    expect(screen.getAllByTestId("trash-row")).toHaveLength(2);

    await fireEvent.click(clear);
    expect(await screen.findByTestId("trash-empty")).toBeInTheDocument();
    expect(api.emptyTrash).toHaveBeenLastCalledWith("");
  });
});
