import { fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ui } from "../lib/ui.svelte";
import AddSheet from "./AddSheet.svelte";

const mockCreateTab = vi.fn();
const mockCreateChordSheet = vi.fn();
const mockImportUrl = vi.fn();
const mockPreviewImport = vi.fn();
const mockPreviewAsciiTab = vi.fn();
const mockImportAsciiTab = vi.fn();
const mockImportFile = vi.fn();
const mockImportAuto = vi.fn();
const mockInspectMidi = vi.fn();
const mockImportMidi = vi.fn();
const mockImportDocument = vi.fn();
const mockWaitForJob = vi.fn();
const mockListSongs = vi.fn();
const emptyPage = {
  items: [],
  total: 0,
  next_cursor: null,
  counts: { all: 0, bass: 0, electric: 0, acoustic: 0, chords: 0 },
};

vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {},
  createTab: (...args: unknown[]) => mockCreateTab(...args),
  createChordSheet: (...args: unknown[]) => mockCreateChordSheet(...args),
  importUrl: (...args: unknown[]) => mockImportUrl(...args),
  previewImport: (...args: unknown[]) => mockPreviewImport(...args),
  previewAsciiTab: (...args: unknown[]) => mockPreviewAsciiTab(...args),
  importAsciiTab: (...args: unknown[]) => mockImportAsciiTab(...args),
  importFile: (...args: unknown[]) => mockImportFile(...args),
  importAuto: (...args: unknown[]) => mockImportAuto(...args),
  inspectMidi: (...args: unknown[]) => mockInspectMidi(...args),
  importMidi: (...args: unknown[]) => mockImportMidi(...args),
  importDocument: (...args: unknown[]) => mockImportDocument(...args),
  waitForJob: (...args: unknown[]) => mockWaitForJob(...args),
  listSongs: (...args: unknown[]) => mockListSongs(...args),
  listTags: vi.fn().mockResolvedValue([]),
  setFavourite: vi.fn(),
  addTags: vi.fn(),
  apiUrl: (p: string) => p,
}));

// jsdom cannot lay out a score; keep the real model for the Guitar Pro reader and stub the renderer.
vi.mock("@coderline/alphatab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@coderline/alphatab")>()),
  AlphaTabApi: class {
    tex = vi.fn();
    destroy = vi.fn();
  },
}));

const TAB = "e|-0---3---|\nB|---------|\nG|---------|\nD|---------|\n";

function previewOf(overrides: Record<string, unknown> = {}) {
  return {
    content_kind: "tab",
    title: "Found Title",
    artist: "",
    chordpro: null,
    rhythm_estimated: true,
    warnings: [{ key: "import.rhythmEstimated", message: "", params: {} }],
    document: {
      version: 1,
      bpm: 120,
      bars: [{ signature: [4, 4], repeat_start: false, repeat_end: 0, alternate_endings: [] }],
      tracks: [
        {
          id: "trk",
          name: "Bass",
          instrument: "bass-guitar",
          capo: 0,
          tuning_midi: [43, 38, 33, 28],
          preferred: true,
          bars: [{ voices: [{ beats: [] }] }],
        },
      ],
      sync: { video_id: null, points: [], anchors: {} },
    },
    ...overrides,
  };
}

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

    expect(screen.getByTestId("add-mode-any")).toBeInTheDocument();

    // The Add box is the default mode
    expect(screen.getByTestId("any-text")).toBeInTheDocument();
    expect(screen.queryByTestId("add-url")).toBeNull();
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
    await fireEvent.click(screen.getByTestId("add-mode-link"));

    const urlInput = screen.getByTestId("add-url");
    await fireEvent.input(urlInput, { target: { value: "https://example.com/song.musicxml" } });

    const submitBtn = screen.getByRole("button", { name: /import/i });
    await fireEvent.click(submitBtn);

    expect(mockImportUrl).toHaveBeenCalledWith("https://example.com/song.musicxml", "", null);
    expect(mockWaitForJob).toHaveBeenCalledWith("job-123", expect.any(Function));
    expect(ui.sheet).toBe("");
  });

  it("previews pasted tab, says the rhythm is estimated, and saves it", async () => {
    mockPreviewAsciiTab.mockResolvedValue(previewOf());
    mockImportAsciiTab.mockResolvedValueOnce({ id: "pasted-id" });
    mockListSongs.mockResolvedValueOnce([]);

    render(AddSheet);
    await fireEvent.click(screen.getByTestId("add-mode-paste"));
    expect(screen.getByTestId("paste-submit")).toBeDisabled();

    await fireEvent.input(screen.getByTestId("paste-text"), { target: { value: TAB } });
    await fireEvent.change(screen.getByTestId("paste-grid"), { target: { value: "16" } });
    await fireEvent.input(screen.getByTestId("paste-bpm"), { target: { value: "90" } });

    expect(await screen.findByTestId("rhythm-estimated")).toBeInTheDocument();
    expect(await screen.findByTestId("tab-preview")).toBeInTheDocument();
    expect(mockPreviewAsciiTab).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: TAB, grid: 16, bpm: 90, signature: [4, 4] }),
      expect.any(AbortSignal),
    );
    expect(screen.getByTestId("paste-title")).toHaveAttribute("placeholder", "Found Title");

    await fireEvent.input(screen.getByTestId("paste-title"), { target: { value: "My Riff" } });
    await fireEvent.click(screen.getByTestId("paste-submit"));

    await vi.waitFor(() => expect(mockImportAsciiTab).toHaveBeenCalled());
    expect(mockImportAsciiTab).toHaveBeenCalledWith(
      expect.objectContaining({ text: TAB, title: "My Riff", grid: 16, bpm: 90 }),
    );
    await vi.waitFor(() => expect(ui.sheet).toBe(""));
  });

  it("tells the reader when pasted text is chords over lyrics", async () => {
    mockPreviewAsciiTab.mockResolvedValue(
      previewOf({
        content_kind: "chords",
        document: null,
        chordpro: "[G]Hello my [C]friend\n",
        rhythm_estimated: false,
        warnings: [],
      }),
    );
    render(AddSheet);
    await fireEvent.click(screen.getByTestId("add-mode-paste"));
    await fireEvent.input(screen.getByTestId("paste-text"), {
      target: { value: "G        C\nHello my friend\n" },
    });

    expect(await screen.findByTestId("paste-chords-note")).toBeInTheDocument();
    expect(screen.queryByTestId("rhythm-estimated")).toBeNull();
  });

  it("shows the server's message when the pasted text cannot be converted", async () => {
    mockPreviewAsciiTab.mockRejectedValue(new Error("Bar 1 has too many notes to place."));
    render(AddSheet);
    await fireEvent.click(screen.getByTestId("add-mode-paste"));
    await fireEvent.input(screen.getByTestId("paste-text"), { target: { value: TAB } });

    expect(await screen.findByTestId("paste-error")).toHaveTextContent("too many notes");
  });

  describe("Add box", () => {
    beforeEach(() => {
      mockListSongs.mockResolvedValue(emptyPage);
      mockWaitForJob.mockResolvedValue({ status: "done", result: { song_id: "new-song" } });
      mockImportAuto.mockResolvedValue({ job_id: "job-1", detected: "web" });
    });

    it("sends a lone pasted link as a link", async () => {
      render(AddSheet);
      await fireEvent.input(screen.getByTestId("any-text"), {
        target: { value: " https://example.com/tab " },
      });
      await fireEvent.click(screen.getByTestId("any-submit"));

      await vi.waitFor(() =>
        expect(mockImportAuto).toHaveBeenCalledWith({ url: "https://example.com/tab" }),
      );
      await vi.waitFor(() => expect(ui.sheet).toBe(""));
    });

    it("hands a Songsterr link to the link form so the track picker can ask", async () => {
      mockPreviewImport.mockResolvedValue({ title: "Song", artist: "Band", tracks: [] });
      mockImportUrl.mockResolvedValue({ job_id: "job-9" });
      render(AddSheet);
      await fireEvent.input(screen.getByTestId("any-text"), {
        target: { value: "https://www.songsterr.com/a/wsa/band-song-tab-s123" },
      });
      await fireEvent.click(screen.getByTestId("any-submit"));

      await vi.waitFor(() => expect(mockPreviewImport).toHaveBeenCalled());
      expect(mockImportAuto).not.toHaveBeenCalled();
    });

    it("sends other pasted text as text", async () => {
      render(AddSheet);
      await fireEvent.input(screen.getByTestId("any-text"), { target: { value: TAB } });
      await fireEvent.click(screen.getByTestId("any-submit"));

      await vi.waitFor(() => expect(mockImportAuto).toHaveBeenCalledWith({ text: TAB }));
    });

    it("asks for something to add when the box is empty", async () => {
      render(AddSheet);
      await fireEvent.click(screen.getByTestId("any-submit"));

      expect(await screen.findByTestId("any-empty")).toBeInTheDocument();
      expect(mockImportAuto).not.toHaveBeenCalled();
    });

    it("sends a dropped or chosen file for the server to identify", async () => {
      render(AddSheet);
      const file = new File(["G  C\nHello"], "download", { type: "application/octet-stream" });
      await fireEvent.change(screen.getByTestId("any-file-input"), { target: { files: [file] } });

      await vi.waitFor(() => expect(mockImportAuto).toHaveBeenCalledWith({ file }));
    });

    it("asks which parts and instruments to use for a MIDI file, then imports them", async () => {
      mockInspectMidi.mockResolvedValue({
        title: "Riff",
        bpm: 100,
        signature: [4, 4],
        drum_notes: 0,
        tracks: [
          {
            id: "1:0",
            name: "Bass",
            channel: 1,
            program: 33,
            notes: 8,
            lowest: 28,
            highest: 43,
            in_range: true,
            suggested_preset: "bass-4",
            selected: true,
          },
        ],
      });
      mockImportMidi.mockResolvedValue({ job_id: "job-1" });
      mockWaitForJob.mockResolvedValue({
        status: "done",
        result: { song_id: "song-1", warnings: [] },
      });
      // Named like text: the header decides, not the name.
      const file = new File([new Uint8Array([77, 84, 104, 100, 0, 0, 0, 6])], "riff.txt");
      render(AddSheet);
      await fireEvent.change(screen.getByTestId("any-file-input"), { target: { files: [file] } });

      expect(await screen.findByTestId("midi-import")).toBeInTheDocument();
      expect(mockImportAuto).not.toHaveBeenCalled();
      await fireEvent.click(screen.getByTestId("midi-submit"));

      await vi.waitFor(() =>
        expect(mockImportMidi).toHaveBeenCalledWith(file, {
          tracks: ["1:0"],
          presets: { "1:0": "bass-4" },
          capo: 0,
          grid: 16,
        }),
      );
    });

    it("goes back to the Add box when a MIDI import is cancelled, and shows a read error", async () => {
      mockInspectMidi.mockRejectedValueOnce(new Error("This MIDI file could not be read."));
      const file = new File([new Uint8Array([77, 84, 104, 100, 0])], "bad.mid");
      render(AddSheet);
      await fireEvent.change(screen.getByTestId("any-file-input"), { target: { files: [file] } });
      expect(await screen.findByTestId("add-error")).toHaveTextContent("could not be read");

      mockInspectMidi.mockResolvedValueOnce({
        title: "",
        bpm: 120,
        signature: [4, 4],
        drum_notes: 0,
        tracks: [],
      });
      await fireEvent.change(screen.getByTestId("any-file-input"), { target: { files: [file] } });
      expect(await screen.findByTestId("midi-import")).toBeInTheDocument();
      await fireEvent.click(screen.getByText("Cancel"));
      expect(await screen.findByTestId("any-text")).toBeInTheDocument();
    });

    it("reads a Guitar Pro file in the browser even when it has no Guitar Pro name", async () => {
      // Not a valid score: the point is that it never goes to the server.
      const file = new File(["\x18FICHIER GUITAR PRO v5.00 junk"], "notes.txt");
      render(AddSheet);
      await fireEvent.change(screen.getByTestId("any-file-input"), { target: { files: [file] } });

      expect(await screen.findByTestId("add-error")).toBeInTheDocument();
      expect(mockImportAuto).not.toHaveBeenCalled();
    });

    it("shows the server's message when it cannot tell what was added", async () => {
      mockImportAuto.mockRejectedValue(new Error("Couldn't recognise this."));
      render(AddSheet);
      await fireEvent.input(screen.getByTestId("any-text"), { target: { value: "hello there" } });
      await fireEvent.click(screen.getByTestId("any-submit"));

      expect(await screen.findByTestId("add-error")).toHaveTextContent("Couldn't recognise this.");
    });
  });
});
