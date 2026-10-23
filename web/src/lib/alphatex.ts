import { barTicks, notation, VALUES } from "./durations";
import type { Bar, Beat, Note, ScoreDocument, Track, TrackBar } from "./types";
import { tuningLabel } from "./tuning";

/*
 * alphaTab 1.8 alphaTex for one track of a song.
 *
 * - String 1 is the top tab line, which is our string index 0.
 * - A note is `fret.string`, a beat ends with `.duration`; note effects sit in
 *   braces after the note, beat effects after the duration.
 * - Metadata arguments sit in parentheses: `\ts (3 4)`, `\tempo (90)`.
 * - Voices: all bars of voice 1, then `\voice` and all bars of voice 2.
 * - Repeats (`\ro`, `\rc`), voltas (`\ae`) and directions (`\jump`) are written
 *   out, so alphaTab draws them and its synth plays the expanded order that
 *   `playback.ts` computes; sync marks are keyed by that played order.
 */

const SLIDE: Record<string, string> = {
  shift: "ss",
  legato: "sl",
  in_below: "sib",
  in_above: "sia",
  out_up: "sou",
  out_down: "sod",
};

const HARMONIC: Record<string, string> = {
  natural: "nh",
  artificial: "ah",
  pinch: "ph",
  tap: "th",
  semi: "sh",
};

const GRACE: Record<string, string> = {
  on_beat: "gr onbeat",
  before_beat: "gr beforebeat",
  bend: "gr bendgrace",
};

function escapeTex(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", " ");
}

function brace(effects: string[]): string {
  return effects.length ? ` { ${effects.join(" ")} }` : "";
}

function instrumentProgram(track: Track): number {
  if (track.instrument === "acoustic-guitar") return 25;
  if (track.instrument.includes("bass")) return 33;
  if (track.instrument.includes("guitar")) return 27;
  return track.tuning_midi.length <= 5 ? 33 : 27;
}

export function noteEffects(note: Note): string[] {
  const effects: string[] = [];
  if (note.dead) effects.push("x");
  if (note.tie) effects.push("t");
  if (note.ghost) effects.push("g");
  if (note.hammer) effects.push("h");
  if (note.slide && SLIDE[note.slide]) effects.push(SLIDE[note.slide]);
  if (note.vibrato) effects.push("v");
  if (note.harmonic && HARMONIC[note.harmonic]) effects.push(HARMONIC[note.harmonic]);
  // alphaTab bend values are quarter tones.
  if (note.bend) effects.push(`b (0 ${Math.round(note.bend * 2)})`);
  if (note.palm_mute) effects.push("pm");
  if (note.let_ring) effects.push("lr");
  if (note.staccato) effects.push("st");
  return effects;
}

function noteToken(note: Note): string {
  return `${note.fret}.${note.string + 1}${brace(noteEffects(note))}`;
}

export function beatToken(beat: Beat): string {
  const shape = notation(beat.duration, beat.tuplet ?? null);
  const effects: string[] = [];
  if (shape.dots === 1) effects.push("d");
  if (shape.dots === 2) effects.push("dd");
  if (shape.tuplet) effects.push(`tu ${shape.tuplet}`);
  if (beat.grace && GRACE[beat.grace]) effects.push(GRACE[beat.grace]);
  const tail = `.${shape.token}${brace(effects)}`;
  if (beat.notes.length === 0) return `r${tail}`;
  if (beat.notes.length === 1) return `${noteToken(beat.notes[0])}${tail}`;
  return `(${[...beat.notes]
    .sort((a, b) => a.string - b.string)
    .map(noteToken)
    .join(" ")})${tail}`;
}

/** Rests filling `ticks`, longest values first. */
export function restTokens(ticks: number): string[] {
  const parts: string[] = [];
  let left = ticks;
  for (const value of VALUES) {
    while (left >= value.ticks) {
      parts.push(`r.${value.token}`);
      left -= value.ticks;
    }
  }
  if (left > 1) {
    const rest = notation(left);
    if (Math.abs(rest.ticks - left) <= 1)
      parts.push(beatToken({ position: 0, duration: left, notes: [] }));
  }
  return parts;
}

function voiceBeats(trackBar: TrackBar | undefined, voice: number): Beat[] {
  return [...(trackBar?.voices[voice]?.beats ?? [])].sort(
    (left, right) =>
      left.position - right.position || Number(Boolean(right.grace)) - Number(Boolean(left.grace)),
  );
}

function barContent(bar: Bar, trackBar: TrackBar | undefined, voice: number): string[] {
  const length = barTicks(bar.signature);
  const parts: string[] = [];
  let cursor = 0;
  for (const beat of voiceBeats(trackBar, voice)) {
    if (!beat.grace && beat.position > cursor + 1) {
      parts.push(...restTokens(beat.position - cursor));
      cursor = beat.position;
    }
    parts.push(beatToken(beat));
    if (!beat.grace) cursor += beat.duration;
  }
  if (cursor < length - 1) parts.push(...restTokens(length - cursor));
  return parts;
}

function barMetadata(document: ScoreDocument, index: number): string[] {
  const bar = document.bars[index];
  const previous = index > 0 ? document.bars[index - 1] : undefined;
  const parts: string[] = [];
  if (
    !previous ||
    previous.signature[0] !== bar.signature[0] ||
    previous.signature[1] !== bar.signature[1]
  ) {
    parts.push(`\\ts (${bar.signature[0]} ${bar.signature[1]})`);
  }
  if (index > 0 && bar.tempo) parts.push(`\\tempo (${Math.round(bar.tempo * 100) / 100})`);
  if (bar.repeat_start) parts.push("\\ro");
  if (bar.repeat_end) parts.push(`\\rc ${bar.repeat_end}`);
  if (bar.alternate_endings?.length) parts.push(`\\ae (${bar.alternate_endings.join(" ")})`);
  for (const direction of bar.directions ?? [])
    parts.push(`\\jump ${direction.replaceAll("_", "")}`);
  if (bar.section) parts.push(`\\section ("${escapeTex(bar.section)}")`);
  return parts;
}

export function preferredTrack(document: ScoreDocument): Track {
  return document.tracks.find((track) => track.preferred) ?? document.tracks[0];
}

export function voiceCount(track: Track): number {
  return Math.max(
    1,
    ...track.bars.map((bar) => bar.voices.filter((voice) => voice.beats.length > 0).length),
  );
}

function trackLines(document: ScoreDocument, track: Track, withBarMetadata: boolean): string[] {
  const lines = [
    `\\track ("${escapeTex(track.name)}")`,
    "\\staff { score tabs }",
    `\\tuning (${tuningLabel(track.tuning_midi)})`,
    `\\instrument (${instrumentProgram(track)})`,
  ];
  if (track.capo) lines.push(`\\capo (${track.capo})`);
  const voices = voiceCount(track);
  for (let voice = 0; voice < voices; voice += 1) {
    if (voices > 1) lines.push("\\voice");
    document.bars.forEach((bar, index) => {
      const metadata = voice === 0 && withBarMetadata ? barMetadata(document, index) : [];
      const content = barContent(bar, track.bars[index], voice);
      lines.push(`${[...metadata, ...content].join(" ")} |`);
    });
  }
  return lines;
}

function headerLines(document: ScoreDocument, title: string, artist: string, fallback: string) {
  return [
    `\\title ("${escapeTex(title || fallback)}")`,
    `\\artist ("${escapeTex(artist)}")`,
    `\\tempo (${Math.round(document.bpm * 100) / 100})`,
  ];
}

export function trackToAlphaTex(
  document: ScoreDocument,
  trackId: string,
  title: string,
  artist: string,
): string {
  const track = document.tracks.find((item) => item.id === trackId) ?? preferredTrack(document);
  return [
    ...headerLines(document, title, artist, track.name),
    ...trackLines(document, track, true),
  ].join("\n");
}

/**
 * Every track in one score, in document order, so the player can mix them.
 * Bars are shared, so time, tempo and section marks are written once, on the first track.
 */
export function scoreToAlphaTex(document: ScoreDocument, title: string, artist: string): string {
  const [first] = document.tracks;
  return [
    ...headerLines(document, title, artist, first?.name ?? ""),
    ...document.tracks.flatMap((track, index) => trackLines(document, track, index === 0)),
  ].join("\n");
}
