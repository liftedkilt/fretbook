-- Fretbook schema.
-- owner_id is always set. In single-user mode it is the "local" user. users.id
-- is an internal id used in media paths; an OIDC "sub" goes in
-- users.external_subject, never in users.id.

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    external_subject TEXT UNIQUE,
    display_name TEXT NOT NULL,
    -- Instrument preset id: the default for new tabs, added tracks, and which
    -- Songsterr part an import picks.
    default_instrument TEXT NOT NULL DEFAULT 'bass-4',
    created_at TEXT NOT NULL
);

CREATE TABLE songs (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id),
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL DEFAULT '',
    -- "tab": a score document in `document`. "chords": ChordPro text in `chordpro`.
    content_kind TEXT NOT NULL DEFAULT 'tab' CHECK (content_kind IN ('tab', 'chords')),
    source_kind TEXT NOT NULL,
    source_ref TEXT NOT NULL DEFAULT '{}',
    -- Bumped on every write. PUT must send back the revision it loaded.
    revision INTEGER NOT NULL DEFAULT 1,
    bpm REAL NOT NULL DEFAULT 0,
    measure_count INTEGER NOT NULL DEFAULT 0,
    track_count INTEGER NOT NULL DEFAULT 0,
    string_count INTEGER NOT NULL DEFAULT 0,
    preferred_instrument TEXT NOT NULL DEFAULT '',
    preferred_track_id TEXT NOT NULL DEFAULT '',
    has_sync INTEGER NOT NULL DEFAULT 0,
    duration REAL,
    document TEXT,
    chordpro TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (owner_id, slug)
);

CREATE INDEX songs_owner_updated ON songs (owner_id, updated_at DESC);

CREATE TABLE media (
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

CREATE INDEX media_song_kind ON media (song_id, kind);

CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    payload TEXT NOT NULL,
    result TEXT,
    error TEXT,
    -- Translatable error: a catalog key under "errors" plus its parameters.
    error_key TEXT NOT NULL DEFAULT '',
    error_params TEXT NOT NULL DEFAULT '{}',
    progress TEXT NOT NULL DEFAULT '',
    progress_key TEXT NOT NULL DEFAULT '',
    -- Claims so far. A job interrupted by a restart is retried once.
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX jobs_status_created ON jobs (status, created_at);
