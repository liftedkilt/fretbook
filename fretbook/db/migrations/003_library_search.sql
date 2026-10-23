-- Library search, sorting, and last-opened tracking.
--
-- songs_fts is a standalone FTS5 table keyed by songs.id rather than an
-- external-content table keyed by the implicit rowid, because VACUUM may
-- renumber implicit rowids. It carries no owner: queries filter by owner on
-- songs, so moving songs between owners needs no index update.

ALTER TABLE songs ADD COLUMN last_opened_at TEXT;

CREATE VIRTUAL TABLE songs_fts USING fts5(
    song_id UNINDEXED,
    title,
    artist,
    tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO songs_fts (song_id, title, artist) SELECT id, title, artist FROM songs;

CREATE TRIGGER songs_fts_insert AFTER INSERT ON songs BEGIN
    INSERT INTO songs_fts (song_id, title, artist) VALUES (new.id, new.title, new.artist);
END;

CREATE TRIGGER songs_fts_delete AFTER DELETE ON songs BEGIN
    DELETE FROM songs_fts WHERE song_id = old.id;
END;

-- Only title and artist feed the index; sync, revision and last-opened writes skip it.
CREATE TRIGGER songs_fts_update AFTER UPDATE OF title, artist ON songs BEGIN
    DELETE FROM songs_fts WHERE song_id = old.id;
    INSERT INTO songs_fts (song_id, title, artist) VALUES (new.id, new.title, new.artist);
END;

CREATE INDEX songs_owner_title ON songs (owner_id, title COLLATE NOCASE);
CREATE INDEX songs_owner_created ON songs (owner_id, created_at DESC);
