-- Practice log: a wait-mode session can be flagged as a finished run.
--
-- ``completed`` is 1 when the player played a wait-mode run all the way through (every step of the track, from the
-- first bar, with no loop). A lesson tied to a library song counts only such sessions as "played in wait mode".
-- Sessions logged before this column existed stay 0: nothing recorded whether they were finished.

ALTER TABLE practice_sessions ADD COLUMN completed INTEGER NOT NULL DEFAULT 0;
