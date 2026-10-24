-- Practice log: rhythm trainer runs.
--
-- A finished rhythm run is logged like a trainer game with ``kind`` = 'rhythm': ``rounds`` is the hits
-- expected, ``correct`` the hits played and ``score`` the hit rate in percent. ``pattern`` names what was
-- drilled (a built-in pattern id, or a song's bars), ``bpm`` is the tempo and ``mean_error_ms`` the mean
-- signed timing error (positive is late). SQLite cannot change a CHECK, so the table is rebuilt.

CREATE TABLE practice_exercises_new (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('fretboard', 'interval', 'chord', 'rhythm')),
    started_at TEXT NOT NULL,
    day TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL,
    rounds INTEGER NOT NULL DEFAULT 0,
    correct INTEGER NOT NULL DEFAULT 0,
    score REAL,
    pattern TEXT,
    bpm INTEGER,
    mean_error_ms REAL
);

INSERT INTO practice_exercises_new (id, owner_id, kind, started_at, day, duration_seconds, rounds, correct, score)
SELECT id, owner_id, kind, started_at, day, duration_seconds, rounds, correct, score FROM practice_exercises;

DROP TABLE practice_exercises;
ALTER TABLE practice_exercises_new RENAME TO practice_exercises;

CREATE INDEX practice_exercises_day ON practice_exercises (owner_id, day);
