-- The trash (issue #440): deleting a song sets deleted_at instead of removing the row.
--
-- NULL means the song is live. Every read of songs outside fretbook/storage/trash.py asks for
-- deleted_at IS NULL. A trashed song keeps its slug, tags, media, setlist entries and practice
-- log, so a restore only clears the column. The existing (owner_id, ...) indexes still serve the
-- live-song queries; the partial index below holds only the trash, for its list and the purge.

ALTER TABLE songs ADD COLUMN deleted_at TEXT;

CREATE INDEX songs_trash ON songs (deleted_at, owner_id) WHERE deleted_at IS NOT NULL;
