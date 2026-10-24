/**
 * The MIDI import dialog's logic. The server lists a file's parts (`POST /api/imports/midi/inspect`); the reader
 * picks parts, an instrument for each, a capo and a grid; `buildOptions` turns that into the import request.
 */
import type { MidiInspection, MidiTrackInfo } from "./api-types";
import { midiToName } from "./tuning";

export const MIDI_GRIDS = [4, 8, 16, 32] as const;
export type MidiGrid = (typeof MIDI_GRIDS)[number];
export const DEFAULT_MIDI_GRID: MidiGrid = 16;
export const MAX_CAPO = 24;

export interface MidiImportOptions {
  tracks: string[];
  presets: Record<string, string>;
  capo: number;
  grid: MidiGrid;
}

export interface MidiChoices {
  selected: string[];
  presets: Record<string, string>;
}

const HEADER = "MThd";

/** True when the file starts with the Standard MIDI File header. The name is not trusted. */
export async function isMidiFile(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, HEADER.length).arrayBuffer());
  return (
    head.length === HEADER.length && HEADER.split("").every((c, i) => head[i] === c.charCodeAt(0))
  );
}

/** What the importer would pick on its own: the parts the server marked, each with its suggested instrument. */
export function initialChoices(info: MidiInspection): MidiChoices {
  const presets: Record<string, string> = {};
  for (const track of info.tracks) presets[track.id] = track.suggested_preset;
  return {
    selected: info.tracks.filter((track) => track.selected).map((track) => track.id),
    presets,
  };
}

export function toggleTrack(selected: string[], id: string, checked: boolean): string[] {
  const rest = selected.filter((item) => item !== id);
  return checked ? [...rest, id] : rest;
}

/** The request for the chosen parts, in the file's order, with presets only for parts that are imported. */
export function buildOptions(
  info: MidiInspection,
  choices: MidiChoices,
  capo: number,
  grid: MidiGrid,
): MidiImportOptions {
  const tracks = info.tracks.map((track) => track.id).filter((id) => choices.selected.includes(id));
  const presets: Record<string, string> = {};
  for (const id of tracks) if (choices.presets[id]) presets[id] = choices.presets[id];
  return { tracks, presets, capo: clampCapo(capo), grid };
}

export function clampCapo(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_CAPO, Math.max(0, Math.round(value)));
}

export function rangeLabel(track: Pick<MidiTrackInfo, "lowest" | "highest">): string {
  return `${midiToName(track.lowest)}–${midiToName(track.highest)}`;
}
