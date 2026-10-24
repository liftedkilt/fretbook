import { fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InstrumentPreset, Me } from "../lib/types";
import { ui } from "../lib/ui.svelte";
import SettingsSheet from "./SettingsSheet.svelte";

const mockSaveSettings = vi.fn();
const mockImportLibrary = vi.fn();
const mockWaitForJob = vi.fn();
const mockGetDemo = vi.fn();
const mockAddDemo = vi.fn();
const mockRemoveDemo = vi.fn();

vi.mock("../lib/api", () => ({
  saveSettings: (...args: unknown[]) => mockSaveSettings(...args),
  apiUrl: (p: string) => p,
  importLibrary: (...args: unknown[]) => mockImportLibrary(...args),
  waitForJob: (...args: unknown[]) => mockWaitForJob(...args),
  getDemo: () => mockGetDemo(),
  addDemo: () => mockAddDemo(),
  removeDemo: () => mockRemoveDemo(),
  listSongs: async () => ({
    items: [],
    total: 0,
    counts: { all: 0, bass: 0, electric: 0, acoustic: 0, chords: 0, favourites: 0 },
    next_cursor: null,
  }),
  listTags: async () => [],
  getFacets: async () => ({ keys: [], genres: [] }),
}));

const mockPresets: InstrumentPreset[] = [
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
  {
    id: "guitar-6",
    label_key: "instrument.guitar6",
    label: "6-string guitar",
    instrument: "guitar",
    name: "Standard Guitar",
    tuning_midi: [40, 45, 50, 55, 59, 64],
    string_count: 6,
    family: "guitar",
  },
];

describe("SettingsSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ui.sheet = "settings";
    ui.presets = [...mockPresets];
    ui.defaultInstrument = "bass-4";
    ui.me = null;
    ui.ytdlp = null;
    ui.theme = "system";
    ui.demoMode = false;
    mockGetDemo.mockResolvedValue({ songs: [], installed: 0 });
  });

  it("adds and removes the demo songs", async () => {
    mockAddDemo.mockResolvedValueOnce({ songs: [], installed: 3, changed: 3 });
    mockRemoveDemo.mockResolvedValueOnce({ songs: [], installed: 0, changed: 3 });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(SettingsSheet);

    await fireEvent.click(await screen.findByTestId("demo-add"));
    expect(await screen.findByText("Added 3 demo songs.")).toBeInTheDocument();
    await fireEvent.click(await screen.findByTestId("demo-remove"));
    expect(await screen.findByText("Removed 3 demo songs.")).toBeInTheDocument();
    expect(mockAddDemo).toHaveBeenCalledTimes(1);
    expect(mockRemoveDemo).toHaveBeenCalledTimes(1);
  });

  it("offers removal when the demo songs are already there, and not in demo mode", async () => {
    mockGetDemo.mockResolvedValue({ songs: [], installed: 3 });
    const { unmount } = render(SettingsSheet);
    expect(await screen.findByTestId("demo-remove")).toBeInTheDocument();
    unmount();

    ui.demoMode = true;
    render(SettingsSheet);
    expect(screen.queryByTestId("demo-settings")).not.toBeInTheDocument();
  });

  it("renders default instrument options and updates when changed", async () => {
    mockSaveSettings.mockResolvedValueOnce({ default_instrument: "guitar-6" });

    render(SettingsSheet);

    const instrumentSelect = screen.getByRole("combobox", { name: /default instrument/i });
    expect(instrumentSelect).toHaveValue("bass-4");

    await fireEvent.change(instrumentSelect, { target: { value: "guitar-6" } });

    expect(mockSaveSettings).toHaveBeenCalledWith({ default_instrument: "guitar-6" });
    expect(ui.defaultInstrument).toBe("guitar-6");
  });

  it("displays error when saving default instrument fails", async () => {
    mockSaveSettings.mockRejectedValueOnce(new Error("Network failure"));

    render(SettingsSheet);

    const instrumentSelect = screen.getByRole("combobox", { name: /default instrument/i });
    await fireEvent.change(instrumentSelect, { target: { value: "guitar-6" } });

    expect(mockSaveSettings).toHaveBeenCalledWith({ default_instrument: "guitar-6" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Network failure");
  });

  it("switches theme when theme buttons are clicked", async () => {
    render(SettingsSheet);

    const darkBtn = screen.getByRole("radio", { name: /dark/i });
    await fireEvent.click(darkBtn);
    expect(ui.theme).toBe("dark");

    const lightBtn = screen.getByRole("radio", { name: /light/i });
    await fireEvent.click(lightBtn);
    expect(ui.theme).toBe("light");
  });

  it("renders authenticated account details when user is signed in", () => {
    const me: Me = {
      user_id: "user-1",
      display_name: "Fret Master",
      email: "player@example.com",
      authenticated: true,
      role: "admin",
      settings: { default_instrument: "bass-4" },
    };
    ui.me = me;

    render(SettingsSheet);

    expect(screen.getByTestId("account-name")).toHaveTextContent("Fret Master");
    expect(screen.getByText(/player@example.com/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /users/i })).toBeInTheDocument();
    expect(screen.getByTestId("sign-out")).toBeInTheDocument();
  });

  it("offers a library download and hides the export-everything link from non-admins", () => {
    render(SettingsSheet);

    expect(screen.getByTestId("backup-export")).toHaveAttribute("href", "/api/library/export");
    expect(screen.queryByTestId("backup-export-all")).not.toBeInTheDocument();
  });

  it("shows the export-everything link to admins", () => {
    ui.me = {
      user_id: "u",
      display_name: "Root",
      email: "root@example.com",
      authenticated: true,
      role: "admin",
      settings: { default_instrument: "bass-4" },
    };

    render(SettingsSheet);

    expect(screen.getByTestId("backup-export-all")).toHaveAttribute(
      "href",
      "/api/admin/library/export",
    );
  });

  it("restores a backup with the chosen duplicate mode and reports the result", async () => {
    mockImportLibrary.mockResolvedValueOnce({ job_id: "j1" });
    mockWaitForJob.mockResolvedValueOnce({
      status: "done",
      result: { imported: 3, skipped: 1, copied: 0, failed: 0, warnings: [] },
    });
    render(SettingsSheet);

    await fireEvent.click(screen.getByRole("radio", { name: /keep both/i }));
    const file = new File(["zip"], "lib.zip", { type: "application/zip" });
    await fireEvent.change(screen.getByTestId("backup-file"), { target: { files: [file] } });

    expect(mockImportLibrary).toHaveBeenCalledWith(file, "copy");
    expect(await screen.findByTestId("backup-summary")).toHaveTextContent(
      "Added 3, skipped 1, kept 0 as copies, 0 failed.",
    );
  });

  it("shows the server's message when a restore is refused", async () => {
    mockImportLibrary.mockRejectedValueOnce(new Error("That file is not a Fretbook backup."));
    render(SettingsSheet);

    const file = new File(["nope"], "x.zip");
    await fireEvent.change(screen.getByTestId("backup-file"), { target: { files: [file] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("not a Fretbook backup");
  });

  it("renders calibration section and opens calibration sheet on button click", async () => {
    render(SettingsSheet);

    expect(screen.getByTestId("calibration-setting")).toBeInTheDocument();
    expect(screen.getByTestId("settings-offset-slider")).toBeInTheDocument();

    const openBtn = screen.getByTestId("open-calibration");
    await fireEvent.click(openBtn);

    expect(ui.sheet).toBe("calibration");
  });
});
