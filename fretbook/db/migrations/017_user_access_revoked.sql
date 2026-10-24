-- Set when the OIDC provider refuses a user's group membership at sign-in. Sessions and personal API tokens of a
-- user with access_revoked_at set are refused until a later sign-in succeeds (which clears it).
ALTER TABLE users ADD COLUMN access_revoked_at TEXT;
