-- LLM settings, per-user access and quotas, and the usage log (issue #172).
--
-- Keys are stored encrypted (Fernet); the API never returns them. ``llm_settings`` is a single row.
-- A user without an ``llm_user`` row is in the default mode, ``own_key``.

CREATE TABLE llm_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    -- none | ollama | anthropic | openai
    provider TEXT NOT NULL DEFAULT 'none',
    base_url TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    admin_key_enc TEXT,
    -- Monthly dollar cap on the admin key across all users (NULL: none).
    instance_monthly_cap_usd REAL,
    rate_limit_per_minute INTEGER NOT NULL DEFAULT 5,
    updated_at TEXT NOT NULL
);

CREATE TABLE llm_user (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    -- own_key | shared | disabled
    mode TEXT NOT NULL DEFAULT 'own_key',
    own_key_enc TEXT,
    daily_limit INTEGER,
    monthly_limit INTEGER,
    monthly_spend_cap_usd REAL,
    updated_at TEXT NOT NULL
);

CREATE TABLE llm_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    model TEXT NOT NULL,
    -- shared | own | local
    key_source TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0
);

CREATE INDEX llm_usage_user_at ON llm_usage (user_id, at);
CREATE INDEX llm_usage_at ON llm_usage (at);

-- Identical requests (same song and difficulty) reuse the earlier result instead of calling the model again.
CREATE TABLE llm_cache (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_hash TEXT NOT NULL,
    response TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, request_hash)
);

-- "A user reached 80% of a limit" notices for the admin; one per user, limit and period.
CREATE TABLE llm_notices (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    limit_kind TEXT NOT NULL,
    period TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, limit_kind, period)
);
