-- Search chord-sheet lyrics and tags as well as title and artist.
--
-- songs_fts gains two columns. ``tags`` is kept by SQL triggers on song_tags. ``lyrics`` is the ChordPro text
-- with the chord markers and directives stripped, which SQL cannot do, so the application writes it whenever a
-- song's content is saved. ``songs.lyrics_indexed`` marks chord sheets whose lyrics are in the index; the
-- application fills in the rest at start-up. Tabs have no lyrics and start out indexed.
--
-- The update trigger on title and artist now updates the row in place, so it keeps the lyrics and tags.

ALTER TABLE songs ADD COLUMN lyrics_indexed INTEGER NOT NULL DEFAULT 0;
UPDATE songs SET lyrics_indexed = 1 WHERE chordpro IS NULL;

DROP TRIGGER songs_fts_insert;
DROP TRIGGER songs_fts_delete;
DROP TRIGGER songs_fts_update;
DROP TABLE songs_fts;

CREATE VIRTUAL TABLE songs_fts USING fts5(
    song_id UNINDEXED,
    title,
    artist,
    lyrics,
    tags,
    tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO songs_fts (song_id, title, artist, lyrics, tags)
SELECT s.id, s.title, s.artist, '',
       coalesce((SELECT group_concat(t.tag, ' ') FROM song_tags t WHERE t.song_id = s.id), '')
FROM songs s;

CREATE TRIGGER songs_fts_insert AFTER INSERT ON songs BEGIN
    INSERT INTO songs_fts (song_id, title, artist, lyrics, tags) VALUES (new.id, new.title, new.artist, '', '');
END;

CREATE TRIGGER songs_fts_delete AFTER DELETE ON songs BEGIN
    DELETE FROM songs_fts WHERE song_id = old.id;
END;

-- Only title and artist feed the index from songs; sync, revision and last-opened writes skip it.
CREATE TRIGGER songs_fts_update AFTER UPDATE OF title, artist ON songs BEGIN
    UPDATE songs_fts SET title = new.title, artist = new.artist WHERE song_id = old.id;
END;

CREATE TRIGGER song_tags_fts_insert AFTER INSERT ON song_tags BEGIN
    UPDATE songs_fts
    SET tags = coalesce((SELECT group_concat(tag, ' ') FROM song_tags WHERE song_id = new.song_id), '')
    WHERE song_id = new.song_id;
END;

CREATE TRIGGER song_tags_fts_delete AFTER DELETE ON song_tags BEGIN
    UPDATE songs_fts
    SET tags = coalesce((SELECT group_concat(tag, ' ') FROM song_tags WHERE song_id = old.song_id), '')
    WHERE song_id = old.song_id;
END;

CREATE TRIGGER song_tags_fts_update AFTER UPDATE OF tag ON song_tags BEGIN
    UPDATE songs_fts
    SET tags = coalesce((SELECT group_concat(tag, ' ') FROM song_tags WHERE song_id = new.song_id), '')
    WHERE song_id = new.song_id;
END;
