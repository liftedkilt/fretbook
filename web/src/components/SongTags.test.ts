import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ui } from "../lib/ui.svelte";
import SongTags from "./SongTags.svelte";

vi.mock("../lib/api", () => ({
  listTags: vi.fn().mockResolvedValue([]),
  getFacets: vi.fn().mockResolvedValue({ keys: [], genres: [] }),
}));

describe("SongTags", () => {
  beforeEach(() => {
    ui.tagList = [
      { tag: "funk", count: 2 },
      { tag: "Live", count: 1 },
    ];
  });

  it("shows the song's tags as chips", () => {
    render(SongTags, { tags: ["funk"], onadd: vi.fn(), onremove: vi.fn() });
    expect(screen.getAllByTestId("song-tag")).toHaveLength(1);
    expect(screen.getByTestId("song-tag")).toHaveTextContent("funk");
  });

  it("opens an input from the + Tag chip and adds a trimmed tag", async () => {
    const onadd = vi.fn();
    render(SongTags, { tags: ["funk"], onadd, onremove: vi.fn() });
    expect(screen.queryByTestId("song-tag-input")).toBeNull();

    await fireEvent.click(screen.getByTestId("song-tag-new"));
    const input = screen.getByTestId("song-tag-input");
    await waitFor(() => expect(input).toHaveFocus());
    await fireEvent.input(input, { target: { value: " Warm up " } });
    await fireEvent.submit(input.closest("form") as HTMLFormElement);

    await waitFor(() => expect(onadd).toHaveBeenCalledWith("Warm up"));
    expect(input).toHaveValue("");
  });

  it("closes the input with Escape", async () => {
    render(SongTags, { tags: [], onadd: vi.fn(), onremove: vi.fn() });
    await fireEvent.click(screen.getByTestId("song-tag-new"));
    await fireEvent.keyDown(screen.getByTestId("song-tag-input"), { key: "Escape" });
    expect(screen.queryByTestId("song-tag-input")).toBeNull();
    expect(screen.getByTestId("song-tag-new")).toBeInTheDocument();
  });

  it("removes a tag", async () => {
    const onremove = vi.fn();
    render(SongTags, { tags: ["funk"], onadd: vi.fn(), onremove });
    await fireEvent.click(screen.getByTestId("song-tag-remove"));
    expect(onremove).toHaveBeenCalledWith("funk");
  });

  it("suggests library tags the song does not have yet", async () => {
    const { container } = render(SongTags, { tags: ["funk"], onadd: vi.fn(), onremove: vi.fn() });
    await fireEvent.click(screen.getByTestId("song-tag-new"));
    const options = [...container.querySelectorAll("datalist option")].map(
      (option) => (option as HTMLOptionElement).value,
    );
    expect(options).toEqual(["Live"]);
  });

  it("is read only when locked, and empty when there is nothing to show", () => {
    const { unmount } = render(SongTags, {
      tags: ["funk"],
      locked: true,
      onadd: vi.fn(),
      onremove: vi.fn(),
    });
    expect(screen.getByTestId("song-tag")).toBeInTheDocument();
    expect(screen.queryByTestId("song-tag-new")).toBeNull();
    expect(screen.queryByTestId("song-tag-remove")).toBeNull();
    unmount();
    render(SongTags, { tags: [], locked: true, onadd: vi.fn(), onremove: vi.fn() });
    expect(screen.queryByTestId("song-tags")).toBeNull();
  });
});
