"""Signed-in users and their sessions (OIDC mode).

``users.id`` stays an internal uuid hex because it names media folders; the
provider's ``sub`` is kept in ``users.external_subject``.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fretbook.config import Settings
from fretbook.db.connection import session
from fretbook.db.migrate import utcnow
from fretbook.storage.repository import _unique_slug

LOCAL_USER = "local"
TOKEN_PREFIX = "fb_"
MAX_TOKENS_PER_USER = 50
# last_used_at moves at most this often, so a busy script does not write on every request.
_TOUCH_SECONDS = 60


def hash_api_token(token: str) -> str:
    """Tokens are 256 random bits, so a plain SHA-256 is enough to store."""
    return hashlib.sha256(token.encode()).hexdigest()


def _later(seconds: int) -> str:
    return (datetime.now(UTC) + timedelta(seconds=seconds)).replace(microsecond=0).isoformat()


_TOKEN_COLUMNS = "id, name, prefix, created_at, expires_at, last_used_at"


class UserStore:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _session(self, *, immediate: bool = False):
        return session(self.settings.database_path, immediate=immediate)

    # --- sign-in ------------------------------------------------------------

    def sign_in(self, *, subject: str, display_name: str, email: str, role: str) -> str:
        """Create or refresh the user for an OIDC ``sub`` and return its internal id."""
        now = utcnow()
        with self._session(immediate=True) as conn:
            row = conn.execute("SELECT id FROM users WHERE external_subject = ?", (subject,)).fetchone()
            if row is None:
                user_id = uuid.uuid4().hex
                conn.execute(
                    """
                    INSERT INTO users (id, external_subject, display_name, email, role, created_at, last_login_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (user_id, subject, display_name, email, role, now, now),
                )
                return user_id
            user_id = row["id"]
            conn.execute(
                "UPDATE users SET display_name = ?, email = ?, role = ?, last_login_at = ? WHERE id = ?",
                (display_name, email, role, now, user_id),
            )
            return user_id

    def create_session(self, user_id: str, *, token_hash: str, role: str, id_token: str) -> None:
        now = utcnow()
        with self._session() as conn:
            conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
            conn.execute(
                """
                INSERT INTO sessions (token_hash, user_id, role, id_token, created_at, expires_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (token_hash, user_id, role, id_token, now, _later(self.settings.session_max_age)),
            )

    def find_session(self, token_hash: str) -> dict[str, Any] | None:
        with self._session() as conn:
            row = conn.execute(
                """
                SELECT s.user_id, s.role, s.id_token, u.display_name, u.email
                FROM sessions s JOIN users u ON u.id = s.user_id
                WHERE s.token_hash = ? AND s.expires_at > ?
                """,
                (token_hash, utcnow()),
            ).fetchone()
        return dict(row) if row else None

    def end_session(self, token_hash: str) -> str:
        """Delete a session and return its ID token (empty when there was none)."""
        with self._session() as conn:
            row = conn.execute("SELECT id_token FROM sessions WHERE token_hash = ?", (token_hash,)).fetchone()
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
        return row["id_token"] if row else ""

    def revoke_sessions(self, user_id: str) -> int:
        with self._session() as conn:
            return conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,)).rowcount

    # --- administration -----------------------------------------------------

    def list_users(self) -> list[dict[str, Any]]:
        with self._session() as conn:
            rows = conn.execute(
                """
                SELECT u.id, u.display_name, u.email, u.role, u.external_subject, u.created_at, u.last_login_at,
                       (SELECT COUNT(*) FROM songs s WHERE s.owner_id = u.id) AS song_count,
                       (SELECT COUNT(*) FROM sessions x WHERE x.user_id = u.id AND x.expires_at > ?) AS session_count
                FROM users u
                ORDER BY u.external_subject IS NULL, lower(u.display_name)
                """,
                (utcnow(),),
            ).fetchall()
        return [
            {
                "id": row["id"],
                "display_name": row["display_name"],
                "email": row["email"],
                "role": row["role"],
                # The "local" user holds songs from single-user mode and legacy imports.
                "local": row["external_subject"] is None,
                "created_at": row["created_at"],
                "last_login_at": row["last_login_at"],
                "song_count": row["song_count"],
                "session_count": row["session_count"],
            }
            for row in rows
        ]

    def exists(self, user_id: str) -> bool:
        with self._session() as conn:
            return conn.execute("SELECT 1 FROM users WHERE id = ?", (user_id,)).fetchone() is not None

    def adopt_local(self, user_id: str) -> int:
        """Move the single-user library (owner ``local``) to ``user_id``.

        Slugs are renumbered where they collide. Media files stay where they
        are: their rows keep the stored path, so only ``owner_id`` changes.
        """
        with self._session(immediate=True) as conn:
            rows = conn.execute("SELECT id, slug FROM songs WHERE owner_id = ?", (LOCAL_USER,)).fetchall()
            for row in rows:
                slug = _unique_slug(conn, user_id, row["slug"])
                conn.execute("UPDATE songs SET owner_id = ?, slug = ? WHERE id = ?", (user_id, slug, row["id"]))
            conn.execute("UPDATE media SET owner_id = ? WHERE owner_id = ?", (user_id, LOCAL_USER))
        return len(rows)

    # --- personal API tokens --------------------------------------------------

    def create_token(
        self, user_id: str, name: str, *, expires_in_days: int | None
    ) -> tuple[str, dict[str, Any]] | None:
        """Make a token for ``user_id`` and return ``(secret, row)``, or ``None`` at the per-user cap.

        The secret is not stored and cannot be read again.
        """
        secret = TOKEN_PREFIX + secrets.token_urlsafe(32)
        token_id = uuid.uuid4().hex
        expires_at = _later(expires_in_days * 86400) if expires_in_days else None
        with self._session(immediate=True) as conn:
            count = conn.execute("SELECT COUNT(*) FROM api_tokens WHERE user_id = ?", (user_id,)).fetchone()[0]
            if count >= MAX_TOKENS_PER_USER:
                return None
            conn.execute(
                """
                INSERT INTO api_tokens (id, user_id, name, prefix, token_hash, created_at, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (token_id, user_id, name, secret[:8], hash_api_token(secret), utcnow(), expires_at),
            )
            row = conn.execute(f"SELECT {_TOKEN_COLUMNS} FROM api_tokens WHERE id = ?", (token_id,)).fetchone()
        return secret, dict(row)

    def list_tokens(self, user_id: str) -> list[dict[str, Any]]:
        with self._session() as conn:
            rows = conn.execute(
                f"SELECT {_TOKEN_COLUMNS} FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC, id",
                (user_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def revoke_token(self, user_id: str, token_id: str) -> bool:
        with self._session() as conn:
            return conn.execute("DELETE FROM api_tokens WHERE id = ? AND user_id = ?", (token_id, user_id)).rowcount > 0

    def find_token_owner(self, secret: str) -> dict[str, Any] | None:
        """The owner of a live token, or ``None`` when it is unknown or expired. Records the use."""
        now = utcnow()
        with self._session() as conn:
            row = conn.execute(
                """
                SELECT t.id, t.last_used_at, u.id AS user_id, u.display_name, u.email, u.role
                FROM api_tokens t JOIN users u ON u.id = t.user_id
                WHERE t.token_hash = ? AND (t.expires_at IS NULL OR t.expires_at > ?)
                """,
                (hash_api_token(secret), now),
            ).fetchone()
            if row is None:
                return None
            conn.execute(
                "UPDATE api_tokens SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at <= ?)",
                (now, row["id"], _later(-_TOUCH_SECONDS)),
            )
        return dict(row)
