-- Libraries, band membership, and read-only share links.
--
-- A song's owner_id is a library id. A personal library uses the user's id, so every existing
-- "this user's songs" query keeps working. A band is a new library id that is not a user.
-- songs and media therefore reference libraries, not users. jobs.owner_id stays the user who
-- queued the job.
--
-- The migration runner wraps this file in BEGIN/COMMIT. Rebuilding a table that other tables
-- reference needs foreign keys off, and that pragma is illegal inside a transaction, so the
-- first statements close the runner's transaction and open a new one. The runner inserts the
-- schema_migrations row and commits that second transaction.

COMMIT;
PRAGMA foreign_keys = OFF;
BEGIN;

CREATE TABLE libraries (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('personal', 'band')),
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE library_members (
    library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('view', 'edit')),
    created_at TEXT NOT NULL,
    PRIMARY KEY (library_id, user_id)
);

CREATE INDEX library_members_user ON library_members (user_id);

INSERT INTO libraries (id, kind, name, created_at)
SELECT id, 'personal', display_name, created_at FROM users;

INSERT INTO library_members (library_id, user_id, role, created_at)
SELECT id, id, 'edit', created_at FROM users;

-- New accounts get a personal library without a Python hook. ON CONFLICT does not fire this.
CREATE TRIGGER users_personal_library AFTER INSERT ON users BEGIN
    INSERT INTO libraries (id, kind, name, created_at)
    VALUES (NEW.id, 'personal', NEW.display_name, NEW.created_at);
    INSERT INTO library_members (library_id, user_id, role, created_at)
    VALUES (NEW.id, NEW.id, 'edit', NEW.created_at);
END;

CREATE TRIGGER users_personal_library_rename AFTER UPDATE OF display_name ON users BEGIN
    UPDATE libraries SET name = NEW.display_name
    WHERE id = NEW.id AND kind = 'personal';
END;

CREATE TABLE songs_new (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES libraries(id),
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL DEFAULT '',
    content_kind TEXT NOT NULL DEFAULT 'tab' CHECK (content_kind IN ('tab', 'chords')),
    source_kind TEXT NOT NULL,
    source_ref TEXT NOT NULL DEFAULT '{}',
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
    last_opened_at TEXT,
    favourite INTEGER NOT NULL DEFAULT 0,
    difficulty REAL,
    difficulty_detail TEXT,
    difficulty_version INTEGER,
    lyrics_indexed INTEGER NOT NULL DEFAULT 0,
    musical_key TEXT NOT NULL DEFAULT '',
    detected_key TEXT,
    key_version INTEGER,
    genre TEXT NOT NULL DEFAULT '',
    album TEXT NOT NULL DEFAULT '',
    year INTEGER,
    notes TEXT NOT NULL DEFAULT '',
    UNIQUE (owner_id, slug)
);

INSERT INTO songs_new (
    id, owner_id, slug, title, artist, content_kind, source_kind, source_ref, revision,
    bpm, measure_count, track_count, string_count, preferred_instrument, preferred_track_id,
    has_sync, duration, document, chordpro, created_at, updated_at, last_opened_at,
    favourite, difficulty, difficulty_detail, difficulty_version, lyrics_indexed,
    musical_key, detected_key, key_version, genre, album, year, notes
)
SELECT
    id, owner_id, slug, title, artist, content_kind, source_kind, source_ref, revision,
    bpm, measure_count, track_count, string_count, preferred_instrument, preferred_track_id,
    has_sync, duration, document, chordpro, created_at, updated_at, last_opened_at,
    favourite, difficulty, difficulty_detail, difficulty_version, lyrics_indexed,
    musical_key, detected_key, key_version, genre, album, year, notes
FROM songs;

DROP TABLE songs;
ALTER TABLE songs_new RENAME TO songs;

CREATE INDEX songs_owner_updated ON songs (owner_id, updated_at DESC);
CREATE INDEX songs_owner_title ON songs (owner_id, title COLLATE NOCASE);
CREATE INDEX songs_owner_created ON songs (owner_id, created_at DESC);

-- DROP TABLE removed the FTS triggers. songs_fts itself is standalone and still holds the old rows.
CREATE TRIGGER songs_fts_insert AFTER INSERT ON songs BEGIN
    INSERT INTO songs_fts (song_id, title, artist, lyrics, tags)
    VALUES (new.id, new.title, new.artist, '', '');
END;

CREATE TRIGGER songs_fts_delete AFTER DELETE ON songs BEGIN
    DELETE FROM songs_fts WHERE song_id = old.id;
END;

CREATE TRIGGER songs_fts_update AFTER UPDATE OF title, artist ON songs BEGIN
    UPDATE songs_fts SET title = new.title, artist = new.artist WHERE song_id = old.id;
END;

CREATE TABLE media_new (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES libraries(id),
    song_id TEXT REFERENCES songs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    storage_relpath TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    created_at TEXT NOT NULL
);

INSERT INTO media_new (
    id, owner_id, song_id, kind, filename, content_type, storage_relpath, byte_size, created_at
)
SELECT
    id, owner_id, song_id, kind, filename, content_type, storage_relpath, byte_size, created_at
FROM media;

DROP TABLE media;
ALTER TABLE media_new RENAME TO media;

CREATE INDEX media_song_kind ON media (song_id, kind);

-- The secret is never stored. prefix is the first characters, shown in the owner's list.
CREATE TABLE song_shares (
    id TEXT PRIMARY KEY,
    song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT,
    revoked_at TEXT
);

CREATE INDEX song_shares_song ON song_shares (song_id);
