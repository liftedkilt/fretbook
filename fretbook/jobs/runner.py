"""In-process background jobs.

One worker thread pulls queued rows from SQLite. That is enough for a single
self-hosted process. Handlers are registered by kind, so issue #6 can enqueue
``import.youtube_frames`` without a new queue.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
import uuid
from collections.abc import Callable
from typing import Any

from fretbook.config import Settings
from fretbook.db.connection import connect
from fretbook.db.migrate import utcnow

logger = logging.getLogger(__name__)

Handler = Callable[[dict[str, Any], Callable[[str, str], None]], dict[str, Any]]
Progress = Callable[[str, str], None]


class JobRunner:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._handlers: dict[str, Handler] = {}
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def register(self, kind: str, handler: Handler) -> None:
        self._handlers[kind] = handler

    def enqueue(self, owner_id: str, kind: str, payload: dict[str, Any]) -> str:
        job_id = uuid.uuid4().hex
        now = utcnow()
        with connect(self.settings.database_path) as conn:
            conn.execute(
                """
                INSERT INTO jobs (
                    id, owner_id, kind, status, payload, progress, progress_key,
                    created_at, updated_at
                ) VALUES (?, ?, ?, 'queued', ?, '', '', ?, ?)
                """,
                (job_id, owner_id, kind, json.dumps(payload), now, now),
            )
        return job_id

    def get(self, owner_id: str, job_id: str) -> dict[str, Any] | None:
        with connect(self.settings.database_path) as conn:
            row = conn.execute(
                "SELECT * FROM jobs WHERE owner_id = ? AND id = ?",
                (owner_id, job_id),
            ).fetchone()
        return _job(row) if row else None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="fretbook-jobs", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2)

    def _loop(self) -> None:
        while not self._stop.wait(0.4):
            try:
                self.run_once()
            except Exception:
                logger.exception("job worker failed")

    def run_once(self) -> bool:
        job = self._claim()
        if job is None:
            return False
        handler = self._handlers.get(job["kind"])
        if handler is None:
            self._finish(job["id"], status="error", error=f"no handler for {job['kind']}")
            return True

        def progress(message: str, key: str = "") -> None:
            self._progress(job["id"], message, key)

        try:
            result = handler(job, progress)
        except Exception as exc:
            logger.exception("job %s failed", job["id"])
            self._finish(job["id"], status="error", error=str(exc))
            return True
        self._finish(job["id"], status="done", result=result)
        return True

    def _claim(self) -> dict[str, Any] | None:
        conn = connect(self.settings.database_path)
        try:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1"
            ).fetchone()
            if row is None:
                conn.execute("COMMIT")
                return None
            conn.execute(
                "UPDATE jobs SET status = 'running', updated_at = ? WHERE id = ?",
                (utcnow(), row["id"]),
            )
            conn.execute("COMMIT")
            return _job(row)
        except sqlite3.Error:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _progress(self, job_id: str, message: str, key: str) -> None:
        with connect(self.settings.database_path) as conn:
            conn.execute(
                """
                UPDATE jobs SET progress = ?, progress_key = ?, updated_at = ?
                WHERE id = ?
                """,
                (message, key, utcnow(), job_id),
            )

    def _finish(
        self,
        job_id: str,
        *,
        status: str,
        result: dict[str, Any] | None = None,
        error: str | None = None,
    ) -> None:
        with connect(self.settings.database_path) as conn:
            conn.execute(
                """
                UPDATE jobs
                SET status = ?, result = ?, error = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    status,
                    json.dumps(result) if result is not None else None,
                    error,
                    utcnow(),
                    job_id,
                ),
            )


def _job(row: sqlite3.Row) -> dict[str, Any]:
    result = json.loads(row["result"]) if row["result"] else None
    return {
        "id": row["id"],
        "owner_id": row["owner_id"],
        "kind": row["kind"],
        "status": row["status"],
        "payload": json.loads(row["payload"]),
        "result": result,
        "error": row["error"],
        "progress": row["progress"],
        "progress_key": row["progress_key"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
