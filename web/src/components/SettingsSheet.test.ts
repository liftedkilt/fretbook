import { fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InstrumentPreset, Me } from "../lib/types";
import { ui } from "../lib/ui.svelte";
import SettingsSheet from "./SettingsSheet.svelte";

const mockSaveSettings = vi.fn();

vi.mock("../lib/api", () => ({
  saveSettings: (...args: unknown[]) => mockSaveSettings(...args),
  apiUrl: (p: string) => p,
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
});
