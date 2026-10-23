-- Multi-user sign-in (OIDC). Roles come from the provider's groups claim at
-- each sign-in and are copied onto the user and the session.

ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'));
ALTER TABLE users ADD COLUMN last_login_at TEXT;

-- Server-side sessions. The cookie holds a random token; only its SHA-256 is
-- stored, so a copy of the database cannot be replayed as a cookie.
CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'admin')),
    -- Sent back as id_token_hint on sign-out.
    id_token TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE INDEX sessions_user ON sessions (user_id);
