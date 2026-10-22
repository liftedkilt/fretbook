-- Fretbook initial schema.
-- owner_id is always set. In single-user mode it is the "local" user.
-- Issue #5 maps an OIDC "sub" onto users.external_subject and filters every
-- song and media row by the signed-in user's id.

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    external_subject TEXT UNIQUE,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS songs (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id),
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL DEFAULT '',
    source_kind TEXT NOT NULL,
    source_ref TEXT NOT NULL DEFAULT '{}',
    bpm REAL NOT NULL,
    measure_count INTEGER NOT NULL,
    track_count INTEGER NOT NULL,
    string_count INTEGER NOT NULL,
    preferred_instrument TEXT NOT NULL,
    has_sync INTEGER NOT NULL DEFAULT 0,
    duration REAL,
    document TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (owner_id, slug)
);

CREATE INDEX IF NOT EXISTS songs_owner_updated ON songs (owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id),
    song_id TEXT REFERENCES songs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    storage_relpath TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS media_song_kind ON media (song_id, kind);

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    payload TEXT NOT NULL,
    result TEXT,
    error TEXT,
    progress TEXT NOT NULL DEFAULT '',
    progress_key TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS jobs_status_created ON jobs (status, created_at);
