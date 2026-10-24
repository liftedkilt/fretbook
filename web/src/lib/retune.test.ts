import { describe, expect, it } from "vitest";
import type { ConvertReport } from "./api-types";
import {
  buildConvertBody,
  clamp,
  defaultChoices,
  isNoChange,
  presetsFor,
  reportLines,
  showsCapo,
  showsSemitones,
  showsTuning,
  type RetuneChoices,
} from "./retune";
import type { InstrumentPreset, Track } from "./types";

const track: Track = {
  id: "t1",
  name: "Guitar",
  instrument: "guitar",
  capo: 0,
  tuning_midi: [64, 59, 55, 50, 45, 40],
  preferred: true,
  bars: [],
};

function preset(id: string, family: "bass" | "guitar", tuning: number[]): InstrumentPreset {
  return {
    id,
    label_key: `instrument.${id}`,
    label: id,
    instrument: family === "bass" ? "bass-guitar" : "guitar",
    name: id,
    tuning_midi: tuning,
    string_count: tuning.length,
    family,
  };
}

const presets = [
  preset("bass-4", "bass", [43, 38, 33, 28]),
  preset("bass-5", "bass", [43, 38, 33, 28, 23]),
  preset("guitar-6", "guitar", [64, 59, 55, 50, 45, 40]),
  preset("guitar-7", "guitar", [64, 59, 55, 50, 45, 40, 35]),
];

function choose(over: Partial<RetuneChoices>): RetuneChoices {
  return { ...defaultChoices("transpose", track, presets), ...over };
}

describe("choices", () => {
  it("start from the track's own tuning and capo", () => {
    expect(defaultChoices("retune", track, presets)).toEqual({
      goal: "retune",
      semitones: 0,
      tuning: "E4 B3 G3 D3 A2 E2",
      capo: 0,
      preset: "",
    });
  });

  it("start a bass line an octave down on a 4-string bass", () => {
    const choices = defaultChoices("bassLine", track, presets);
    expect(choices.semitones).toBe(-12);
    expect(choices.preset).toBe("bass-4");
    expect(choices.tuning).toBe("G2 D2 A1 E1");
  });

  it("offer only the presets that fit the goal", () => {
    expect(presetsFor("shapes", track, presets).map((item) => item.id)).toEqual(["guitar-6"]);
    expect(presetsFor("bassLine", track, presets).map((item) => item.id)).toEqual([
      "bass-4",
      "bass-5",
    ]);
    expect(presetsFor("convert", track, presets)).toHaveLength(4);
  });

  it("show only the fields a goal uses", () => {
    expect([showsSemitones("transpose"), showsTuning("transpose"), showsCapo("transpose")]).toEqual(
      [true, false, false],
    );
    expect([showsSemitones("retune"), showsTuning("retune"), showsCapo("retune")]).toEqual([
      false,
      true,
      true,
    ]);
    expect(showsCapo("shapes")).toBe(true);
    expect(showsTuning("bassLine")).toBe(true);
  });

  it("clamp to whole numbers in range", () => {
    expect(clamp(99, -48, 48)).toBe(48);
    expect(clamp(-3.4, -48, 48)).toBe(-3);
    expect(clamp(Number.NaN, 0, 24)).toBe(0);
  });
});

describe("buildConvertBody", () => {
  it("transposes by semitones and leaves the tuning alone", () => {
    const body = buildConvertBody(track, choose({ semitones: 2 }));
    expect(body).toEqual({
      track_id: "t1",
      mode: "preview",
      semitones: 2,
      keep: "pitch",
      reduce: "all",
    });
    expect(isNoChange(body!)).toBe(false);
  });

  it("is a no-change when nothing was asked", () => {
    expect(isNoChange(buildConvertBody(track, choose({}))!)).toBe(true);
    expect(isNoChange(buildConvertBody(track, choose({ goal: "retune" }))!)).toBe(true);
  });

  it("sends a changed tuning, and a changed capo only where capos apply", () => {
    const body = buildConvertBody(
      track,
      choose({ goal: "retune", tuning: "E4 B3 G3 D3 A2 D2", capo: 2 }),
    );
    expect(body?.tuning_midi).toEqual([64, 59, 55, 50, 45, 38]);
    expect(body?.capo).toBe(2);
    expect(buildConvertBody(track, choose({ goal: "transpose", capo: 5 }))?.capo).toBeUndefined();
  });

  it("keeps shapes with the same string count only", () => {
    const body = buildConvertBody(
      track,
      choose({ goal: "shapes", tuning: "Eb4 Bb3 Gb3 Db3 Ab2 Eb2" }),
    );
    expect(body?.keep).toBe("shape");
    expect(body?.tuning_midi).toEqual([63, 58, 54, 49, 44, 39]);
    expect(buildConvertBody(track, choose({ goal: "shapes", tuning: "G2 D2 A1 E1" }))).toBeNull();
  });

  it("asks for the lowest notes for a bass line and passes the preset", () => {
    const body = buildConvertBody(track, defaultChoices("bassLine", track, presets));
    expect(body?.reduce).toBe("lowest");
    expect(body?.preset).toBe("bass-4");
    expect(body?.semitones).toBe(-12);
    expect(body?.tuning_midi).toEqual([43, 38, 33, 28]);
  });

  it("is null while the tuning cannot be read", () => {
    expect(buildConvertBody(track, choose({ goal: "retune", tuning: "H9 ??" }))).toBeNull();
    expect(buildConvertBody(track, choose({ goal: "retune", tuning: "" }))).toBeNull();
  });

  it("passes the save mode, revision and name through", () => {
    const body = buildConvertBody(track, choose({ semitones: 1 }), {
      mode: "add",
      revision: 4,
      name: "Up one",
    });
    expect(body).toMatchObject({ mode: "add", revision: 4, name: "Up one" });
  });
});

describe("reportLines", () => {
  const base: ConvertReport = {
    notes: 12,
    refretted: 9,
    reduced: 0,
    shifted_bars: [],
    dropped_bars: [],
    dropped: 0,
    techniques_dropped: 0,
  };

  it("always says how many notes moved", () => {
    expect(reportLines(base)).toEqual([
      { key: "retune.reportMoved", params: { moved: 9, notes: 12 } },
    ]);
  });

  it("adds a line for each thing that had to give", () => {
    const lines = reportLines({
      ...base,
      reduced: 5,
      shifted_bars: [2, 4],
      dropped: 1,
      dropped_bars: [7],
      techniques_dropped: 2,
    });
    expect(lines.map((line) => line.key)).toEqual([
      "retune.reportMoved",
      "retune.reportReduced",
      "retune.reportShifted",
      "retune.reportDropped",
      "retune.reportHarmonics",
    ]);
    expect(lines[2].params).toEqual({ bars: "2, 4" });
    expect(lines[3].params).toEqual({ count: 1, bars: "7" });
  });
});
