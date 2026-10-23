-- Personal API tokens for scripts and the CLI. Only the SHA-256 of a token is stored; the token itself is shown
-- once, when it is created. A token acts as its owner and stops working at expires_at (NULL: never) or when the
-- owner revokes it (the row is deleted).
CREATE TABLE api_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    -- The first characters of the token, so the list can tell tokens apart.
    prefix TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT,
    last_used_at TEXT
);

CREATE INDEX api_tokens_user ON api_tokens (user_id);
