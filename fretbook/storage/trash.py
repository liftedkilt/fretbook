"""The trash: deleted songs wait here for ``FRETBOOK_TRASH_DAYS`` before they are removed for good.

A trashed song is a ``songs`` row with ``deleted_at`` set. It keeps its slug, tags, media, setlist entries
and practice log, and every other module reads only rows where ``deleted_at IS NULL``, so restoring is
clearing that column. Because the slug stays reserved, a new song with the same title gets the next free
slug and a restored song never collides with it.

Who may use a library's trash is who may delete from it: the owner of a personal library, or a band
member who can edit.
"""

from __future__ import annotations

import logging
import sqlite3
import threading
from datetime import datetime, timedelta
from typing import Any

from fretbook.config import Settings
from fretbook.db.connection import session
from fretbook.db.migrate import utcnow
from fretbook.storage.access import editable_library, song_access
from fretbook.storage.media import MediaStore

logger = logging.getLogger(__name__)

PURGE_INTERVAL_SECONDS = 24 * 60 * 60


def _later(stamp: str, days: int) -> str:
    return (datetime.fromisoformat(stamp) + timedelta(days=days)).isoformat()


class TrashStore:
    def __init__(self, settings: Settings, media: MediaStore) -> None:
        self.settings = settings
        self.media = media

    @property
    def days(self) -> int:
        """How long a deleted song is kept. ``0`` means there is no trash: a delete is final at once."""
        return self.settings.trash_days

    def _session(self, *, immediate: bool = False):
        return session(self.settings.database_path, immediate=immediate)

    def trash(self, actor_id: str, song_id: str) -> bool:
        """Delete a live song: into the trash, or for good when the trash is off. ``False`` when not allowed."""
        with self._session(immediate=True) as conn:
            library_id = editable_library(conn, actor_id, song_id)
            if library_id is None:
                return False
            if self.days > 0:
                conn.execute("UPDATE songs SET deleted_at = ? WHERE id = ?", (utcnow(), song_id))
                return True
        return self._remove(library_id, song_id, trashed=False)

    def list(self, library_id: str) -> list[dict[str, Any]]:
        """The library's trashed songs, newest delete first. The caller has checked the library."""
        with self._session() as conn:
            rows = conn.execute(
                """
                SELECT s.id, s.title, s.artist, s.content_kind, s.deleted_at,
                       (SELECT COALESCE(SUM(m.byte_size), 0) FROM media m WHERE m.song_id = s.id) AS media_bytes
                FROM songs s
                WHERE s.owner_id = ? AND s.deleted_at IS NOT NULL
                ORDER BY s.deleted_at DESC, s.id
                """,
                (library_id,),
            ).fetchall()
        return [{**dict(row), "purge_at": _later(row["deleted_at"], self.days)} for row in rows]

    def restore(self, actor_id: str, song_id: str) -> bool:
        """Take a song out of the trash. ``False`` when it is not there or the caller may not edit its library."""
        with self._session(immediate=True) as conn:
            if self._editable(conn, actor_id, song_id) is None:
                return False
            conn.execute("UPDATE songs SET deleted_at = NULL WHERE id = ?", (song_id,))
        return True

    def delete(self, actor_id: str, song_id: str) -> bool:
        """Remove one trashed song and its files for good."""
        with self._session() as conn:
            library_id = self._editable(conn, actor_id, song_id)
        return library_id is not None and self._remove(library_id, song_id, trashed=True)

    def empty(self, library_id: str) -> int:
        """Remove everything in the library's trash for good. The caller has checked the library."""
        with self._session() as conn:
            ids = [
                row["id"]
                for row in conn.execute(
                    "SELECT id FROM songs WHERE owner_id = ? AND deleted_at IS NOT NULL", (library_id,)
                )
            ]
        return sum(self._remove(library_id, song_id, trashed=True) for song_id in ids)

    def purge_expired(self, now: datetime | None = None) -> int:
        """Remove every song, in any library, that has been in the trash for the retention period."""
        base = datetime.fromisoformat(utcnow()) if now is None else now.replace(microsecond=0)
        cutoff = (base - timedelta(days=self.days)).isoformat()
        with self._session() as conn:
            rows = conn.execute(
                "SELECT id, owner_id FROM songs WHERE deleted_at IS NOT NULL AND deleted_at <= ?", (cutoff,)
            ).fetchall()
        return sum(self._remove(row["owner_id"], row["id"], trashed=True) for row in rows)

    @staticmethod
    def _editable(conn: sqlite3.Connection, actor_id: str, song_id: str) -> str | None:
        access = song_access(conn, actor_id, song_id, trashed=True)
        return access[0] if access is not None and access[1] == "edit" else None

    def _remove(self, library_id: str, song_id: str, *, trashed: bool) -> bool:
        """Delete the row, then the files.

        The row goes first, and only in the state the caller saw, so a song restored in the meantime keeps its
        files. A crash in between leaves files that the admin orphan sweep finds.
        """
        rows = self.media.song_rows(song_id)
        state = "IS NOT NULL" if trashed else "IS NULL"
        with self._session(immediate=True) as conn:
            cursor = conn.execute(
                f"DELETE FROM songs WHERE id = ? AND owner_id = ? AND deleted_at {state}",  # noqa: S608 - fixed text
                (song_id, library_id),
            )
            if not cursor.rowcount:
                return False
        self.media.remove_files(library_id, song_id, rows)
        return True


class TrashPurger:
    """Purges the trash when the server starts and once a day after that, in a background thread."""

    def __init__(self, store: TrashStore) -> None:
        self.store = store
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is not None:
            return
        self.run_once()
        self._thread = threading.Thread(target=self._run, name="trash-purge", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def run_once(self) -> int:
        try:
            removed = self.store.purge_expired()
        except Exception:  # noqa: BLE001 - the loop must survive any failure
            logger.exception("purging the trash failed")
            return 0
        if removed:
            logger.info("purged %s song(s) from the trash", removed)
        return removed

    def _run(self) -> None:
        while not self._stop.wait(PURGE_INTERVAL_SECONDS):
            self.run_once()
