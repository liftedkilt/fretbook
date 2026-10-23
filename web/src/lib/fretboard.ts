import { barTicks } from "./durations";
import { playedBars } from "./playback";
import type { ScoreDocument, Track } from "./types";

/*
 * Pure logic for the fretboard view: which notes sound at a point of the song, how far along the
 * neck a fret is, and the label a dot shows. The component only draws what this returns.
 */

export type FretLabel = "none" | "names" | "intervals" | "frets";

export const FRET_LABELS: readonly FretLabel[] = ["none", "names", "intervals", "frets"];

/** A note on the neck. `string` 0 is the highest string and `fret` counts from the capo. */
export interface FretNote {
  string: number;
  fret: number;
}

export interface FretEvent {
  /** Played bar index. */
  bar: number;
  /** Ticks from the start of that bar. */
  position: number;
  notes: FretNote[];
}

/** Every beat of the track that has notes, in played order. */
export function buildFretEvents(document: ScoreDocument, track: Track): FretEvent[] {
  const events: FretEvent[] = [];
  playedBars(document.bars).forEach((written, played) => {
    const merged = new Map<number, FretNote[]>();
    for (const voice of track.bars[written]?.voices ?? []) {
      for (const beat of voice.beats) {
        if (beat.grace || beat.notes.length === 0) continue;
        const list = merged.get(beat.position) ?? [];
        for (const note of beat.notes) {
          if (!list.some((item) => item.string === note.string && item.fret === note.fret))
            list.push({ string: note.string, fret: note.fret });
        }
        merged.set(beat.position, list);
      }
    }
    for (const [position, notes] of [...merged].sort((a, b) => a[0] - b[0]))
      events.push({ bar: played, position, notes });
  });
  return events;
}

export interface FretFocus {
  /** The notes sounding now, or empty before the first note. */
  current: FretNote[];
  /** The notes that follow, soonest first. */
  next: { notes: FretNote[]; rank: number }[];
}

/** Index of the last event at or before this bar and position, or -1 before the first. */
export function eventIndexAt(events: readonly FretEvent[], bar: number, position: number): number {
  let low = 0;
  let high = events.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const event = events[mid];
    if (event.bar < bar || (event.bar === bar && event.position <= position)) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  return found;
}

/** What to light at this point: the current beat, and up to `lookahead` beats after it. */
export function focusAt(
  events: readonly FretEvent[],
  bar: number,
  position: number,
  lookahead = 3,
): FretFocus {
  const index = eventIndexAt(events, bar, position);
  const next = events
    .slice(index + 1, index + 1 + Math.max(0, lookahead))
    .map((event, rank) => ({ notes: event.notes, rank: rank + 1 }));
  return { current: index >= 0 ? events[index].notes : [], next };
}

/**
 * Where a position in seconds falls inside its bar, in ticks, assuming the bar's time is even.
 * Used when a recording sets the pace and alphaTab reports no beat.
 */
export function positionInBar(
  starts: readonly number[],
  bar: number,
  seconds: number,
  ticksInBar: number,
): number {
  const start = starts[bar];
  const end = starts[bar + 1];
  if (start === undefined || end === undefined || end <= start) return 0;
  const fraction = Math.min(1, Math.max(0, (seconds - start) / (end - start)));
  return Math.floor(fraction * ticksInBar);
}

/** The ticks of a played bar. */
export function playedBarTicks(document: ScoreDocument, played: number): number {
  const written = playedBars(document.bars)[played];
  const bar = written === undefined ? undefined : document.bars[written];
  return bar ? barTicks(bar.signature) : 0;
}

/** Frets to draw: enough for the highest note in the track, at least 12 and at most 24. */
export function fretCount(track: Track, minimum = 12): number {
  let highest = 0;
  for (const bar of track.bars)
    for (const voice of bar.voices)
      for (const beat of voice.beats)
        for (const note of beat.notes) highest = Math.max(highest, note.fret);
  return Math.min(24, Math.max(minimum, highest));
}

/**
 * Distance of fret `fret` from the nut as a share of the neck drawn to `frets` frets. Frets get
 * closer together up the neck, like the real thing.
 */
export function fretPosition(fret: number, frets: number): number {
  if (frets <= 0) return 0;
  const scale = 1 - 2 ** (-frets / 12);
  return (1 - 2 ** (-fret / 12)) / scale;
}

/** Centre of the space behind fret `fret`; the open string (0) sits left of the nut. */
export function dotPosition(fret: number, frets: number): number {
  if (fret <= 0) return -0.025;
  return (fretPosition(fret - 1, frets) + fretPosition(fret, frets)) / 2;
}

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const INTERVAL_NAMES = ["R", "b2", "2", "b3", "3", "4", "b5", "5", "b6", "6", "b7", "7"];

export function pitchClassName(midi: number): string {
  return SHARP_NAMES[((midi % 12) + 12) % 12];
}

export function intervalName(midi: number, rootPitchClass: number): string {
  return INTERVAL_NAMES[(((midi - rootPitchClass) % 12) + 12) % 12];
}

/** Pitch of a note on this neck. */
export function noteMidi(tuning: readonly number[], capo: number, note: FretNote): number {
  return (tuning[note.string] ?? 0) + capo + note.fret;
}

/** The text on a dot, or "" when labels are off. */
export function dotLabel(
  mode: FretLabel,
  midi: number,
  fret: number,
  rootPitchClass: number,
): string {
  if (mode === "names") return pitchClassName(midi);
  if (mode === "intervals") return intervalName(midi, rootPitchClass);
  if (mode === "frets") return String(fret);
  return "";
}

/** Pitch class of the lowest string, the natural root for the interval labels. */
export function defaultRoot(tuning: readonly number[]): number {
  if (tuning.length === 0) return 0;
  return (((Math.min(...tuning) % 12) + 12) % 12) as number;
}

/** Frets that carry an inlay dot, and the ones that carry two. */
export const SINGLE_INLAYS = [3, 5, 7, 9, 15, 17, 19, 21];
export const DOUBLE_INLAYS = [12, 24];
