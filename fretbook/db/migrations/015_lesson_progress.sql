-- Lessons and courses: one row per lesson a user has opened, with their best result.
--
-- Lessons are files (built-in and the user's lessons folder), not rows, so there is no foreign key to them: a
-- row simply stays when a lesson is renamed or removed. ``completed_at`` is set when the pass condition is met
-- (or the player marks a lesson without one as done) and is never cleared. Deleting a user removes their rows.

CREATE TABLE lesson_progress (
    owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    course_id TEXT NOT NULL,
    lesson_id TEXT NOT NULL,
    first_opened_at TEXT NOT NULL,
    last_opened_at TEXT NOT NULL,
    completed_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    best_score REAL,
    best_bpm REAL,
    PRIMARY KEY (owner_id, course_id, lesson_id)
);

CREATE INDEX lesson_progress_recent ON lesson_progress (owner_id, last_opened_at);
