-- Per-user audio latency calibrations keyed by output and input device.

CREATE TABLE audio_calibrations (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    output_device TEXT NOT NULL DEFAULT 'default',
    input_device TEXT NOT NULL DEFAULT 'default',
    offset_ms REAL NOT NULL DEFAULT 0.0,
    jitter_ms REAL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (owner_id, output_device, input_device)
);

CREATE INDEX audio_calibrations_owner ON audio_calibrations (owner_id);
