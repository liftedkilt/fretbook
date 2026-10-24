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
  /** Estimated difficulty of the preferred track, 1 to 10; null for a chord sheet without chords. */
  difficulty: number | null;
  /** Sorted A to Z ignoring case. */
  tags: string[];
  /** Matching lyric words when a search found the song only through its lyrics; see `lyricsSnippet.ts`. */
  lyrics_snippet: string | null;
}

export interface SetlistSummary {
  id: string;
  name: string;
  entry_count: number;
  created_at: string;
  updated_at: string;
}

/** One place in a setlist's running order. */
export interface SetlistEntry {
  id: string;
  song_id: string;
  note: string;
  transpose: number;
  title: string;
  artist: string;
  content_kind: ContentKind;
  preferred_instrument: string;
  string_count: number;
}

export interface SetlistDetail extends SetlistSummary {
  entries: SetlistEntry[];
}

/** What is saved for an entry; the server numbers the order from the list. */
export interface SetlistEntryDraft {
  song_id: string;
  note: string;
  transpose: number;
}

export type LibrarySort = "title" | "artist" | "added" | "updated" | "opened" | "difficulty";
export type SortOrder = "asc" | "desc";
export type LibraryFilter = "all" | "bass" | "electric" | "acoustic" | "chords";
/** Difficulty bands: 1 to 3, 4 to 6 and 7 to 10. */
export type LibraryLevel = "all" | "easy" | "medium" | "hard";

export interface SongQuery {
  q?: string;
  sort?: LibrarySort;
  order?: SortOrder;
  instrument?: LibraryFilter;
  /** A song needs every tag listed. */
  tag?: string[];
  favourite?: boolean;
  difficulty_min?: number;
  difficulty_max?: number;
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
  difficulty_tracks: TrackDifficulty[];
}

export type DifficultyFactorKey =
  | "density"
  | "shifts"
  | "stretch"
  | "techniques"
  | "chords"
  | "rhythm"
  | "vocabulary"
  | "barres"
  | "extensions"
  | "changes";

/** One reason for a track's level; `value` is 0 to 1, `measure` the number behind it. */
export interface DifficultyFactor {
  key: DifficultyFactorKey;
  value: number;
  measure: number;
}

export interface TrackDifficulty {
  track_id: string;
  name: string;
  level: number;
  factors: DifficultyFactor[];
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

export type DuplicateAction = "skip" | "keep_both" | "replace";

export interface BulkImportJobItem {
  job_id: string;
  filename: string;
}

export interface BulkImportAccepted {
  batch_id: string;
  total_files: number;
  jobs?: BulkImportJobItem[];
}

/** Bar marks estimated from the audio. Nothing is saved until the anchors go to `patchSync`. */
export interface AutoSyncProposal {
  /** Played bar index to seconds in the audio. */
  anchors: Record<string, number>;
  /** 0 to 1 for each anchor. */
  confidence: Record<string, number>;
  overall: number;
  /** Quarter notes per minute measured in the audio. */
  tempo_bpm: number;
  beat_count: number;
  audio_seconds: number;
  /** Played bars whose mark is worth checking. */
  low_confidence: number[];
}

export interface Job {
  id: string;
  kind: string;
  status: "queued" | "running" | "done" | "error";
  label?: string;
  result: {
    song_id?: string;
    autosync?: AutoSyncProposal | null;
    slug?: string;
    content_kind?: ContentKind;
    warnings?: Keyed[];
    imported?: number | null;
    skipped?: boolean | number | null;
    replaced?: boolean | null;
    duplicate_of?: string | null;
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

export interface AudioCalibration {
  output_device: string;
  input_device: string;
  offset_ms: number;
  jitter_ms?: number | null;
  updated_at: string;
}

export interface AudioCalibrationBody {
  output_device?: string;
  input_device?: string;
  offset_ms: number;
  jitter_ms?: number | null;
}

export type PracticeMode = "free" | "wait" | "scored";

/** One stretch of playing, as sent to the practice log. */
export interface PracticeSessionDraft {
  song_id: string;
  /** The player's local date, `YYYY-MM-DD`. */
  day: string;
  started_at?: string;
  duration_seconds: number;
  track_id: string;
  loop_name: string;
  loop_start: number | null;
  loop_end: number | null;
  /** Ratio: 1 is the written tempo. */
  speed: number;
  mode: PracticeMode;
  score: number | null;
}

export interface PracticeSession extends PracticeSessionDraft {
  id: string;
  started_at: string;
}

export interface PracticeGoal {
  daily_minutes: number;
  weekly_summary: boolean;
}

export interface PracticeSongStats {
  song_id: string;
  title: string;
  artist: string;
  content_kind: "tab" | "chords";
  session_count: number;
  total_seconds: number;
  last_practised: string;
  last_day: string;
  best_speed: number;
  best_score: number | null;
}

export type ExerciseKind = "fretboard" | "interval" | "chord";

/** One finished trainer game, as sent to the practice log. */
export interface PracticeExerciseDraft {
  kind: ExerciseKind;
  /** The player's local date, `YYYY-MM-DD`. */
  day: string;
  started_at?: string;
  duration_seconds: number;
  rounds: number;
  correct: number;
  score: number | null;
}

export interface PracticeExerciseStats {
  kind: ExerciseKind;
  session_count: number;
  total_seconds: number;
  last_day: string;
  best_score: number | null;
}

export interface PracticeStats {
  today: string;
  goal: PracticeGoal;
  today_seconds: number;
  current_streak: number;
  longest_streak: number;
  total_seconds: number;
  songs_practised: number;
  heatmap: { day: string; seconds: number; sessions: number }[];
  week: { seconds: number; previous_seconds: number; days_practised: number; goal_days: number };
  recent: PracticeSongStats[];
  best_scores: PracticeSongStats[];
  stale: PracticeSongStats[];
  exercises: PracticeExerciseStats[];
}

export interface SongPractice {
  session_count: number;
  total_seconds: number;
  best_speed: number | null;
  best_score: number | null;
  last_practised: string | null;
  sessions: PracticeSession[];
}

export interface SuggestedSong {
  song_id: string;
  title: string;
  artist: string;
  content_kind: ContentKind;
  difficulty: number | null;
}

export interface ReviewSong extends SuggestedSong {
  last_day: string;
  interval_days: number;
}

export interface RevisitLoop extends SuggestedSong {
  loop_name: string;
  loop_start: number;
  loop_end: number;
  score: number;
  last_day: string;
  attempts: number;
}

export interface Recommendations {
  level: number | null;
  level_basis: "scored" | "practised" | "none";
  stretch: SuggestedSong[];
  revisit: RevisitLoop[];
  review: ReviewSong[];
}
