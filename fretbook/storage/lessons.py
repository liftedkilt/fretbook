"""Per-user lesson progress. Every query is scoped by ``owner_id``."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fretbook.config import Settings
from fretbook.db.connection import session
from fretbook.db.migrate import utcnow


@dataclass
class Progress:
    course_id: str
    lesson_id: str
    last_opened_at: str
    completed_at: str | None
    attempts: int
    best_score: float | None
    best_bpm: float | None


def _progress(row: Any) -> Progress:
    return Progress(
        row["course_id"],
        row["lesson_id"],
        row["last_opened_at"],
        row["completed_at"],
        row["attempts"],
        row["best_score"],
        row["best_bpm"],
    )


class LessonProgressRepository:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _session(self, *, immediate: bool = False):
        return session(self.settings.database_path, immediate=immediate)

    def all(self, owner_id: str) -> dict[tuple[str, str], Progress]:
        with self._session() as conn:
            rows = conn.execute("SELECT * FROM lesson_progress WHERE owner_id = ?", (owner_id,)).fetchall()
        return {(row["course_id"], row["lesson_id"]): _progress(row) for row in rows}

    def opened(self, owner_id: str, course_id: str, lesson_id: str) -> None:
        now = utcnow()
        with self._session(immediate=True) as conn:
            conn.execute(
                """
                INSERT INTO lesson_progress (owner_id, course_id, lesson_id, first_opened_at, last_opened_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (owner_id, course_id, lesson_id) DO UPDATE SET last_opened_at = excluded.last_opened_at
                """,
                (owner_id, course_id, lesson_id, now, now),
            )

    def record(
        self,
        owner_id: str,
        course_id: str,
        lesson_id: str,
        *,
        score: float | None,
        bpm: float | None,
        passed: bool,
    ) -> Progress:
        """Count an attempt, keep the best result, and complete the lesson when ``passed``."""
        now = utcnow()
        with self._session(immediate=True) as conn:
            conn.execute(
                """
                INSERT INTO lesson_progress (owner_id, course_id, lesson_id, first_opened_at, last_opened_at,
                                             completed_at, attempts, best_score, best_bpm)
                VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
                ON CONFLICT (owner_id, course_id, lesson_id) DO UPDATE SET
                    last_opened_at = excluded.last_opened_at,
                    attempts = attempts + 1,
                    completed_at = coalesce(completed_at, excluded.completed_at),
                    best_score = max(
                        coalesce(best_score, excluded.best_score), coalesce(excluded.best_score, best_score)
                    ),
                    best_bpm = max(coalesce(best_bpm, excluded.best_bpm), coalesce(excluded.best_bpm, best_bpm))
                """,
                (owner_id, course_id, lesson_id, now, now, now if passed else None, score, bpm),
            )
            row = conn.execute(
                "SELECT * FROM lesson_progress WHERE owner_id = ? AND course_id = ? AND lesson_id = ?",
                (owner_id, course_id, lesson_id),
            ).fetchone()
        return _progress(row)

    def best_practice(self, owner_id: str, song_id: str) -> dict[str, Any]:
        """Whole-song runs of a library song from the practice log: scored runs, and whether wait mode was finished.

        A looped section does not count: looping the easy bars must not pass a lesson about the song. Neither does a
        wait session the player left unfinished: only one flagged ``completed`` shows the song was played through.
        """
        with self._session() as conn:
            song = conn.execute("SELECT bpm FROM songs WHERE id = ? AND owner_id = ?", (song_id, owner_id)).fetchone()
            if song is None:
                return {"found": False, "runs": [], "waited": False}
            rows = conn.execute(
                "SELECT mode, speed, score, completed FROM practice_sessions "
                "WHERE owner_id = ? AND song_id = ? AND loop_start IS NULL AND loop_end IS NULL",
                (owner_id, song_id),
            ).fetchall()
        base = song["bpm"] or 0
        runs = [
            (row["score"], base * row["speed"] if base else None)
            for row in rows
            if row["mode"] == "scored" and row["score"] is not None
        ]
        return {
            "found": True,
            "runs": runs,
            "waited": any(row["mode"] == "wait" and row["completed"] for row in rows),
        }

    def export_all(self, owner_id: str) -> list[dict[str, Any]]:
        """One user's progress for the backup. Lessons are files, so rows are keyed by course and lesson id."""
        with self._session() as conn:
            rows = conn.execute(
                "SELECT * FROM lesson_progress WHERE owner_id = ? ORDER BY course_id, lesson_id", (owner_id,)
            ).fetchall()
        return [
            {key: row[key] for key in row.keys() if key != "owner_id"}  # noqa: SIM118 - sqlite3.Row
            for row in rows
        ]

    def restore(self, owner_id: str, item: dict[str, Any]) -> bool:
        """Put back one row from an archive. A lesson this user already has progress on is left alone."""
        with self._session(immediate=True) as conn:
            cursor = conn.execute(
                """
                INSERT OR IGNORE INTO lesson_progress (owner_id, course_id, lesson_id, first_opened_at,
                    last_opened_at, completed_at, attempts, best_score, best_bpm)
                VALUES (:owner_id, :course_id, :lesson_id, :first_opened_at, :last_opened_at, :completed_at,
                        :attempts, :best_score, :best_bpm)
                """,
                {**item, "owner_id": owner_id},
            )
            return cursor.rowcount > 0
