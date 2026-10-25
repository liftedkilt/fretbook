import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SongDetail } from "../lib/types";
import { ui } from "../lib/ui.svelte";
import SongMetadata from "./SongMetadata.svelte";

const mockUpdate = vi.fn();
const mockUpload = vi.fn();
const mockDelete = vi.fn();
const mockLookup = vi.fn();

vi.mock("../lib/api", () => ({
  updateSongMetadata: (...args: unknown[]) => mockUpdate(...args),
  uploadCover: (...args: unknown[]) => mockUpload(...args),
  deleteCover: (...args: unknown[]) => mockDelete(...args),
  lookupMetadata: (...args: unknown[]) => mockLookup(...args),
  listSongs: vi.fn().mockResolvedValue({
    items: [],
    total: 0,
    next_cursor: null,
    counts: { all: 0, bass: 0, electric: 0, acoustic: 0, chords: 0, favourites: 0 },
  }),
  listTags: vi.fn().mockResolvedValue([]),
  getFacets: vi.fn().mockResolvedValue({ keys: [], genres: [] }),
}));

function makeSong(overrides: Partial<SongDetail> = {}): SongDetail {
  return {
    id: "s1",
    title: "Riff",
    content_kind: "tab",
    key: null,
    key_detected: false,
    genre: "",
    album: "",
    year: null,
    cover_url: null,
    notes: "",
    ...overrides,
  } as unknown as SongDetail;
}

describe("SongMetadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ui.demoMode = false;
    ui.lookupEnabled = false;
  });

  it("has no form when the song is locked", () => {
    ui.demoMode = true;
    render(SongMetadata, { open: true, song: makeSong(), onchange: vi.fn() });
    expect(screen.queryByTestId("metadata-save")).toBeNull();
  });

  it("saves the form and hands the saved song to the page", async () => {
    const saved = makeSong({ key: "Am", genre: "Rock", year: 1980 });
    mockUpdate.mockResolvedValue(saved);
    const onchange = vi.fn();
    render(SongMetadata, {
      open: true,
      song: makeSong({ key: "C", key_detected: true }),
      onchange,
    });

    // A detected key is the "automatic" choice, not a chosen one.
    expect(screen.getByTestId("metadata-key")).toHaveValue("");
    await fireEvent.change(screen.getByTestId("metadata-key"), { target: { value: "Am" } });
    await fireEvent.input(screen.getByTestId("metadata-genre"), { target: { value: "Rock" } });
    await fireEvent.input(screen.getByTestId("metadata-year"), { target: { value: "1980" } });
    await fireEvent.input(screen.getByTestId("metadata-notes"), { target: { value: "hi" } });
    await fireEvent.click(screen.getByTestId("metadata-save"));

    await waitFor(() => expect(onchange).toHaveBeenCalledWith(saved));
    expect(mockUpdate).toHaveBeenCalledWith("s1", {
      key: "Am",
      genre: "Rock",
      album: "",
      year: 1980,
      notes: "hi",
    });
  });

  it("refuses a year that is not four digits before asking the server", async () => {
    render(SongMetadata, { open: true, song: makeSong(), onchange: vi.fn() });
    await fireEvent.input(screen.getByTestId("metadata-year"), { target: { value: "99" } });
    await fireEvent.click(screen.getByTestId("metadata-save"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("clears an empty year and shows a server error", async () => {
    mockUpdate.mockRejectedValue(new Error("nope"));
    render(SongMetadata, { open: true, song: makeSong({ year: 1999 }), onchange: vi.fn() });
    await fireEvent.input(screen.getByTestId("metadata-year"), { target: { value: "" } });
    await fireEvent.click(screen.getByTestId("metadata-save"));
    expect(await screen.findByRole("alert")).toHaveTextContent("nope");
    expect(mockUpdate).toHaveBeenCalledWith("s1", expect.objectContaining({ year: null }));
  });

  it("uploads and removes a cover", async () => {
    const withCover = makeSong({ cover_url: "api/songs/s1/cover?v=1" });
    mockUpload.mockResolvedValue(withCover);
    mockDelete.mockResolvedValue(makeSong());
    const onchange = vi.fn();
    const { rerender } = render(SongMetadata, { open: true, song: makeSong(), onchange });
    expect(screen.queryByTestId("metadata-cover-remove")).toBeNull();

    const file = new File(["x"], "c.png", { type: "image/png" });
    await fireEvent.change(screen.getByTestId("metadata-cover-input"), {
      target: { files: [file] },
    });
    await waitFor(() => expect(onchange).toHaveBeenCalledWith(withCover));
    expect(mockUpload).toHaveBeenCalledWith("s1", file);

    await rerender({ song: withCover, onchange });
    await fireEvent.click(screen.getByTestId("metadata-cover-remove"));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("s1"));
  });

  it("offers the online lookup only when the server allows it, and fills empty fields", async () => {
    render(SongMetadata, { open: true, song: makeSong(), onchange: vi.fn() });
    expect(screen.queryByTestId("metadata-lookup")).toBeNull();
  });

  it("looks the song up and fills the empty album and year", async () => {
    ui.lookupEnabled = true;
    mockLookup.mockResolvedValue(makeSong({ album: "The Album", year: 1971 }));
    render(SongMetadata, { open: true, song: makeSong(), onchange: vi.fn() });
    await fireEvent.click(screen.getByTestId("metadata-lookup"));
    await waitFor(() => expect(screen.getByTestId("metadata-album")).toHaveValue("The Album"));
    expect(screen.getByTestId("metadata-year")).toHaveValue("1971");
    expect(screen.getByTestId("metadata-notice")).toBeInTheDocument();
  });
});
