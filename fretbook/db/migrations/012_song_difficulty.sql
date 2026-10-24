-- Estimated difficulty of a tab, from its score (see fretbook/score/difficulty.py).
--
-- ``difficulty`` is the 1..10 level of the preferred track, stored so the library can sort and filter by it
-- without reading scores. ``difficulty_detail`` is the per-track breakdown as JSON, shown on the song.
-- Chord sheets keep NULL. ``difficulty_version`` is the version of the estimate that produced the row; rows
-- with NULL or an older version are filled in at start-up.

ALTER TABLE songs ADD COLUMN difficulty REAL;
ALTER TABLE songs ADD COLUMN difficulty_detail TEXT;
ALTER TABLE songs ADD COLUMN difficulty_version INTEGER;
