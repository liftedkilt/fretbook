-- Setlists: named, ordered lists of songs with per-entry notes and a chord-sheet transpose.
--
-- A song can be in many setlists and, if the owner wants, twice in one, so an
-- entry has its own id. Deleting a song or a setlist removes its entries.

CREATE TABLE setlists (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX setlists_owner ON setlists (owner_id, name COLLATE NOCASE);

CREATE TABLE setlist_entries (
    id TEXT PRIMARY KEY,
    setlist_id TEXT NOT NULL REFERENCES setlists (id) ON DELETE CASCADE,
    song_id TEXT NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    transpose INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX setlist_entries_order ON setlist_entries (setlist_id, position);
CREATE INDEX setlist_entries_song ON setlist_entries (song_id);
