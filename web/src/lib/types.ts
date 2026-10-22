export interface Note {
  string: number;
  fret: number;
  dead: boolean;
  tie: boolean;
  extras: Record<string, unknown>;
}

export interface Beat {
  position: number;
  duration: number;
  notes: Note[];
  rest: boolean;
  extras: Record<string, unknown>;
}

export interface Voice {
  beats: Beat[];
}

export interface Measure {
  signature: [number, number];
  voices: Voice[];
  extras: Record<string, unknown>;
}

export interface Track {
  id: string;
  name: string;
  instrument: string;
  capo: number;
  tuning_midi: number[];
  preferred: boolean;
  measures: Measure[];
}

export interface TempoMark {
  bpm: number;
  measure: number;
}

export interface SyncMap {
  video_id: string | null;
  points: number[];
  anchors: Record<string, number>;
}

export interface ScoreDocument {
  version: number;
  bpm: number;
  tempos: TempoMark[];
  tracks: Track[];
  sync: SyncMap;
}

export interface SongSummary {
  id: string;
  slug: string;
  title: string;
  artist: string;
  source_kind: string;
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
  document: ScoreDocument;
  created_at: string;
  audio_url: string | null;
  preferred_track_id: string;
}

export interface InstrumentPreset {
  id: string;
  label_key: string;
  label: string;
  instrument: string;
  name: string;
  tuning_midi: number[];
  string_count: number;
}

export interface Meta {
  name: string;
  tagline: string;
  version: string;
  auth_mode: string;
  exporters: string[];
  instruments: InstrumentPreset[];
}

export interface Job {
  id: string;
  kind: string;
  status: string;
  result: { song_id?: string; warnings?: string[] } | null;
  error: string | null;
  progress: string;
  progress_key: string;
}
