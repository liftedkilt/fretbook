import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SongLibraryActions from "./SongLibraryActions.svelte";

const mockListLibraries = vi.fn();
const mockMoveSongTo = vi.fn();
const mockCopySongTo = vi.fn();
const mockRefresh = vi.fn();

vi.mock("../lib/api", () => ({
  listLibraries: (...args: unknown[]) => mockListLibraries(...args),
  listShares: vi.fn().mockResolvedValue([]),
  moveSongTo: (...args: unknown[]) => mockMoveSongTo(...args),
  copySongTo: (...args: unknown[]) => mockCopySongTo(...args),
  createShare: vi.fn(),
  revokeShare: vi.fn(),
}));

vi.mock("../lib/ui.svelte", () => ({
  ui: { shareLinks: false, libraryId: "" },
  refreshSongs: (...args: unknown[]) => mockRefresh(...args),
  setActiveLibrary: vi.fn(),
}));

vi.mock("../lib/router.svelte", () => ({
  hrefFor: (path: string) => path,
  navigate: vi.fn(),
}));

const libraries = [
  { id: "local", kind: "personal", name: "Local", role: "edit", song_count: 1 },
  { id: "band1", kind: "band", name: "Tuesday Band", role: "edit", song_count: 0 },
  { id: "band2", kind: "band", name: "Friday Band", role: "edit", song_count: 0 },
  { id: "band-view", kind: "band", name: "View Only", role: "view", song_count: 2 },
];

function optionValues(select: HTMLElement): string[] {
  return [...select.querySelectorAll("option")].map((option) => option.value);
}

describe("SongLibraryActions move", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListLibraries.mockResolvedValue(libraries);
    mockMoveSongTo.mockResolvedValue({ id: "s1" });
    mockCopySongTo.mockResolvedValue({ id: "s1-copy" });
    mockRefresh.mockResolvedValue(undefined);
  });

  it("moves a personal song into a band without posting the personal library", async () => {
    render(SongLibraryActions, { songId: "s1", libraryId: "local", moveOpen: true });
    const select = await screen.findByTestId("move-destination");
    await waitFor(() => expect(optionValues(select)).toEqual(["band1", "band2"]));
    expect((select as HTMLSelectElement).value).toBe("band1");

    await fireEvent.click(screen.getByTestId("move-move"));
    await waitFor(() => expect(mockMoveSongTo).toHaveBeenCalledWith("s1", "band1"));
    expect(mockCopySongTo).not.toHaveBeenCalled();
  });

  it("copies a personal song into the selected band", async () => {
    render(SongLibraryActions, { songId: "s1", libraryId: "local", moveOpen: true });
    const select = await screen.findByTestId("move-destination");
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe("band1"));
    await fireEvent.change(select, { target: { value: "band2" } });
    await fireEvent.click(screen.getByTestId("move-copy"));
    await waitFor(() => expect(mockCopySongTo).toHaveBeenCalledWith("s1", "band2"));
    expect(mockMoveSongTo).not.toHaveBeenCalled();
  });

  it("moves a band song back to the personal library", async () => {
    render(SongLibraryActions, { songId: "s1", libraryId: "band1", moveOpen: true });
    const select = await screen.findByTestId("move-destination");
    await waitFor(() => expect(optionValues(select)).toEqual(["local", "band2"]));
    expect((select as HTMLSelectElement).value).toBe("local");
    await fireEvent.click(screen.getByTestId("move-move"));
    await waitFor(() => expect(mockMoveSongTo).toHaveBeenCalledWith("s1", "local"));
  });

  it("moves a band song into another band", async () => {
    render(SongLibraryActions, { songId: "s1", libraryId: "band1", moveOpen: true });
    const select = await screen.findByTestId("move-destination");
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe("local"));
    await fireEvent.change(select, { target: { value: "band2" } });
    await fireEvent.click(screen.getByTestId("move-move"));
    await waitFor(() => expect(mockMoveSongTo).toHaveBeenCalledWith("s1", "band2"));
  });

  it("leaves move disabled when the song's library is the only editable one", async () => {
    mockListLibraries.mockResolvedValue([libraries[0]]);
    render(SongLibraryActions, { songId: "s1", libraryId: "local", moveOpen: true });
    await waitFor(() => expect(mockListLibraries).toHaveBeenCalled());
    await waitFor(async () => {
      await mockListLibraries.mock.results[0]?.value;
      expect(optionValues(screen.getByTestId("move-destination"))).toEqual([]);
      expect(screen.getByTestId("move-move")).toBeDisabled();
      expect(screen.getByTestId("move-copy")).toBeDisabled();
    });
  });
});
