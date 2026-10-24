import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type { MidiInspection } from "../lib/api-types";
import type { InstrumentPreset } from "../lib/types";
import MidiImport from "./MidiImport.svelte";

const presets = [
  { id: "bass-4", label_key: "instrument.bass4", label: "4-string bass" },
  { id: "guitar-6", label_key: "instrument.guitar6", label: "6-string guitar" },
] as InstrumentPreset[];

function part(id: string, name: string, selected: boolean, preset: string, in_range = true) {
  return {
    id,
    name,
    channel: 1,
    program: null,
    notes: 12,
    lowest: 40,
    highest: 64,
    in_range,
    suggested_preset: preset,
    selected,
  };
}

const info: MidiInspection = {
  title: "Riff",
  bpm: 100,
  signature: [4, 4],
  drum_notes: 3,
  tracks: [part("1:0", "Lead", true, "guitar-6"), part("2:1", "Bass", true, "bass-4", false)],
};

function mount(overrides: Partial<{ info: MidiInspection; busy: boolean }> = {}) {
  const onimport = vi.fn();
  const oncancel = vi.fn();
  render(MidiImport, { info, presets, busy: false, onimport, oncancel, ...overrides });
  return { onimport, oncancel };
}

describe("MidiImport", () => {
  it("lists the parts with the server's choices and imports them as suggested", async () => {
    const { onimport } = mount();
    expect(screen.getByTestId("midi-part-1:0")).toBeTruthy();
    expect(screen.getByTestId("midi-part-2:1").textContent).toContain("12 notes");
    expect(screen.getByText("Drum parts are skipped.")).toBeTruthy();
    await fireEvent.click(screen.getByTestId("midi-submit"));
    expect(onimport).toHaveBeenCalledWith({
      tracks: ["1:0", "2:1"],
      presets: { "1:0": "guitar-6", "2:1": "bass-4" },
      capo: 0,
      grid: 16,
    });
  });

  it("sends only the parts that stay ticked, with the instrument, capo and grid picked", async () => {
    const { onimport } = mount();
    await fireEvent.click(screen.getByLabelText("Bass"));
    await fireEvent.change(screen.getByTestId("midi-preset-1:0"), { target: { value: "bass-4" } });
    await fireEvent.change(screen.getByTestId("midi-grid"), { target: { value: "8" } });
    await fireEvent.change(screen.getByTestId("midi-capo"), { target: { value: "30" } });
    expect((screen.getByTestId("midi-capo") as HTMLInputElement).value).toBe("24");
    await fireEvent.click(screen.getByTestId("midi-submit"));
    expect(onimport).toHaveBeenCalledWith({
      tracks: ["1:0"],
      presets: { "1:0": "bass-4" },
      capo: 24,
      grid: 8,
    });
  });

  it("cannot import with nothing ticked, or while busy, and can be cancelled", async () => {
    const { oncancel } = mount();
    await fireEvent.click(screen.getByLabelText("Lead"));
    await fireEvent.click(screen.getByLabelText("Bass"));
    expect((screen.getByTestId("midi-submit") as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(screen.getByText("Cancel"));
    expect(oncancel).toHaveBeenCalled();
  });

  it("says so when the file has no parts", () => {
    mount({ info: { ...info, tracks: [], drum_notes: 0 } });
    expect(screen.getByTestId("midi-empty")).toBeTruthy();
    expect((screen.getByTestId("midi-submit") as HTMLButtonElement).disabled).toBe(true);
  });
});
