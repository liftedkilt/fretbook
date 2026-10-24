-- Richer song metadata: key, genre, year, album and personal notes, plus the key detected from the score.
--
-- ``musical_key`` is what the person set (a name from fretbook/score/key.py, or empty); ``detected_key`` is what
-- the score's notes (or a ChordPro ``{key}`` directive) say. The library shows the first, falling back to the
-- second. ``key_version`` is the version of the detection that produced ``detected_key``; rows with NULL or an
-- older version are filled in at start-up, which is how "not looked at yet" differs from "no key found".
-- Cover art lives in ``media`` with kind 'cover'.

ALTER TABLE songs ADD COLUMN musical_key TEXT NOT NULL DEFAULT '';
ALTER TABLE songs ADD COLUMN detected_key TEXT;
ALTER TABLE songs ADD COLUMN key_version INTEGER;
ALTER TABLE songs ADD COLUMN genre TEXT NOT NULL DEFAULT '';
ALTER TABLE songs ADD COLUMN album TEXT NOT NULL DEFAULT '';
ALTER TABLE songs ADD COLUMN year INTEGER;
ALTER TABLE songs ADD COLUMN notes TEXT NOT NULL DEFAULT '';
