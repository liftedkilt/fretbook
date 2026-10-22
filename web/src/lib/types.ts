/** Mirrors `fretbook/score/model.py`. Time is integer ticks, 960 per quarter note. */

export type SlideKind = "shift" | "legato" | "in_below" | "in_above" | "out_down" | "out_up";
export type HarmonicKind = "natural" | "artificial" | "pinch" | "tap" | "semi";
export type GraceKind = "on_beat" | "before_beat" | "bend";

export interface Note {
  /** 0 is the highest string. */
  string: number;
  fret: number;
  dead?: boolean;
  tie?: boolean;
  ghost?: boolean;
  hammer?: boolean;
  slide?: SlideKind | null;
  vibrato?: boolean;
  harmonic?: HarmonicKind | null;
  /** Semitones. */
  bend?: number | null;
  palm_mute?: boolean;
  let_ring?: boolean;
  staccato?: boolean;
  extras?: Record<string, unknown>;
}

export interface Beat {
  /** Ticks from the start of the bar. */
  position: number;
  /** Ticks; a tuplet's duration is already scaled. */
  duration: number;
  notes: Note[];
  grace?: GraceKind | null;
  tuplet?: number | null;
  extras?: Record<string, unknown>;
}

export interface Voice {
  beats: Beat[];
}

/** Song-level bar (alphaTab's master bar). */
export interface Bar {
  signature: [number, number];
  tempo?: number | null;
  repeat_start?: boolean;
  repeat_end?: number;
  alternate_endings?: number[];
  section?: string | null;
  extras?: Record<string, unknown>;
}

export interface TrackBar {
  voices: Voice[];
  extras?: Record<string, unknown>;
}

export interface Track {
  id: string;
  name: string;
  instrument: string;
  capo: number;
  /** Highest string first. */
  tuning_midi: number[];
  preferred: boolean;
  /** Exactly one entry per song bar. */
  bars: TrackBar[];
}

export interface SyncMap {
  video_id: string | null;
  /** Published bar start times in seconds; null where the source had none. */
  points: (number | null)[];
  /** Tapped bar start times, keyed by bar index. */
  anchors: Record<string, number>;
}

export interface ScoreDocument {
  version: 1;
  /** Opening tempo. */
  bpm: number;
  bars: Bar[];
  tracks: Track[];
  sync: SyncMap;
}

export type ContentKind = "tab" | "chords";

export interface SongSummary {
  id: string;
  slug: string;
  title: string;
  artist: string;
  content_kind: ContentKind;
  source_kind: string;
  revision: number;
  bpm: number;
  measure_count: number;
  track_count: number;
  string_count: number;
  preferred_instrument: string;
  has_sync: boolean;
  has_audio: boolean;
  duration: number | null;
  updated_at: string;
}

export interface SongDetail extends SongSummary {
  source_ref: Record<string, unknown>;
  document: ScoreDocument | null;
  chordpro: string | null;
  created_at: string;
  audio_url: string | null;
  preferred_track_id: string;
}

export interface TabSong extends SongDetail {
  content_kind: "tab";
  document: ScoreDocument;
}

export interface InstrumentPreset {
  id: string;
  label_key: string;
  label: string;
  instrument: string;
  name: string;
  tuning_midi: number[];
  string_count: number;
  family: "bass" | "guitar";
}

export interface Meta {
  name: string;
  tagline: string;
  version: string;
  auth_mode: string;
  exporters: string[];
  instruments: InstrumentPreset[];
}

export interface Settings {
  default_instrument: string;
}

export interface Me {
  user_id: string;
  display_name: string;
  authenticated: boolean;
  settings: Settings;
}

/** A translatable message: a catalog key under `errors`, its parameters, and English text. */
export interface Keyed {
  key: string;
  message: string;
  params: Record<string, string | number>;
}

/** One fretted Songsterr part, from `POST /api/imports/preview`. */
export interface SongsterrTrackChoice {
  part_id: number;
  name: string;
  instrument: string;
  canonical_instrument: string;
  is_bass: boolean;
  is_guitar: boolean;
  tuning: number[];
  string_count: number;
  capo: number;
}

export interface ImportPreview {
  title: string;
  artist: string;
  song_id: number;
  tracks: SongsterrTrackChoice[];
}

export interface Job {
  id: string;
  kind: string;
  status: "queued" | "running" | "done" | "error";
  result: { song_id?: string; content_kind?: ContentKind; warnings?: Keyed[] } | null;
  error: string | null;
  error_key: string;
  error_params: Record<string, string | number>;
  progress: string;
  progress_key: string;
}
