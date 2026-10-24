-- Separate worker processes (python -m fretbook.worker) and which one claimed a job.
CREATE TABLE workers (
    id TEXT PRIMARY KEY,
    kinds TEXT NOT NULL,
    host TEXT NOT NULL DEFAULT '',
    pid INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    heartbeat_at TEXT NOT NULL
);

ALTER TABLE jobs ADD COLUMN worker_id TEXT NOT NULL DEFAULT '';
