"""Scheduled snapshots taken by the web process itself (``FRETBOOK_BACKUP_SCHEDULE``).

A background thread looks every few minutes whether a snapshot is due and, if so, calls
``take_snapshot`` with ``FRETBOOK_BACKUP_KEEP``. Due is decided from the newest snapshot folder
on disk, not from memory, so a restart neither skips nor repeats one. A failure is logged and
kept for the admin page; it never stops the server.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from fretbook.backup.snapshot import list_snapshots, snapshot_time, take_snapshot
from fretbook.config import Settings

logger = logging.getLogger("fretbook.backup")

CHECK_INTERVAL_SECONDS = 600
INTERVALS = {"daily": timedelta(days=1), "weekly": timedelta(days=7)}


class BackupBusy(Exception):
    """A snapshot is already being written."""


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(moment: datetime) -> str:
    return moment.astimezone(UTC).replace(microsecond=0).isoformat()


def _folder_bytes(path: Path) -> int:
    return sum(item.stat().st_size for item in path.rglob("*") if item.is_file())


class BackupScheduler:
    def __init__(
        self,
        settings: Settings,
        *,
        clock: Callable[[], datetime] = _now,
        check_seconds: float = CHECK_INTERVAL_SECONDS,
    ) -> None:
        self.settings = settings
        self.clock = clock
        self.check_seconds = check_seconds
        self.last_error: str | None = None
        self.last_error_at: str | None = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._sizes: dict[Path, int] = {}

    @property
    def interval(self) -> timedelta | None:
        if self.settings.demo_mode:
            return None
        return INTERVALS.get(self.settings.backup_schedule)

    def start(self) -> None:
        if self.interval is None or self._thread is not None:
            return
        self._thread = threading.Thread(target=self._run, name="backup-schedule", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                self.check()
            except Exception:  # noqa: BLE001 - the loop must survive any failure
                logger.exception("scheduled backup check failed")
            self._stop.wait(self.check_seconds)

    def newest(self) -> Path | None:
        try:
            snapshots = list_snapshots(self.settings.snapshots_dir)
        except OSError:
            return None
        return snapshots[-1] if snapshots else None

    def next_due(self) -> datetime | None:
        """When the next scheduled snapshot is due; ``None`` when the schedule is off."""
        interval = self.interval
        if interval is None:
            return None
        newest = self.newest()
        return self.clock() if newest is None else snapshot_time(newest) + interval

    def is_due(self) -> bool:
        due = self.next_due()
        # Checks are ``check_seconds`` apart: take it at the last check before the due time rather
        # than the first one after, so the gap between snapshots never exceeds the interval.
        return due is not None and self.clock() + timedelta(seconds=self.check_seconds) > due

    def check(self) -> Path | None:
        """Take a snapshot if one is due. Returns it, or ``None`` when none was due or it failed."""
        if not self.is_due():
            return None
        try:
            return self.run_now()
        except Exception:  # noqa: BLE001 - busy, or a failure run_now has recorded in last_error
            return None

    def run_now(self) -> Path:
        """Write a snapshot now and prune to ``FRETBOOK_BACKUP_KEEP``. Raises on failure, after recording it."""
        if not self._lock.acquire(blocking=False):
            raise BackupBusy
        try:
            path = take_snapshot(self.settings, self.settings.snapshots_dir, keep=self.settings.backup_keep)
        except Exception as exc:
            self.last_error = str(exc) or type(exc).__name__
            self.last_error_at = _iso(self.clock())
            logger.warning("backup to %s failed: %s", self.settings.snapshots_dir, self.last_error)
            raise
        finally:
            self._lock.release()
        self.last_error = None
        self.last_error_at = None
        logger.info("wrote backup %s", path)
        return path

    @property
    def running(self) -> bool:
        return self._lock.locked()

    def status(self) -> dict[str, Any]:
        newest = self.newest()
        last: dict[str, Any] | None = None
        if newest is not None:
            if newest not in self._sizes:
                self._sizes = {newest: _folder_bytes(newest)}
            last = {"path": str(newest), "created_at": _iso(snapshot_time(newest)), "bytes": self._sizes[newest]}
        due = self.next_due()
        return {
            "schedule": self.settings.backup_schedule if self.interval is not None else "off",
            "directory": str(self.settings.snapshots_dir),
            "keep": self.settings.backup_keep,
            "last_snapshot": last,
            "next_due_at": _iso(due) if due is not None else None,
            "last_error": self.last_error,
            "last_error_at": self.last_error_at,
            "running": self.running,
        }
