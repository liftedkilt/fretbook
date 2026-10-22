import type { Beat, Note, ScoreDocument, Track } from "./types";
import { tuningLabel } from "./tuning";

const STEPS = [
  { quarters: 4, token: "1" },
  { quarters: 2, token: "2" },
  { quarters: 1, token: "4" },
  { quarters: 0.5, token: "8" },
  { quarters: 0.25, token: "16" },
  { quarters: 0.125, token: "32" },
  { quarters: 0.0625, token: "64" },
];

interface Quantized {
  token: string;
  effects: string[];
}

export function quantizeDuration(quarters: number): Quantized {
  let best: Quantized & { error: number } = {
    token: "4",
    effects: [],
    error: Number.POSITIVE_INFINITY,
  };
  for (const step of STEPS) {
    const options = [
      { effects: [] as string[], used: step.quarters },
      { effects: ["d"], used: step.quarters * 1.5 },
      { effects: ["dd"], used: step.quarters * 1.75 },
      { effects: ["tu 3"], used: (step.quarters * 2) / 3 },
    ];
    for (const option of options) {
      const error = Math.abs(quarters - option.used);
      if (error < best.error) best = { token: step.token, effects: option.effects, error };
    }
  }
  return { token: best.token, effects: best.effects };
}

function escapeTex(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", " ");
}

function brace(effects: string[]): string {
  return effects.length ? ` { ${effects.join(" ")} }` : "";
}

function instrumentProgram(track: Track): number {
  if (track.instrument === "acoustic-guitar") return 25;
  if (track.instrument === "guitar") return 27;
  if (track.tuning_midi.length <= 5) return 33;
  return 27;
}

function noteEffects(note: Note): string[] {
  return [
    note.dead ? "x" : "",
    note.tie ? "t" : "",
    slideEffect(note),
    note.extras?.hp ? "h" : "",
    note.extras?.ghost ? "g" : "",
  ].filter((effect) => effect !== "");
}

function slideEffect(note: Note): string {
  const slide = note.extras?.slide;
  if (slide === "legato") return "ss";
  if (typeof slide === "string" && slide) return "sl";
  return "";
}

function graceEffect(beat: Beat): string {
  const grace = beat.extras?.graceNote;
  if (!grace) return "";
  const name = String(grace).toLowerCase();
  if (name.includes("before")) return "gr beforebeat";
  if (name.includes("bend")) return "gr bendgrace";
  return "gr onbeat";
}

function noteToken(note: Note): string {
  return `${note.fret}.${note.string + 1}${brace(noteEffects(note))}`;
}

function beatToken(beat: Beat): string {
  const duration = quantizeDuration(beat.duration);
  const beatFx = [...duration.effects];
  const grace = graceEffect(beat);
  if (grace) beatFx.push(grace);
  const tail = `.${duration.token}${brace(beatFx)}`;
  if (beat.rest || beat.notes.length === 0) return `r${tail}`;
  if (beat.notes.length === 1) return `${noteToken(beat.notes[0])}${tail}`;
  return `(${beat.notes.map((note) => noteToken(note)).join(" ")})${tail}`;
}

function restToken(quarters: number): string {
  const parts: string[] = [];
  let left = quarters;
  for (const step of STEPS) {
    while (left + 0.001 >= step.quarters) {
      const duration = quantizeDuration(step.quarters);
      parts.push(`r.${duration.token}${brace(duration.effects)}`);
      left -= step.quarters;
    }
  }
  return parts.join(" ");
}

export function preferredTrack(document: ScoreDocument): Track {
  return document.tracks.find((track) => track.preferred) ?? document.tracks[0];
}

/**
 * alphaTab 1.8 alphaTex.
 * String 1 is the top tab line, which is our string index 0.
 * Duration is a dot plus the value (`3.1.4` is fret 3, string 1, quarter),
 * metadata arguments sit in parentheses, and effects sit in braces.
 * One track per load keeps the sync points aligned with that staff.
 */
export function trackToAlphaTex(
  document: ScoreDocument,
  trackId: string,
  title: string,
  artist: string,
): string {
  const track = document.tracks.find((item) => item.id === trackId) ?? preferredTrack(document);
  const header = [
    `\\title ("${escapeTex(title || track.name)}")`,
    `\\artist ("${escapeTex(artist)}")`,
    `\\tempo (${Math.max(1, Math.round(document.bpm))})`,
    `\\track ("${escapeTex(track.name)}")`,
    "\\staff { score tabs }",
    `\\tuning (${tuningLabel(track.tuning_midi)})`,
    `\\instrument (${instrumentProgram(track)})`,
  ];
  if (track.capo) header.push(`\\capo (${track.capo})`);
  const bars = track.measures.map((measure) => {
    const [numerator, denominator] = measure.signature;
    const length = (4 * numerator) / denominator;
    const beats = [...(measure.voices[0]?.beats ?? [])].sort((left, right) => left.position - right.position);
    const parts = [`\\ts (${numerator} ${denominator})`];
    let cursor = 0;
    for (const beat of beats) {
      const grace = Boolean(beat.extras?.graceNote);
      if (!grace && beat.position > cursor + 0.02) {
        parts.push(restToken(beat.position - cursor));
        cursor = beat.position;
      }
      parts.push(beatToken(beat));
      if (!grace) cursor += beat.duration;
    }
    if (cursor < length - 0.02) parts.push(restToken(length - cursor));
    return `${parts.join(" ")} |`;
  });
  return [...header, ...bars].join("\n");
}
