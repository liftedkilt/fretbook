import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FirstRun from "./FirstRun.svelte";
import { ui } from "../lib/ui.svelte";

const mockAddDemo = vi.fn();
const mockSaveSettings = vi.fn();
const mockListSongs = vi.fn();

vi.mock("../lib/api", () => ({
  addDemo: () => mockAddDemo(),
  saveSettings: (...args: unknown[]) => mockSaveSettings(...args),
  listSongs: (...args: unknown[]) => mockListSongs(...args),
  listTags: async () => [],
  getFacets: async () => ({ keys: [], genres: [] }),
  // Reaching the network from a component test is a bug.
  getMeta: vi.fn(),
  getMe: vi.fn(),
}));

const presets = [
  { id: "bass-4", label_key: "x", label: "4-string bass", family: "bass" },
  { id: "guitar-6", label_key: "y", label: "6-string guitar", family: "guitar" },
];

describe("FirstRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ui.presets = presets as typeof ui.presets;
    ui.defaultInstrument = "bass-4";
    ui.sheet = "";
    mockListSongs.mockResolvedValue({
      items: [],
      total: 0,
      counts: { all: 0, bass: 0, electric: 0, acoustic: 0, chords: 0, favourites: 0 },
      next_cursor: null,
    });
  });

  it("opens the add sheet and the tuner", async () => {
    render(FirstRun);
    await fireEvent.click(screen.getByRole("button", { name: "New" }));
    expect(ui.sheet).toBe("add");
    await fireEvent.click(screen.getByRole("button", { name: "Open the tuner" }));
    expect(ui.sheet).toBe("tuner");
  });

  it("adds the demo songs and reloads the library", async () => {
    mockAddDemo.mockResolvedValue({ songs: [], installed: 3, changed: 3 });
    render(FirstRun);
    await fireEvent.click(screen.getByTestId("first-run-add-demo"));
    await waitFor(() => expect(mockListSongs).toHaveBeenCalled());
    expect(mockAddDemo).toHaveBeenCalledTimes(1);
  });

  it("shows the error when the demo songs cannot be added", async () => {
    mockAddDemo.mockRejectedValue(new Error("boom"));
    render(FirstRun);
    await fireEvent.click(screen.getByTestId("first-run-add-demo"));
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
    expect(screen.getByTestId("first-run-add-demo")).toBeEnabled();
  });

  it("saves the instrument and points the course at it", async () => {
    mockSaveSettings.mockResolvedValue({ default_instrument: "guitar-6" });
    render(FirstRun);
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      expect.stringMatching(/bass-first-steps$/),
    );
    await fireEvent.change(screen.getByRole("combobox"), { target: { value: "guitar-6" } });
    await waitFor(() =>
      expect(mockSaveSettings).toHaveBeenCalledWith({ default_instrument: "guitar-6" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("link")).toHaveAttribute(
        "href",
        expect.stringMatching(/guitar-first-steps$/),
      ),
    );
  });
});
