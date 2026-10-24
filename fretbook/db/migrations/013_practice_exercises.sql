-- Practice log: ear-training and fretboard-trainer rounds.
--
-- A trainer round belongs to no song, so it cannot live in ``practice_sessions`` (whose
-- ``song_id`` is required). It counts toward the same days, streaks and daily goal as song
-- practice. ``kind`` is the game: finding notes on the fretboard, naming intervals, or naming
-- chord qualities. ``score`` is the percent of rounds answered correctly.

CREATE TABLE practice_exercises (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('fretboard', 'interval', 'chord')),
    started_at TEXT NOT NULL,
    day TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL,
    rounds INTEGER NOT NULL DEFAULT 0,
    correct INTEGER NOT NULL DEFAULT 0,
    score REAL
);

CREATE INDEX practice_exercises_day ON practice_exercises (owner_id, day);
