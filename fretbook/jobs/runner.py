"""In-process background jobs.

One worker thread pulls queued rows from SQLite. That is enough for a single
self-hosted process. Handlers are registered by kind. Claiming a row is one
``UPDATE ... RETURNING`` in a ``BEGIN IMMEDIATE`` transaction, so a separate
worker process (``python -m fretbook.worker``, for example a GPU container)
can share the table by claiming only its kinds. The web process never claims
a kind that is ``worker_only`` or listed in ``FRETBOOK_WORKER_KINDS``.

A job left ``running`` by a restart is queued again once; if it is interrupted
twice it is marked as an error. A process only recovers the kinds it claims.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
import uuid
from collections.abc import Callable, Iterable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from fretbook.config import Settings
from fretbook.db.connection import session
from fretbook.db.migrate import utcnow

logger = logging.getLogger(__name__)

Handler = Callable[[dict[str, Any], Callable[[str, str], None]], dict[str, Any]]
Progress = Callable[[str, str], None]
MAX_ATTEMPTS = 2
WORKER_TTL_SECONDS = 30


class JobRunner:
    def __init__(self, settings: Settings, *, worker_id: str = "web") -> None:
        self.settings = settings
        self.worker_id = worker_id
        self._handlers: dict[str, Handler] = {}
        self._worker_only: set[str] = set(settings.worker_kinds)
        self._declared_worker_only: set[str] = set()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def _session(self, *, immediate: bool = False):
        return session(self.settings.database_path, immediate=immediate)

    def register(self, kind: str, handler: Handler, *, worker_only: bool = False) -> None:
        self._handlers[kind] = handler
        if worker_only:
            self._worker_only.add(kind)
            self._declared_worker_only.add(kind)

    def worker_only_kinds(self) -> list[str]:
        """Kinds registered as worker-only (not those only moved to a worker by ``FRETBOOK_WORKER_KINDS``)."""
        return sorted(self._declared_worker_only)

    def local_kinds(self) -> list[str]:
        """Kinds this process claims by default: registered, and not reserved for a worker."""
        return sorted(kind for kind in self._handlers if kind not in self._worker_only)

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

    def list_jobs(self, owner_id: str, *, status: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
        query = "SELECT * FROM jobs WHERE owner_id = ?"
        params: list[Any] = [owner_id]
        if status is not None:
            query += " AND status = ?"
            params.append(status)
        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        with self._session() as conn:
            rows = conn.execute(query, params).fetchall()
        return [_job(row) for row in rows]

    # --- administration: every user's jobs, by id alone ---

    def get_any(self, job_id: str) -> dict[str, Any] | None:
        with self._session() as conn:
            row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return _job(row) if row else None

    def list_all(self, *, status: str | None = None, kind: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        query = "SELECT * FROM jobs WHERE 1"
        params: list[Any] = []
        for column, value in (("status", status), ("kind", kind)):
            if value is not None:
                query += f" AND {column} = ?"
                params.append(value)
        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        with self._session() as conn:
            rows = conn.execute(query, params).fetchall()
        return [_job(row) for row in rows]

    def counts(self) -> list[dict[str, Any]]:
        """Jobs per kind and status."""
        with self._session() as conn:
            rows = conn.execute(
                "SELECT kind, status, COUNT(*) AS n FROM jobs GROUP BY kind, status ORDER BY kind, status"
            ).fetchall()
        return [{"kind": row["kind"], "status": row["status"], "count": row["n"]} for row in rows]

    def cancel(self, job_id: str) -> bool:
        """Stop a job that no worker has claimed yet. Its upload is kept, so it can still be retried."""
        with self._session(immediate=True) as conn:
            cursor = conn.execute(
                """
                UPDATE jobs SET status = 'error', error = 'cancelled by an administrator',
                    error_key = 'job.cancelled', error_params = '{}', updated_at = ?
                WHERE id = ? AND status = 'queued'
                """,
                (utcnow(), job_id),
            )
            return cursor.rowcount > 0

    def list_workers(self, ttl: int = WORKER_TTL_SECONDS) -> list[dict[str, Any]]:
        cutoff = (datetime.now(UTC) - timedelta(seconds=ttl)).replace(microsecond=0).isoformat()
        with self._session() as conn:
            rows = conn.execute("SELECT * FROM workers ORDER BY started_at").fetchall()
        return [
            {
                "id": row["id"],
                "kinds": json.loads(row["kinds"]),
                "host": row["host"],
                "pid": row["pid"],
                "started_at": row["started_at"],
                "heartbeat_at": row["heartbeat_at"],
                "alive": row["heartbeat_at"] >= cutoff,
            }
            for row in rows
        ]

    def retry(self, owner_id: str, job_id: str) -> dict[str, Any] | None:
        job = self.get(owner_id, job_id)
        if job is None:
            return None
        if job["status"] != "error":
            raise ValueError("only failed jobs can be retried")
        file_path = job["payload"].get("path")
        if file_path and not Path(file_path).exists():
            raise FileNotFoundError(f"uploaded file {file_path} is no longer available")
        now = utcnow()
        with self._session(immediate=True) as conn:
            conn.execute(
                """
                UPDATE jobs
                SET status = 'queued',
                    attempts = 0,
                    error = NULL,
                    error_key = '',
                    error_params = '{}',
                    progress = '',
                    progress_key = '',
                    updated_at = ?
                WHERE id = ? AND owner_id = ?
                """,
                (now, job_id, owner_id),
            )
        return self.get(owner_id, job_id)

    def dismiss(self, owner_id: str, job_id: str) -> bool:
        job = self.get(owner_id, job_id)
        if job is None:
            return False
        file_path = job["payload"].get("path")
        if file_path:
            Path(file_path).unlink(missing_ok=True)
        with self._session(immediate=True) as conn:
            cursor = conn.execute(
                "DELETE FROM jobs WHERE id = ? AND owner_id = ?",
                (job_id, owner_id),
            )
            return cursor.rowcount > 0

    def cleanup_failed_uploads(self, max_age_days: int | None = None) -> int:
        """Clean up uploaded files for failed jobs older than N days."""
        if max_age_days is None:
            max_age_days = self.settings.failed_upload_retention_days
        cutoff = (datetime.now(UTC) - timedelta(days=max_age_days)).isoformat()
        cleaned = 0
        with self._session(immediate=True) as conn:
            rows = conn.execute(
                "SELECT id, payload FROM jobs WHERE status = 'error' AND updated_at <= ?",
                (cutoff,),
            ).fetchall()
            for row in rows:
                try:
                    payload = json.loads(row["payload"])
                    path = payload.get("path")
                    if path:
                        p = Path(path)
                        if p.exists():
                            p.unlink(missing_ok=True)
                            cleaned += 1
                except Exception:
                    logger.exception("failed to clean up upload for job %s", row["id"])
        return cleaned

    def recover(self, kinds: Iterable[str] | None = None) -> int:
        """Requeue jobs a restart interrupted; give up on ones interrupted twice.

        Only the given kinds (default: everything except worker-only kinds) are touched,
        so a web restart never steals a job a worker is running.
        """
        self.cleanup_failed_uploads()
        if kinds is not None:
            wanted = list(kinds)
            scope = f"kind IN ({', '.join('?' for _ in wanted)})"
        else:
            wanted = sorted(self._worker_only)
            scope = f"kind NOT IN ({', '.join('?' for _ in wanted)})" if wanted else "1"
        if kinds is not None and not wanted:
            return 0
        with self._session(immediate=True) as conn:
            conn.execute(
                f"""
                UPDATE jobs SET status = 'error', error = ?, error_key = 'job.interrupted', updated_at = ?
                WHERE status = 'running' AND attempts >= ? AND {scope}
                """,
                ("the server restarted during this job; start the import again", utcnow(), MAX_ATTEMPTS, *wanted),
            )
            cursor = conn.execute(
                f"UPDATE jobs SET status = 'queued', worker_id = '', updated_at = ? "
                f"WHERE status = 'running' AND {scope}",
                (utcnow(), *wanted),
            )
            return cursor.rowcount

    def heartbeat(self, kinds: Iterable[str], *, host: str = "", pid: int = 0) -> None:
        """Record that this worker is alive and which kinds it claims."""
        now = utcnow()
        with self._session(immediate=True) as conn:
            conn.execute(
                """
                INSERT INTO workers (id, kinds, host, pid, started_at, heartbeat_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET kinds = excluded.kinds, host = excluded.host,
                    pid = excluded.pid, heartbeat_at = excluded.heartbeat_at
                """,
                (self.worker_id, json.dumps(sorted(kinds)), host, pid, now, now),
            )

    def forget_worker(self) -> None:
        with self._session(immediate=True) as conn:
            conn.execute("DELETE FROM workers WHERE id = ?", (self.worker_id,))

    def live_worker_kinds(self, ttl: int = WORKER_TTL_SECONDS) -> list[str]:
        """Job kinds that a worker with a recent heartbeat claims."""
        cutoff = (datetime.now(UTC) - timedelta(seconds=ttl)).replace(microsecond=0).isoformat()
        with self._session() as conn:
            rows = conn.execute("SELECT kinds FROM workers WHERE heartbeat_at >= ?", (cutoff,)).fetchall()
        return sorted({kind for row in rows for kind in json.loads(row["kinds"])})

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
        last_cleanup = time.monotonic()
        while not self._stop.wait(0.4):
            try:
                if time.monotonic() - last_cleanup > 3600:
                    self.cleanup_failed_uploads()
                    last_cleanup = time.monotonic()
                while self.run_once() and not self._stop.is_set():
                    pass
            except Exception:
                logger.exception("job worker failed")

    def run_once(self, kinds: Iterable[str] | None = None) -> bool:
        job = self._claim(list(kinds) if kinds is not None else self.local_kinds())
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
                    f"""
                    UPDATE jobs
                    SET status = 'running', attempts = attempts + 1, worker_id = ?, updated_at = ?
                    WHERE id = (
                        SELECT id FROM jobs WHERE status = 'queued' AND kind IN ({placeholders})
                        ORDER BY created_at LIMIT 1
                    )
                    RETURNING *
                    """,
                    (self.worker_id, utcnow(), *kinds),
                ).fetchone()
                return _job(row) if row else None
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
        "worker_id": row["worker_id"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
