import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ui } from "../lib/ui.svelte";
import ManageTagsSheet from "./ManageTagsSheet.svelte";

const api = vi.hoisted(() => ({ renameTag: vi.fn(), deleteTag: vi.fn() }));
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  renameTag: api.renameTag,
  deleteTag: api.deleteTag,
}));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("../lib/ui.svelte", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/ui.svelte")>()),
  refreshSongs: refresh,
}));

describe("ManageTagsSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refresh.mockResolvedValue(undefined);
    ui.tagList = [
      { tag: "funk", count: 2 },
      { tag: "jazz", count: 1 },
    ];
  });

  it("renames a tag and refreshes the library", async () => {
    api.renameTag.mockResolvedValue(2);
    render(ManageTagsSheet, { open: true, onclose: () => {} });
    await fireEvent.click(screen.getAllByTestId("manage-tag-rename")[0]);
    await fireEvent.input(screen.getByTestId("manage-tag-name"), { target: { value: "groove" } });
    await fireEvent.click(screen.getByTestId("manage-tag-save"));
    await waitFor(() => expect(api.renameTag).toHaveBeenCalledWith("funk", "groove"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.getByTestId("manage-tags-notice").textContent).toContain("groove");
  });

  it("says when a name will merge into another tag", async () => {
    render(ManageTagsSheet, { open: true, onclose: () => {} });
    await fireEvent.click(screen.getAllByTestId("manage-tag-rename")[0]);
    expect(screen.queryByTestId("manage-tag-merge")).toBeNull();
    await fireEvent.input(screen.getByTestId("manage-tag-name"), { target: { value: "Jazz" } });
    expect(screen.getByTestId("manage-tag-merge")).toBeTruthy();
  });

  it("asks before deleting a tag from every song", async () => {
    api.deleteTag.mockResolvedValue(2);
    render(ManageTagsSheet, { open: true, onclose: () => {} });
    await fireEvent.click(screen.getAllByTestId("manage-tag-delete")[0]);
    expect(api.deleteTag).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByTestId("manage-tag-confirm"));
    await waitFor(() => expect(api.deleteTag).toHaveBeenCalledWith("funk"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
