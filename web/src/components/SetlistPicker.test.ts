import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SetlistPicker from "./SetlistPicker.svelte";

const mockListSetlists = vi.fn();
const mockAddSetlistEntry = vi.fn();
const mockCreateSetlist = vi.fn();

vi.mock("../lib/api", () => ({
  listSetlists: () => mockListSetlists(),
  addSetlistEntry: (...args: unknown[]) => mockAddSetlistEntry(...args),
  createSetlist: (...args: unknown[]) => mockCreateSetlist(...args),
}));

const song = { id: "s1", title: "Riff" };
const summary = (id: string, name: string) => ({ id, name, entry_count: 0 });

describe("SetlistPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.open = true;
    };
    mockListSetlists.mockResolvedValue([summary("l1", "Friday gig"), summary("l2", "Rehearsal")]);
  });

  it("lists the setlists and adds the song to the one chosen", async () => {
    mockAddSetlistEntry.mockResolvedValue({});
    render(SetlistPicker, { song, onclose: vi.fn() });
    const items = await screen.findAllByTestId("setlist-picker-item");
    expect(items).toHaveLength(2);
    await fireEvent.click(items[1]);
    expect(mockAddSetlistEntry).toHaveBeenCalledWith("l2", "s1");
    expect(await screen.findByTestId("setlist-picker-done")).toHaveTextContent(
      "Added Riff to Rehearsal.",
    );
  });

  it("creates a new setlist and adds the song to it", async () => {
    mockListSetlists.mockResolvedValue([]);
    mockCreateSetlist.mockResolvedValue({ id: "l3", name: "Set three" });
    mockAddSetlistEntry.mockResolvedValue({});
    render(SetlistPicker, { song, onclose: vi.fn() });
    expect(await screen.findByTestId("setlist-picker-empty")).toBeInTheDocument();
    await fireEvent.input(screen.getByTestId("setlist-picker-name"), {
      target: { value: "  Set three " },
    });
    await fireEvent.click(screen.getByTestId("setlist-picker-create"));
    await waitFor(() => expect(mockAddSetlistEntry).toHaveBeenCalledWith("l3", "s1"));
    expect(mockCreateSetlist).toHaveBeenCalledWith("Set three");
    expect(await screen.findByTestId("setlist-picker-done")).toBeInTheDocument();
  });

  it("shows the error when adding fails", async () => {
    mockAddSetlistEntry.mockRejectedValue(new Error("Setlist is full"));
    render(SetlistPicker, { song, onclose: vi.fn() });
    await fireEvent.click((await screen.findAllByTestId("setlist-picker-item"))[0]);
    expect(await screen.findByRole("alert")).toHaveTextContent("Setlist is full");
  });
});
