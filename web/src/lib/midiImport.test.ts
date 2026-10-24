import { describe, expect, it } from "vitest";
import type { MidiInspection } from "./api-types";
import {
  buildOptions,
  clampCapo,
  initialChoices,
  isMidiFile,
  rangeLabel,
  toggleTrack,
} from "./midiImport";

const info: MidiInspection = {
  title: "Riff",
  bpm: 100,
  signature: [4, 4],
  drum_notes: 0,
  tracks: [
    track("1:0", true, "guitar-6"),
    track("2:1", false, "guitar-6"),
    track("3:2", true, "bass-4"),
  ],
};

function track(id: string, selected: boolean, suggested_preset: string) {
  return {
    id,
    name: id,
    channel: 1,
    program: null,
    notes: 4,
    lowest: 40,
    highest: 64,
    in_range: true,
    suggested_preset,
    selected,
  };
}

describe("isMidiFile", () => {
  it("reads the header, not the name", async () => {
    expect(await isMidiFile(new File([new Uint8Array([77, 84, 104, 100, 0])], "x.txt"))).toBe(true);
    expect(await isMidiFile(new File(["MThx"], "x.mid"))).toBe(false);
    expect(await isMidiFile(new File(["MT"], "x.mid"))).toBe(false);
  });
});

describe("choices", () => {
  it("starts from the server's selection and suggested instruments", () => {
    expect(initialChoices(info)).toEqual({
      selected: ["1:0", "3:2"],
      presets: { "1:0": "guitar-6", "2:1": "guitar-6", "3:2": "bass-4" },
    });
  });

  it("toggles a part on and off without duplicates", () => {
    expect(toggleTrack(["1:0"], "2:1", true)).toEqual(["1:0", "2:1"]);
    expect(toggleTrack(["1:0", "2:1"], "1:0", false)).toEqual(["2:1"]);
    expect(toggleTrack(["1:0"], "1:0", true)).toEqual(["1:0"]);
  });
});

describe("buildOptions", () => {
  it("keeps the file's order and only the chosen parts' instruments", () => {
    const choices = { selected: ["3:2", "1:0"], presets: initialChoices(info).presets };
    expect(buildOptions(info, choices, 2, 8)).toEqual({
      tracks: ["1:0", "3:2"],
      presets: { "1:0": "guitar-6", "3:2": "bass-4" },
      capo: 2,
      grid: 8,
    });
  });

  it("clamps the capo", () => {
    expect(clampCapo(-3)).toBe(0);
    expect(clampCapo(99)).toBe(24);
    expect(clampCapo(2.6)).toBe(3);
    expect(clampCapo(Number.NaN)).toBe(0);
  });
});

describe("rangeLabel", () => {
  it("names the lowest and highest pitch", () => {
    expect(rangeLabel({ lowest: 40, highest: 64 })).toBe("E2–E4");
  });
});
