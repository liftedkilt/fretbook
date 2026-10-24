/**
 * The transpose / retune / convert dialog's logic. The server does the conversion (`POST /api/songs/{id}/convert`);
 * this turns the reader's choices into that request and the response into words.
 */
import type { ConvertBody, ConvertReport } from "./api-types";
import type { InstrumentPreset, Track } from "./types";
import { parseCustomTuning, tuningLabel } from "./tuning";

export const RETUNE_GOALS = ["transpose", "retune", "shapes", "convert", "bassLine"] as const;
export type RetuneGoal = (typeof RETUNE_GOALS)[number];

export const MAX_SEMITONES = 48;
export const MAX_CAPO = 24;

export interface RetuneChoices {
  goal: RetuneGoal;
  semitones: number;
  /** Open-string pitches as the reader typed them ("E4 B3 G3 D3 A2 D2"); empty keeps the track's tuning. */
  tuning: string;
  capo: number;
  /** The instrument preset the tuning came from, or "" for a custom or unchanged tuning. */
  preset: string;
}

export function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, Math.round(value)));
}

/** Choices for a goal, starting from the track as it is. Bass lines start an octave down, as a bass sounds. */
export function defaultChoices(
  goal: RetuneGoal,
  track: Track,
  presets: InstrumentPreset[],
): RetuneChoices {
  const base = {
    goal,
    semitones: 0,
    tuning: tuningLabel(track.tuning_midi),
    capo: track.capo,
    preset: "",
  };
  if (goal === "bassLine") {
    const bass = presets.find((item) => item.family === "bass");
    return {
      ...base,
      semitones: -12,
      tuning: bass ? tuningLabel(bass.tuning_midi) : base.tuning,
      preset: bass?.id ?? "",
    };
  }
  return base;
}

/** The presets that make sense for a goal: shapes keep the string count, a bass line needs a bass. */
export function presetsFor(
  goal: RetuneGoal,
  track: Track,
  presets: InstrumentPreset[],
): InstrumentPreset[] {
  if (goal === "shapes")
    return presets.filter((item) => item.string_count === track.tuning_midi.length);
  if (goal === "bassLine") return presets.filter((item) => item.family === "bass");
  return presets;
}

export function showsSemitones(goal: RetuneGoal): boolean {
  return goal !== "retune";
}

export function showsTuning(goal: RetuneGoal): boolean {
  return goal !== "transpose";
}

export function showsCapo(goal: RetuneGoal): boolean {
  return goal === "retune" || goal === "shapes";
}

/** The tuning typed in the dialog, `null` when it is not valid. An unchanged tuning is valid and returned as is. */
export function parseTuning(text: string): number[] | null {
  return parseCustomTuning(text);
}

/**
 * The convert request for the choices, or `null` while they are not valid (an unreadable tuning, or one with a
 * different string count when the shapes are kept). A tuning equal to the track's is left out so the server
 * keeps the track as it is.
 */
export function buildConvertBody(
  track: Track,
  choices: RetuneChoices,
  extra: Pick<ConvertBody, "mode" | "revision" | "name"> = { mode: "preview" },
): ConvertBody | null {
  const body: ConvertBody = {
    track_id: track.id,
    semitones: 0,
    keep: "pitch",
    reduce: "all",
    ...extra,
  };
  if (showsSemitones(choices.goal)) {
    body.semitones = clamp(choices.semitones, -MAX_SEMITONES, MAX_SEMITONES);
  }
  if (showsTuning(choices.goal)) {
    const tuning = parseTuning(choices.tuning);
    if (!tuning || tuning.length > 16) return null;
    if (tuning.join() !== track.tuning_midi.join()) {
      if (choices.goal === "shapes" && tuning.length !== track.tuning_midi.length) return null;
      body.tuning_midi = tuning;
    }
    if (choices.preset) body.preset = choices.preset;
  }
  if (showsCapo(choices.goal) && choices.capo !== track.capo) {
    body.capo = clamp(choices.capo, 0, MAX_CAPO);
  }
  if (choices.goal === "shapes") body.keep = "shape";
  if (choices.goal === "bassLine") body.reduce = "lowest";
  return body;
}

/** True when the choices would leave the track as it is, so there is nothing to save. */
export function isNoChange(body: ConvertBody): boolean {
  return (
    !body.semitones &&
    !body.tuning_midi &&
    !body.preset &&
    body.capo === undefined &&
    body.reduce !== "lowest"
  );
}

export function barList(bars: number[]): string {
  return bars.join(", ");
}

/** What the conversion did, as keys and params for `t()`, so the dialog stays free of string logic. */
export function reportLines(
  report: ConvertReport,
): { key: string; params: Record<string, string | number> }[] {
  const lines: { key: string; params: Record<string, string | number> }[] = [
    { key: "retune.reportMoved", params: { moved: report.refretted, notes: report.notes } },
  ];
  if (report.reduced)
    lines.push({ key: "retune.reportReduced", params: { count: report.reduced } });
  if (report.shifted_bars.length) {
    lines.push({ key: "retune.reportShifted", params: { bars: barList(report.shifted_bars) } });
  }
  if (report.dropped) {
    lines.push({
      key: "retune.reportDropped",
      params: { count: report.dropped, bars: barList(report.dropped_bars) },
    });
  }
  if (report.techniques_dropped) {
    lines.push({ key: "retune.reportHarmonics", params: { count: report.techniques_dropped } });
  }
  return lines;
}
