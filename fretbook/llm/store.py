"""Database access for LLM settings, per-user access, the usage log and the result cache.

Keys go in and out as plain text through this class only; the rows hold them encrypted. Nothing here returns a key
to a caller that serialises it: the API layer uses :meth:`has_admin_key` and :meth:`has_own_key`.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fretbook.config import Settings
from fretbook.db.connection import session
from fretbook.db.migrate import utcnow
from fretbook.llm.crypto import SecretBox

MODES = ("own_key", "shared", "disabled")
DEFAULT_MODE = "own_key"
DEFAULT_DAILY_LIMIT = 20
DEFAULT_MONTHLY_LIMIT = 200
CACHE_DAYS = 30


def day_start(now: datetime | None = None) -> str:
    return (now or datetime.now(UTC)).strftime("%Y-%m-%d")


def month_start(now: datetime | None = None) -> str:
    return (now or datetime.now(UTC)).strftime("%Y-%m")


class LlmStore:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.box = SecretBox.for_data_dir(settings.data_dir, settings.secret_key)

    def _session(self, *, immediate: bool = False):
        return session(self.settings.database_path, immediate=immediate)

    # --- instance settings ----------------------------------------------------

    def get_settings(self) -> dict[str, Any]:
        with self._session() as conn:
            row = conn.execute("SELECT * FROM llm_settings WHERE id = 1").fetchone()
        if row is None:
            return {
                "provider": "none",
                "base_url": "",
                "model": "",
                "instance_monthly_cap_usd": None,
                "rate_limit_per_minute": 5,
                "has_admin_key": False,
            }
        return {
            "provider": row["provider"],
            "base_url": row["base_url"],
            "model": row["model"],
            "instance_monthly_cap_usd": row["instance_monthly_cap_usd"],
            "rate_limit_per_minute": row["rate_limit_per_minute"],
            "has_admin_key": bool(row["admin_key_enc"]),
        }

    def update_settings(
        self,
        *,
        provider: str,
        base_url: str,
        model: str,
        instance_monthly_cap_usd: float | None,
        rate_limit_per_minute: int,
        admin_key: str | None = None,
        clear_admin_key: bool = False,
    ) -> None:
        """Replace the settings. ``admin_key`` set stores a new key; ``clear_admin_key`` removes it; else it is kept."""
        with self._session(immediate=True) as conn:
            row = conn.execute("SELECT admin_key_enc FROM llm_settings WHERE id = 1").fetchone()
            key_enc = row["admin_key_enc"] if row else None
            if clear_admin_key:
                key_enc = None
            if admin_key:
                key_enc = self.box.encrypt(admin_key)
            conn.execute(
                """
                INSERT INTO llm_settings (id, provider, base_url, model, admin_key_enc, instance_monthly_cap_usd,
                                          rate_limit_per_minute, updated_at)
                VALUES (1, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (id) DO UPDATE SET provider = excluded.provider, base_url = excluded.base_url,
                    model = excluded.model, admin_key_enc = excluded.admin_key_enc,
                    instance_monthly_cap_usd = excluded.instance_monthly_cap_usd,
                    rate_limit_per_minute = excluded.rate_limit_per_minute, updated_at = excluded.updated_at
                """,
                (
                    provider,
                    base_url,
                    model,
                    key_enc,
                    instance_monthly_cap_usd,
                    rate_limit_per_minute,
                    utcnow(),
                ),
            )

    def admin_key(self) -> str | None:
        with self._session() as conn:
            row = conn.execute("SELECT admin_key_enc FROM llm_settings WHERE id = 1").fetchone()
        return self.box.decrypt(row["admin_key_enc"]) if row and row["admin_key_enc"] else None

    # --- per-user access ------------------------------------------------------

    def get_user(self, user_id: str) -> dict[str, Any]:
        with self._session() as conn:
            row = conn.execute("SELECT * FROM llm_user WHERE user_id = ?", (user_id,)).fetchone()
        if row is None:
            return {
                "mode": DEFAULT_MODE,
                "daily_limit": DEFAULT_DAILY_LIMIT,
                "monthly_limit": DEFAULT_MONTHLY_LIMIT,
                "monthly_spend_cap_usd": None,
                "has_own_key": False,
            }
        return {
            "mode": row["mode"],
            "daily_limit": row["daily_limit"],
            "monthly_limit": row["monthly_limit"],
            "monthly_spend_cap_usd": row["monthly_spend_cap_usd"],
            "has_own_key": bool(row["own_key_enc"]),
        }

    def _ensure_user_row(self, conn, user_id: str) -> None:
        conn.execute(
            """
            INSERT OR IGNORE INTO llm_user (user_id, mode, daily_limit, monthly_limit, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (user_id, DEFAULT_MODE, DEFAULT_DAILY_LIMIT, DEFAULT_MONTHLY_LIMIT, utcnow()),
        )

    def set_user_access(
        self,
        user_id: str,
        *,
        mode: str,
        daily_limit: int | None,
        monthly_limit: int | None,
        monthly_spend_cap_usd: float | None,
    ) -> None:
        with self._session(immediate=True) as conn:
            self._ensure_user_row(conn, user_id)
            conn.execute(
                """
                UPDATE llm_user SET mode = ?, daily_limit = ?, monthly_limit = ?, monthly_spend_cap_usd = ?,
                       updated_at = ? WHERE user_id = ?
                """,
                (mode, daily_limit, monthly_limit, monthly_spend_cap_usd, utcnow(), user_id),
            )

    def set_own_key(self, user_id: str, key: str | None) -> None:
        with self._session(immediate=True) as conn:
            self._ensure_user_row(conn, user_id)
            conn.execute(
                "UPDATE llm_user SET own_key_enc = ?, updated_at = ? WHERE user_id = ?",
                (self.box.encrypt(key) if key else None, utcnow(), user_id),
            )

    def own_key(self, user_id: str) -> str | None:
        with self._session() as conn:
            row = conn.execute("SELECT own_key_enc FROM llm_user WHERE user_id = ?", (user_id,)).fetchone()
        return self.box.decrypt(row["own_key_enc"]) if row and row["own_key_enc"] else None

    # --- usage ----------------------------------------------------------------

    def record_usage(
        self, user_id: str, *, model: str, key_source: str, input_tokens: int, output_tokens: int, cost_usd: float
    ) -> None:
        with self._session() as conn:
            conn.execute(
                """
                INSERT INTO llm_usage (user_id, at, model, key_source, input_tokens, output_tokens, cost_usd)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (user_id, utcnow(), model, key_source, input_tokens, output_tokens, cost_usd),
            )

    def usage_since(
        self, user_id: str | None, since: str, *, key_source: str | None = None, quota_only: bool = False
    ) -> dict[str, Any]:
        """Generations, tokens and estimated cost since ``since`` (an ISO date prefix), for one user or everyone.

        ``quota_only`` leaves out requests made with the user's own key, which do not count against a quota.
        """
        clauses, args = ["at >= ?"], [since]
        if user_id is not None:
            clauses.append("user_id = ?")
            args.append(user_id)
        if key_source is not None:
            clauses.append("key_source = ?")
            args.append(key_source)
        if quota_only:
            clauses.append("key_source != 'own'")
        with self._session() as conn:
            row = conn.execute(
                f"""
                SELECT COUNT(*) AS generations, COALESCE(SUM(input_tokens), 0) AS input_tokens,
                       COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(cost_usd), 0) AS cost_usd
                FROM llm_usage WHERE {" AND ".join(clauses)}
                """,
                args,
            ).fetchone()
        return dict(row)

    def usage_log(self, user_id: str | None, limit: int) -> list[dict[str, Any]]:
        where, args = ("WHERE u.user_id = ?", [user_id]) if user_id else ("", [])
        with self._session() as conn:
            rows = conn.execute(
                f"""
                SELECT u.id, u.user_id, p.display_name AS user_name, u.at, u.model, u.key_source,
                       u.input_tokens, u.output_tokens, u.cost_usd
                FROM llm_usage u JOIN users p ON p.id = u.user_id
                {where} ORDER BY u.id DESC LIMIT ?
                """,
                [*args, limit],
            ).fetchall()
        return [dict(row) for row in rows]

    def user_totals(self) -> dict[str, dict[str, Any]]:
        """Per-user usage today, this month and all time, keyed by user id."""
        today, month = day_start(), month_start()
        with self._session() as conn:
            rows = conn.execute(
                """
                SELECT user_id,
                       SUM(at >= ? AND key_source != 'own') AS today, SUM(at >= ? AND key_source != 'own') AS month,
                       COALESCE(SUM(CASE WHEN at >= ? AND key_source != 'own' THEN cost_usd END), 0) AS month_cost_usd,
                       COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens,
                       COALESCE(SUM(cost_usd), 0) AS cost_usd, COUNT(*) AS total
                FROM llm_usage GROUP BY user_id
                """,
                (today, month, month),
            ).fetchall()
        return {row["user_id"]: dict(row) for row in rows}

    def list_user_access(self) -> list[dict[str, Any]]:
        with self._session() as conn:
            rows = conn.execute("SELECT id, display_name, email FROM users ORDER BY lower(display_name)").fetchall()
        totals = self.user_totals()
        out = []
        for row in rows:
            access = self.get_user(row["id"])
            seen = totals.get(row["id"], {})
            out.append(
                {
                    "user_id": row["id"],
                    "display_name": row["display_name"],
                    "email": row["email"],
                    **access,
                    "generations_today": seen.get("today", 0),
                    "generations_month": seen.get("month", 0),
                    "cost_month_usd": round(seen.get("month_cost_usd", 0.0), 4),
                    "input_tokens": seen.get("input_tokens", 0),
                    "output_tokens": seen.get("output_tokens", 0),
                    "cost_total_usd": round(seen.get("cost_usd", 0.0), 4),
                }
            )
        return out

    # --- notices --------------------------------------------------------------

    def add_notice(self, user_id: str, limit_kind: str, period: str) -> bool:
        """Record that a user reached 80% of a limit. ``False`` when this period already has the notice."""
        with self._session() as conn:
            return (
                conn.execute(
                    "INSERT OR IGNORE INTO llm_notices (user_id, limit_kind, period, created_at) VALUES (?, ?, ?, ?)",
                    (user_id, limit_kind, period, utcnow()),
                ).rowcount
                > 0
            )

    def list_notices(self) -> list[dict[str, Any]]:
        with self._session() as conn:
            rows = conn.execute(
                """
                SELECT n.user_id, p.display_name AS user_name, n.limit_kind, n.period, n.created_at
                FROM llm_notices n JOIN users p ON p.id = n.user_id ORDER BY n.created_at DESC LIMIT 100
                """
            ).fetchall()
        return [dict(row) for row in rows]

    def clear_notices(self) -> int:
        with self._session() as conn:
            return conn.execute("DELETE FROM llm_notices").rowcount

    # --- cache ----------------------------------------------------------------

    def cache_get(self, user_id: str, request_hash: str) -> str | None:
        cutoff = (datetime.now(UTC) - timedelta(days=CACHE_DAYS)).replace(microsecond=0).isoformat()
        with self._session() as conn:
            row = conn.execute(
                "SELECT response FROM llm_cache WHERE user_id = ? AND request_hash = ? AND created_at >= ?",
                (user_id, request_hash, cutoff),
            ).fetchone()
        return row["response"] if row else None

    def cache_put(self, user_id: str, request_hash: str, response: str) -> None:
        with self._session() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO llm_cache (user_id, request_hash, response, created_at) VALUES (?, ?, ?, ?)",
                (user_id, request_hash, response, utcnow()),
            )
