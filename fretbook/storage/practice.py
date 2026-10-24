"""The practice log: sessions, the daily goal, and the numbers behind the dashboard.

Every query is scoped by ``owner_id``. A session's ``day`` is the player's local date, so streaks and
the heatmap follow their midnight; the dashboard is computed relative to a ``today`` the browser sends.
"""

from __future__ import annotations

import sqlite3
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

from fretbook.config import Settings
from fretbook.db.connection import session
from fretbook.db.migrate import utcnow
from fretbook.recommend import LEVEL_DAYS, LOOP_DAYS, build

MODES = ("free", "wait", "scored")
MIN_SECONDS = 1
MAX_SECONDS = 6 * 3600
MAX_SPEED = 4.0
MAX_DAILY_MINUTES = 720
DEFAULT_DAILY_MINUTES = 15
HEATMAP_DAYS = 365
STALE_AFTER_DAYS = 14
LIST_LIMIT = 8
HISTORY_LIMIT = 50


@dataclass
class SessionInput:
    song_id: str
    day: str
    duration_seconds: int
    track_id: str = ""
    loop_name: str = ""
    loop_start: int | None = None
    loop_end: int | None = None
    started_at: str | None = None
    speed: float = 1.0
    mode: str = "free"
    score: float | None = None
    id: str | None = None


class UnknownSong(Exception):
    """A session for a song the owner does not have."""


def parse_day(value: str) -> date:
    """A ``YYYY-MM-DD`` date; raises ``ValueError`` for anything else."""
    if len(value) != 10:
        raise ValueError("not a YYYY-MM-DD date")
    return date.fromisoformat(value)


def _started_at(value: str | None) -> str:
    if value:
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError:
            return utcnow()
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC).replace(microsecond=0).isoformat()
    return utcnow()


class PracticeRepository:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _session(self, *, immediate: bool = False):
        return session(self.settings.database_path, immediate=immediate)

    def record(self, owner_id: str, item: SessionInput) -> dict[str, Any]:
        """Store one session. Raises :class:`UnknownSong` when the owner has no such song."""
        new_id = item.id or uuid.uuid4().hex[:12]
        with self._session(immediate=True) as conn:
            if not _owns_song(conn, owner_id, item.song_id):
                raise UnknownSong(item.song_id)
            _insert(conn, owner_id, new_id, item)
            row = conn.execute("SELECT * FROM practice_sessions WHERE id = ?", (new_id,)).fetchone()
        return _session_dict(row)

    def song_history(self, owner_id: str, song_id: str) -> dict[str, Any] | None:
        """Totals and the latest sessions for one song, or ``None`` when the owner has no such song."""
        with self._session() as conn:
            if not _owns_song(conn, owner_id, song_id):
                return None
            totals = conn.execute(
                """
                SELECT count(*) AS session_count, COALESCE(sum(duration_seconds), 0) AS total_seconds,
                       max(speed) AS best_speed, max(score) AS best_score, max(started_at) AS last_practised
                FROM practice_sessions WHERE owner_id = ? AND song_id = ?
                """,
                (owner_id, song_id),
            ).fetchone()
            rows = conn.execute(
                """
                SELECT * FROM practice_sessions WHERE owner_id = ? AND song_id = ?
                ORDER BY started_at DESC, id LIMIT ?
                """,
                (owner_id, song_id, HISTORY_LIMIT),
            ).fetchall()
        return {**dict(totals), "sessions": [_session_dict(row) for row in rows]}

    def get_goal(self, owner_id: str) -> dict[str, Any]:
        with self._session() as conn:
            return _goal(conn, owner_id)

    def set_goal(self, owner_id: str, daily_minutes: int, weekly_summary: bool) -> dict[str, Any]:
        with self._session(immediate=True) as conn:
            conn.execute(
                """
                INSERT INTO practice_goals (owner_id, daily_minutes, weekly_summary) VALUES (?, ?, ?)
                ON CONFLICT (owner_id) DO UPDATE SET daily_minutes = excluded.daily_minutes,
                                                     weekly_summary = excluded.weekly_summary
                """,
                (owner_id, max(0, min(MAX_DAILY_MINUTES, daily_minutes)), int(weekly_summary)),
            )
            return _goal(conn, owner_id)

    def stats(self, owner_id: str, today: date) -> dict[str, Any]:
        """The dashboard: heatmap, streaks, goal progress, and song lists, as of the player's ``today``."""
        with self._session() as conn:
            goal = _goal(conn, owner_id)
            per_day = {
                row["day"]: (row["seconds"], row["sessions"])
                for row in conn.execute(
                    """
                    SELECT day, sum(duration_seconds) AS seconds, count(*) AS sessions
                    FROM practice_sessions WHERE owner_id = ? GROUP BY day
                    """,
                    (owner_id,),
                )
            }
            songs = [
                dict(row)
                for row in conn.execute(
                    """
                    SELECT s.id AS song_id, s.title, s.artist, s.content_kind,
                           count(*) AS session_count, sum(p.duration_seconds) AS total_seconds,
                           max(p.started_at) AS last_practised, max(p.day) AS last_day,
                           max(p.speed) AS best_speed, max(p.score) AS best_score
                    FROM practice_sessions p JOIN songs s ON s.id = p.song_id
                    WHERE p.owner_id = ? AND s.owner_id = p.owner_id GROUP BY s.id
                    ORDER BY max(p.started_at) DESC, s.id
                    """,
                    (owner_id,),
                )
            ]
        return _dashboard(goal, per_day, songs, today)

    def recommendations(self, owner_id: str, today: date) -> dict[str, Any]:
        """Songs to stretch to, loops to revisit and songs due for review, as of the player's ``today``."""
        since = (today - timedelta(days=max(LEVEL_DAYS, LOOP_DAYS))).isoformat()
        with self._session() as conn:
            songs = [
                dict(row)
                for row in conn.execute(
                    """
                    SELECT s.id AS song_id, s.title, s.artist, s.content_kind, s.difficulty,
                           count(p.id) AS session_count, count(DISTINCT p.day) AS practice_days,
                           max(p.day) AS last_day
                    FROM songs s LEFT JOIN practice_sessions p ON p.song_id = s.id AND p.owner_id = s.owner_id
                    WHERE s.owner_id = ? GROUP BY s.id
                    """,
                    (owner_id,),
                )
            ]
            scored = [
                dict(row)
                for row in conn.execute(
                    """
                    SELECT song_id, loop_name, loop_start, loop_end, day, score FROM practice_sessions
                    WHERE owner_id = ? AND mode = 'scored' AND score IS NOT NULL AND day >= ?
                    ORDER BY started_at DESC, id
                    """,
                    (owner_id, since),
                )
            ]
        return build(songs, scored, today)

    def export_all(self, owner_id: str | None) -> dict[str, Any]:
        """Sessions (of one owner, or of all) and, for one owner, their goal, for the backup archive."""
        with self._session() as conn:
            where, args = (" WHERE owner_id = ?", (owner_id,)) if owner_id else ("", ())
            sessions = [
                _session_dict(row)
                for row in conn.execute(f"SELECT * FROM practice_sessions{where} ORDER BY started_at, id", args)
            ]
            goal = None
            if owner_id and conn.execute("SELECT 1 FROM practice_goals WHERE owner_id = ?", (owner_id,)).fetchone():
                goal = _goal(conn, owner_id)
        return {"sessions": sessions, "goal": goal}

    def restore_session(self, owner_id: str, item: SessionInput) -> bool:
        """Put back a session from an archive. Returns ``False`` for one that is already here or whose song is not.

        An id this owner already has means the same session, so it is skipped and restoring twice adds nothing.
        An id another user holds is a different session that happens to share it, so it gets a fresh id.
        """
        with self._session(immediate=True) as conn:
            if not _owns_song(conn, owner_id, item.song_id):
                return False
            new_id = item.id or uuid.uuid4().hex[:12]
            taken = conn.execute("SELECT owner_id FROM practice_sessions WHERE id = ?", (new_id,)).fetchone()
            if taken is not None:
                if taken["owner_id"] == owner_id:
                    return False
                new_id = uuid.uuid4().hex[:12]
            _insert(conn, owner_id, new_id, item)
        return True

    def restore_goal(self, owner_id: str, daily_minutes: int, weekly_summary: bool) -> None:
        """Put back a goal from an archive unless the owner has already set one."""
        with self._session(immediate=True) as conn:
            conn.execute(
                "INSERT OR IGNORE INTO practice_goals (owner_id, daily_minutes, weekly_summary) VALUES (?, ?, ?)",
                (owner_id, max(0, min(MAX_DAILY_MINUTES, daily_minutes)), int(weekly_summary)),
            )


def _owns_song(conn: sqlite3.Connection, owner_id: str, song_id: str) -> bool:
    return conn.execute("SELECT 1 FROM songs WHERE id = ? AND owner_id = ?", (song_id, owner_id)).fetchone() is not None


def _insert(conn: sqlite3.Connection, owner_id: str, new_id: str, item: SessionInput) -> None:
    mode = item.mode if item.mode in MODES else "free"
    conn.execute(
        """
        INSERT INTO practice_sessions (id, owner_id, song_id, track_id, loop_name, loop_start, loop_end,
                                       started_at, day, duration_seconds, speed, mode, score)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            new_id,
            owner_id,
            item.song_id,
            item.track_id,
            item.loop_name,
            item.loop_start,
            item.loop_end,
            _started_at(item.started_at),
            parse_day(item.day).isoformat(),
            max(MIN_SECONDS, min(MAX_SECONDS, item.duration_seconds)),
            max(0.05, min(MAX_SPEED, item.speed)),
            mode,
            item.score,
        ),
    )


def _session_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "song_id": row["song_id"],
        "track_id": row["track_id"],
        "loop_name": row["loop_name"],
        "loop_start": row["loop_start"],
        "loop_end": row["loop_end"],
        "started_at": row["started_at"],
        "day": row["day"],
        "duration_seconds": row["duration_seconds"],
        "speed": row["speed"],
        "mode": row["mode"],
        "score": row["score"],
    }


def _goal(conn: sqlite3.Connection, owner_id: str) -> dict[str, Any]:
    row = conn.execute(
        "SELECT daily_minutes, weekly_summary FROM practice_goals WHERE owner_id = ?", (owner_id,)
    ).fetchone()
    if row is None:
        return {"daily_minutes": DEFAULT_DAILY_MINUTES, "weekly_summary": True}
    return {"daily_minutes": row["daily_minutes"], "weekly_summary": bool(row["weekly_summary"])}


def streaks(days: set[str], today: date) -> tuple[int, int]:
    """``(current, longest)`` runs of consecutive practised days.

    The current run may end yesterday: a streak is not broken until a whole day has passed without practice.
    """
    parsed = sorted({date.fromisoformat(day) for day in days})
    longest = run = 0
    previous: date | None = None
    for day in parsed:
        run = run + 1 if previous is not None and day - previous == timedelta(days=1) else 1
        longest = max(longest, run)
        previous = day
    cursor = today if today in set(parsed) else today - timedelta(days=1)
    current = 0
    present = set(parsed)
    while cursor in present:
        current += 1
        cursor -= timedelta(days=1)
    return current, longest


def _seconds_between(per_day: dict[str, tuple[int, int]], start: date, end: date) -> int:
    total = 0
    cursor = start
    while cursor <= end:
        total += per_day.get(cursor.isoformat(), (0, 0))[0]
        cursor += timedelta(days=1)
    return total


def _dashboard(
    goal: dict[str, Any], per_day: dict[str, tuple[int, int]], songs: list[dict[str, Any]], today: date
) -> dict[str, Any]:
    current, longest = streaks(set(per_day), today)
    first = today - timedelta(days=HEATMAP_DAYS - 1)
    heatmap = []
    cursor = first
    while cursor <= today:
        seconds, count = per_day.get(cursor.isoformat(), (0, 0))
        if seconds:
            heatmap.append({"day": cursor.isoformat(), "seconds": seconds, "sessions": count})
        cursor += timedelta(days=1)
    week_start = today - timedelta(days=6)
    previous_start = week_start - timedelta(days=7)
    stale_before = (today - timedelta(days=STALE_AFTER_DAYS)).isoformat()
    scored = sorted((item for item in songs if item["best_score"] is not None), key=lambda i: -i["best_score"])
    stale = sorted((item for item in songs if item["last_day"] < stale_before), key=lambda i: i["last_day"])
    week_days = {(week_start + timedelta(days=n)).isoformat() for n in range(7)}
    return {
        "today": today.isoformat(),
        "goal": goal,
        "today_seconds": per_day.get(today.isoformat(), (0, 0))[0],
        "current_streak": current,
        "longest_streak": longest,
        "total_seconds": sum(seconds for seconds, _ in per_day.values()),
        "songs_practised": len(songs),
        "heatmap": heatmap,
        "week": {
            "seconds": _seconds_between(per_day, week_start, today),
            "previous_seconds": _seconds_between(per_day, previous_start, week_start - timedelta(days=1)),
            "days_practised": len(week_days & set(per_day)),
            "goal_days": sum(
                1
                for day in week_days
                if goal["daily_minutes"] and per_day.get(day, (0, 0))[0] >= goal["daily_minutes"] * 60
            ),
        },
        "recent": songs[:LIST_LIMIT],
        "best_scores": scored[:LIST_LIMIT],
        "stale": stale[:LIST_LIMIT],
    }
