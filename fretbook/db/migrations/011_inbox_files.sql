-- Watched inbox in library mode (FRETBOOK_INBOX_MODE=library): the files are never moved, so the
-- hash of each file's last import is remembered here and only a changed file is imported again.
-- ``rel_path`` is relative to the user's folder in the inbox. ``error`` is empty after a good import.

CREATE TABLE inbox_files (
    owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    rel_path TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    song_id TEXT,
    error TEXT NOT NULL DEFAULT '',
    imported_at TEXT NOT NULL,
    PRIMARY KEY (owner_id, rel_path)
);
