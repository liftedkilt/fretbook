import { fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ui } from "../lib/ui.svelte";
import AddSheet from "./AddSheet.svelte";

const mockCreateTab = vi.fn();
const mockCreateChordSheet = vi.fn();
const mockImportUrl = vi.fn();
const mockPreviewImport = vi.fn();
const mockImportFile = vi.fn();
const mockWaitForJob = vi.fn();
const mockListSongs = vi.fn();
const emptyPage = {
  items: [],
  total: 0,
  next_cursor: null,
  counts: { all: 0, bass: 0, electric: 0, acoustic: 0, chords: 0 },
};

vi.mock("../lib/api", () => ({
  createTab: (...args: unknown[]) => mockCreateTab(...args),
  createChordSheet: (...args: unknown[]) => mockCreateChordSheet(...args),
  importUrl: (...args: unknown[]) => mockImportUrl(...args),
  previewImport: (...args: unknown[]) => mockPreviewImport(...args),
  importFile: (...args: unknown[]) => mockImportFile(...args),
  waitForJob: (...args: unknown[]) => mockWaitForJob(...args),
  listSongs: (...args: unknown[]) => mockListSongs(...args),
  apiUrl: (p: string) => p,
}));

describe("AddSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ui.sheet = "add";
    ui.presets = [
      {
        id: "bass-4",
        label_key: "instrument.bass4",
        label: "4-string bass",
        instrument: "bass",
        name: "Standard Bass",
        tuning_midi: [28, 33, 38, 43],
        string_count: 4,
        family: "bass",
      },
    ];
    ui.defaultInstrument = "bass-4";
  });

  it("renders all import mode options", () => {
    render(AddSheet);

    expect(screen.getByTestId("add-mode-link")).toBeInTheDocument();
    expect(screen.getByTestId("add-mode-file")).toBeInTheDocument();
    expect(screen.getByTestId("add-mode-tab")).toBeInTheDocument();
    expect(screen.getByTestId("add-mode-chords")).toBeInTheDocument();

    // Default mode is link
    expect(screen.getByTestId("add-url")).toBeInTheDocument();
  });

  it("switches to file import source mode", async () => {
    render(AddSheet);

    await fireEvent.click(screen.getByTestId("add-mode-file"));

    expect(screen.getByTestId("add-file-input")).toBeInTheDocument();
    expect(screen.queryByTestId("add-url")).toBeNull();
  });

  it("switches to blank tab source mode and creates a tab", async () => {
    mockCreateTab.mockResolvedValueOnce({ id: "new-tab-id" });
    mockListSongs.mockResolvedValue(emptyPage);

    render(AddSheet);

    await fireEvent.click(screen.getByTestId("add-mode-tab"));

    const titleInput = screen.getByTestId("add-tab-title");
    await fireEvent.input(titleInput, { target: { value: "My New Song" } });

    const submitBtn = screen.getByTestId("add-tab-submit");
    await fireEvent.click(submitBtn);

    expect(mockCreateTab).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "My New Song",
        preset: "bass-4",
        bpm: 120,
      }),
    );
    expect(ui.sheet).toBe("");
  });

  it("switches to chord sheet source mode and creates a chord sheet", async () => {
    mockCreateChordSheet.mockResolvedValueOnce({ id: "new-chord-id" });
    mockListSongs.mockResolvedValue(emptyPage);

    render(AddSheet);

    await fireEvent.click(screen.getByTestId("add-mode-chords"));

    const titleInput = screen.getByTestId("add-sheet-title");
    await fireEvent.input(titleInput, { target: { value: "Acoustic Ballad" } });

    const textInput = screen.getByTestId("add-sheet-text");
    await fireEvent.input(textInput, { target: { value: "[C]La la [G]la" } });

    const submitBtn = screen.getByTestId("add-sheet-submit");
    await fireEvent.click(submitBtn);

    expect(mockCreateChordSheet).toHaveBeenCalledWith({
      title: "Acoustic Ballad",
      artist: "",
      chordpro: "[C]La la [G]la",
    });
    expect(ui.sheet).toBe("");
  });

  it("imports from url source in link mode", async () => {
    mockImportUrl.mockResolvedValueOnce({ job_id: "job-123" });
    mockWaitForJob.mockResolvedValueOnce({
      status: "done",
      result: { song_id: "imported-song-id" },
    });
    mockListSongs.mockResolvedValue(emptyPage);

    render(AddSheet);

    const urlInput = screen.getByTestId("add-url");
    await fireEvent.input(urlInput, { target: { value: "https://example.com/song.musicxml" } });

    const submitBtn = screen.getByRole("button", { name: /import/i });
    await fireEvent.click(submitBtn);

    expect(mockImportUrl).toHaveBeenCalledWith("https://example.com/song.musicxml", "", null);
    expect(mockWaitForJob).toHaveBeenCalledWith("job-123", expect.any(Function));
    expect(ui.sheet).toBe("");
  });
});
