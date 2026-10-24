import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SongDetail } from "../lib/types";
import { ui } from "../lib/ui.svelte";
import SongTags from "./SongTags.svelte";

const mockSetSongTags = vi.fn();
const mockSetFavourite = vi.fn();
const mockListSongs = vi.fn();

vi.mock("../lib/api", () => ({
  setSongTags: (...args: unknown[]) => mockSetSongTags(...args),
  setFavourite: (...args: unknown[]) => mockSetFavourite(...args),
  listSongs: (...args: unknown[]) => mockListSongs(...args),
  listTags: vi.fn().mockResolvedValue([]),
  getFacets: vi.fn().mockResolvedValue({ keys: [], genres: [] }),
}));

const song = {
  id: "s1",
  title: "Riff",
  favourite: false,
  difficulty: null,
  tags: ["funk"],
} as unknown as SongDetail;

describe("SongTags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListSongs.mockResolvedValue({
      items: [],
      total: 0,
      next_cursor: null,
      counts: { all: 0, bass: 0, electric: 0, acoustic: 0, chords: 0, favourites: 0 },
    });
    ui.tagList = [
      { tag: "funk", count: 2 },
      { tag: "Live", count: 1 },
    ];
  });

  it("shows the song's tags", () => {
    render(SongTags, { song });
    expect(screen.getAllByTestId("song-tag")).toHaveLength(1);
    expect(screen.getByTestId("song-tag")).toHaveTextContent("funk");
  });

  it("adds a tag and shows what the server stored", async () => {
    mockSetSongTags.mockResolvedValue(["funk", "Warm up"]);
    render(SongTags, { song });

    await fireEvent.input(screen.getByTestId("song-tag-input"), { target: { value: " Warm up " } });
    await fireEvent.submit(screen.getByTestId("song-tag-input").closest("form") as HTMLFormElement);

    await waitFor(() => expect(mockSetSongTags).toHaveBeenCalledWith("s1", ["funk", "Warm up"]));
    await waitFor(() => expect(screen.getAllByTestId("song-tag")).toHaveLength(2));
    expect(screen.getByTestId("song-tag-input")).toHaveValue("");
  });

  it("removes a tag", async () => {
    mockSetSongTags.mockResolvedValue([]);
    render(SongTags, { song });

    await fireEvent.click(screen.getByTestId("song-tag-remove"));
    await waitFor(() => expect(mockSetSongTags).toHaveBeenCalledWith("s1", []));
    await waitFor(() => expect(screen.queryAllByTestId("song-tag")).toHaveLength(0));
  });

  it("suggests library tags the song does not have yet", () => {
    const { container } = render(SongTags, { song });
    const options = [...container.querySelectorAll("datalist option")].map(
      (option) => (option as HTMLOptionElement).value,
    );
    expect(options).toEqual(["Live"]);
  });

  it("stars and unstars the song", async () => {
    mockSetFavourite.mockResolvedValue(true);
    render(SongTags, { song });

    const star = screen.getByTestId("song-favourite");
    expect(star).toHaveAttribute("aria-pressed", "false");
    await fireEvent.click(star);
    await waitFor(() => expect(star).toHaveAttribute("aria-pressed", "true"));
    expect(mockSetFavourite).toHaveBeenCalledWith("s1", true);
  });

  it("explains a failed save", async () => {
    mockSetSongTags.mockRejectedValue(new Error("nope"));
    render(SongTags, { song });

    await fireEvent.click(screen.getByTestId("song-tag-remove"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("nope"));
  });
});
