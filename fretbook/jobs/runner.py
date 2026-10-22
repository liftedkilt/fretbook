"""In-process background jobs.

One worker thread pulls queued rows from SQLite. That is enough for a single
self-hosted process. Handlers are registered by kind. Claiming a row is a
``BEGIN IMMEDIATE`` transaction, so a separate worker process (for example a
GPU container for issue #6) can share the table by claiming only its kinds.

A job left ``running`` by a restart is queued again once; if it is interrupted
twice it is marked as an error.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
import uuid
from collections.abc import Callable, Iterable
from typing import Any

from fretbook.config import Settings
from fretbook.db.connection import session
from fretbook.db.migrate import utcnow

logger = logging.getLogger(__name__)

Handler = Callable[[dict[str, Any], Callable[[str, str], None]], dict[str, Any]]
Progress = Callable[[str, str], None]
MAX_ATTEMPTS = 2


class JobRunner:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._handlers: dict[str, Handler] = {}
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def _session(self, *, immediate: bool = False):
        return session(self.settings.database_path, immediate=immediate)

    def register(self, kind: str, handler: Handler) -> None:
        self._handlers[kind] = handler

    def enqueue(self, owner_id: str, kind: str, payload: dict[str, Any]) -> str:
        job_id = uuid.uuid4().hex
        now = utcnow()
        with self._session() as conn:
            conn.execute(
                """
                INSERT INTO jobs (id, owner_id, kind, status, payload, created_at, updated_at)
                VALUES (?, ?, ?, 'queued', ?, ?, ?)
                """,
                (job_id, owner_id, kind, json.dumps(payload), now, now),
            )
        return job_id

    def get(self, owner_id: str, job_id: str) -> dict[str, Any] | None:
        with self._session() as conn:
            row = conn.execute(
                "SELECT * FROM jobs WHERE owner_id = ? AND id = ?",
                (owner_id, job_id),
            ).fetchone()
        return _job(row) if row else None

    def recover(self) -> int:
        """Requeue jobs a restart interrupted; give up on ones interrupted twice."""
        with self._session(immediate=True) as conn:
            conn.execute(
                """
                UPDATE jobs SET status = 'error', error = ?, error_key = 'job.interrupted', updated_at = ?
                WHERE status = 'running' AND attempts >= ?
                """,
                ("the server restarted during this job; start the import again", utcnow(), MAX_ATTEMPTS),
            )
            cursor = conn.execute(
                "UPDATE jobs SET status = 'queued', updated_at = ? WHERE status = 'running'",
                (utcnow(),),
            )
            return cursor.rowcount

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        requeued = self.recover()
        if requeued:
            logger.info("requeued %s interrupted job(s)", requeued)
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="fretbook-jobs", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5)

    def _loop(self) -> None:
        while not self._stop.wait(0.4):
            try:
                while self.run_once() and not self._stop.is_set():
                    pass
            except Exception:
                logger.exception("job worker failed")

    def run_once(self, kinds: Iterable[str] | None = None) -> bool:
        job = self._claim(list(kinds) if kinds is not None else list(self._handlers))
        if job is None:
            return False
        handler = self._handlers.get(job["kind"])
        if handler is None:
            self._finish(job["id"], status="error", error=f"no handler for {job['kind']}", error_key="job.noHandler")
            return True

        def progress(message: str, key: str = "") -> None:
            self._progress(job["id"], message, key)

        try:
            result = handler(job, progress)
        except Exception as exc:
            logger.exception("job %s failed", job["id"])
            self._finish(
                job["id"],
                status="error",
                error=str(exc),
                error_key=getattr(exc, "key", "") or "job.failed",
                error_params=getattr(exc, "params", None) or {},
            )
            return True
        self._finish(job["id"], status="done", result=result)
        return True

    def _claim(self, kinds: list[str]) -> dict[str, Any] | None:
        if not kinds:
            return None
        placeholders = ", ".join("?" for _ in kinds)
        try:
            with self._session(immediate=True) as conn:
                row = conn.execute(
                    f"SELECT * FROM jobs WHERE status = 'queued' AND kind IN ({placeholders}) "
                    "ORDER BY created_at LIMIT 1",
                    kinds,
                ).fetchone()
                if row is None:
                    return None
                conn.execute(
                    "UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?",
                    (utcnow(), row["id"]),
                )
                return _job(row)
        except sqlite3.OperationalError:
            logger.warning("could not claim a job; will retry", exc_info=True)
            return None

    def _progress(self, job_id: str, message: str, key: str) -> None:
        with self._session() as conn:
            conn.execute(
                "UPDATE jobs SET progress = ?, progress_key = ?, updated_at = ? WHERE id = ?",
                (message, key, utcnow(), job_id),
            )

    def _finish(
        self,
        job_id: str,
        *,
        status: str,
        result: dict[str, Any] | None = None,
        error: str | None = None,
        error_key: str = "",
        error_params: dict[str, Any] | None = None,
    ) -> None:
        with self._session() as conn:
            conn.execute(
                """
                UPDATE jobs
                SET status = ?, result = ?, error = ?, error_key = ?, error_params = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    status,
                    json.dumps(result) if result is not None else None,
                    error,
                    error_key,
                    json.dumps(error_params or {}, default=str),
                    utcnow(),
                    job_id,
                ),
            )


def _job(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "owner_id": row["owner_id"],
        "kind": row["kind"],
        "status": row["status"],
        "payload": json.loads(row["payload"]),
        "result": json.loads(row["result"]) if row["result"] else None,
        "error": row["error"],
        "error_key": row["error_key"],
        "error_params": json.loads(row["error_params"] or "{}"),
        "progress": row["progress"],
        "progress_key": row["progress_key"],
        "attempts": row["attempts"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
