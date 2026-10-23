-- Free-form tags and a favourite star per song. Songs belong to one owner, so
-- both are per user. Changing either leaves songs.revision and updated_at alone.

ALTER TABLE songs ADD COLUMN favourite INTEGER NOT NULL DEFAULT 0;

CREATE TABLE song_tags (
    song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    tag TEXT NOT NULL COLLATE NOCASE,
    PRIMARY KEY (song_id, tag)
);

CREATE INDEX song_tags_tag ON song_tags (tag);
