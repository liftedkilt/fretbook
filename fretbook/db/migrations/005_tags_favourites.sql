-- Free-form tags and a favourite star per song. Songs belong to one owner, so
-- both are per user. Changing either leaves songs.revision and updated_at alone.

ALTER TABLE songs ADD COLUMN favourite INTEGER NOT NULL DEFAULT 0;

-- tag_key is the tag case-folded by the application. SQLite's NOCASE only folds ASCII, so "Prática" and
-- "PRÁTICA" would otherwise be two tags.
CREATE TABLE song_tags (
    song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    tag_key TEXT NOT NULL,
    PRIMARY KEY (song_id, tag_key)
);

CREATE INDEX song_tags_key ON song_tags (tag_key);
