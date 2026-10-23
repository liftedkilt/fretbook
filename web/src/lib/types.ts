/** Mirrors `fretbook/score/model.py`. Time is integer ticks, 960 per quarter note. */

export type SlideKind = "shift" | "legato" | "in_below" | "in_above" | "out_down" | "out_up";
export type HarmonicKind = "natural" | "artificial" | "pinch" | "tap" | "semi";
export type GraceKind = "on_beat" | "before_beat" | "bend";
/** Navigation marks on a bar: targets (segno, coda, fine) and jumps (D.C., D.S., to coda). */
export type DirectionKind =
  | "fine"
  | "segno"
  | "segno_segno"
  | "coda"
  | "double_coda"
  | "da_capo"
  | "da_capo_al_coda"
  | "da_capo_al_double_coda"
  | "da_capo_al_fine"
  | "dal_segno"
  | "dal_segno_al_coda"
  | "dal_segno_al_double_coda"
  | "dal_segno_al_fine"
  | "dal_segno_segno"
  | "dal_segno_segno_al_coda"
  | "dal_segno_segno_al_double_coda"
  | "dal_segno_segno_al_fine"
  | "da_coda"
  | "da_double_coda";

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
  /** Volta: the passes (1-based) of the repeat this bar plays on; holds until the next bar that sets its own. */
  alternate_endings?: number[];
  directions?: DirectionKind[];
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

/** Sync marks are keyed by *played* bar index: the written bars expanded through repeats and jumps. */
export interface SyncMap {
  video_id: string | null;
  /** Published bar start times in seconds, one per played bar; null where the source had none. */
  points: (number | null)[];
  /** Tapped bar start times, keyed by played bar index. */
  anchors: Record<string, number>;
  /** The server converts older documents (`written`) to `played` when it loads them. */
  keyed_by?: "written" | "played";
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
  favourite: boolean;
  /** Sorted A to Z ignoring case. */
  tags: string[];
}

export type LibrarySort = "title" | "artist" | "added" | "updated" | "opened";
export type SortOrder = "asc" | "desc";
export type LibraryFilter = "all" | "bass" | "electric" | "acoustic" | "chords";

export interface SongQuery {
  q?: string;
  sort?: LibrarySort;
  order?: SortOrder;
  instrument?: LibraryFilter;
  /** A song needs every tag listed. */
  tag?: string[];
  favourite?: boolean;
  limit?: number;
  cursor?: string;
}

/** Songs in the whole library per filter, unaffected by search, tags and favourites. */
export type LibraryCounts = Record<LibraryFilter, number> & { favourites: number };

export interface TagCount {
  tag: string;
  count: number;
}

export interface SongPage {
  items: SongSummary[];
  total: number;
  next_cursor: string | null;
  counts: LibraryCounts;
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

export interface YtDlpStatus {
  version: string | null;
  released: string | null;
  age_days: number | null;
  stale: boolean;
  auto_update: boolean;
  cookies: boolean;
}

export interface Meta {
  name: string;
  tagline: string;
  version: string;
  commit: string | null;
  auth_mode: string;
  exporters: string[];
  instruments: InstrumentPreset[];
  ytdlp: YtDlpStatus;
}

export interface Settings {
  default_instrument: string;
}

export interface Me {
  user_id: string;
  display_name: string;
  email: string;
  /** False in single-user mode, where there is no sign-in. */
  authenticated: boolean;
  role: "user" | "admin";
  settings: Settings;
}

/** A row of `GET /api/admin/users`. */
export interface AdminUser {
  id: string;
  display_name: string;
  email: string;
  role: "user" | "admin";
  /** The owner of songs from single-user mode and legacy imports. */
  local: boolean;
  created_at: string;
  last_login_at: string | null;
  song_count: number;
  session_count: number;
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

/** A pasted tab converted by the server. A tab has `document`; chords over lyrics have `chordpro`. */
export interface AsciiTabPreview {
  content_kind: ContentKind;
  title: string;
  artist: string;
  document: ScoreDocument | null;
  chordpro: string | null;
  rhythm_estimated: boolean;
  warnings: Keyed[];
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
  label?: string;
  result: {
    song_id?: string;
    content_kind?: ContentKind;
    warnings?: Keyed[];
    imported?: number | null;
    skipped?: number | null;
    copied?: number | null;
    failed?: number | null;
  } | null;
  error: string | null;
  error_key: string;
  error_params: Record<string, string | number>;
  progress: string;
  progress_key: string;
  created_at?: string;
  updated_at?: string;
}
