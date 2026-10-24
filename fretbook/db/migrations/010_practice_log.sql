-- Practice log: one row per stretch of playing, and a daily goal per user.
--
-- ``day`` is the player's local calendar date (YYYY-MM-DD), chosen by the browser, so the
-- heatmap and streak follow the player's own midnight and not the server's. Deleting a song
-- or a user removes its sessions.

CREATE TABLE practice_sessions (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    song_id TEXT NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
    track_id TEXT NOT NULL DEFAULT '',
    loop_name TEXT NOT NULL DEFAULT '',
    loop_start INTEGER,
    loop_end INTEGER,
    started_at TEXT NOT NULL,
    day TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL,
    speed REAL NOT NULL DEFAULT 1,
    mode TEXT NOT NULL DEFAULT 'free' CHECK (mode IN ('free', 'wait', 'scored')),
    score REAL
);

CREATE INDEX practice_sessions_day ON practice_sessions (owner_id, day);
CREATE INDEX practice_sessions_song ON practice_sessions (owner_id, song_id, started_at);
CREATE INDEX practice_sessions_song_id ON practice_sessions (song_id);

CREATE TABLE practice_goals (
    owner_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    daily_minutes INTEGER NOT NULL DEFAULT 15,
    weekly_summary INTEGER NOT NULL DEFAULT 1
);
