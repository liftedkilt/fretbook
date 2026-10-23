"""Setlists and their ordered entries. Every query is scoped by ``owner_id``."""

from __future__ import annotations

import sqlite3
import uuid
from dataclasses import dataclass
from typing import Any

from fretbook.config import Settings
from fretbook.db.connection import session
from fretbook.db.migrate import utcnow

MAX_ENTRIES = 500
MAX_NAME = 200
MAX_NOTE = 500
MAX_TRANSPOSE = 11


@dataclass
class EntryInput:
    song_id: str
    note: str = ""
    transpose: int = 0


class UnknownSongs(Exception):
    """Entries that name songs the owner does not have."""

    def __init__(self, song_ids: list[str]) -> None:
        super().__init__(f"unknown songs: {', '.join(song_ids)}")
        self.song_ids = song_ids


class TooManyEntries(Exception):
    pass


class SetlistRepository:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _session(self, *, immediate: bool = False):
        return session(self.settings.database_path, immediate=immediate)

    def list_setlists(self, owner_id: str) -> list[dict[str, Any]]:
        with self._session() as conn:
            rows = conn.execute(
                """
                SELECT l.id, l.name, l.created_at, l.updated_at,
                       (SELECT count(*) FROM setlist_entries e WHERE e.setlist_id = l.id) AS entry_count
                FROM setlists l
                WHERE l.owner_id = ?
                ORDER BY l.name COLLATE NOCASE, l.created_at, l.id
                """,
                (owner_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_setlist(self, owner_id: str, setlist_id: str) -> dict[str, Any] | None:
        with self._session() as conn:
            return _load(conn, owner_id, setlist_id)

    def create_setlist(
        self, owner_id: str, name: str, entries: list[EntryInput] | None = None, *, setlist_id: str | None = None
    ) -> dict[str, Any]:
        now = utcnow()
        new_id = setlist_id or uuid.uuid4().hex[:12]
        with self._session(immediate=True) as conn:
            conn.execute(
                "INSERT INTO setlists (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (new_id, owner_id, _clean_name(name), now, now),
            )
            if entries:
                _write_entries(conn, owner_id, new_id, entries)
            loaded = _load(conn, owner_id, new_id)
        assert loaded is not None
        return loaded

    def id_taken(self, setlist_id: str) -> bool:
        with self._session() as conn:
            return conn.execute("SELECT 1 FROM setlists WHERE id = ?", (setlist_id,)).fetchone() is not None

    def rename(self, owner_id: str, setlist_id: str, name: str) -> dict[str, Any] | None:
        with self._session(immediate=True) as conn:
            cursor = conn.execute(
                "UPDATE setlists SET name = ?, updated_at = ? WHERE id = ? AND owner_id = ?",
                (_clean_name(name), utcnow(), setlist_id, owner_id),
            )
            if not cursor.rowcount:
                return None
            return _load(conn, owner_id, setlist_id)

    def replace_entries(self, owner_id: str, setlist_id: str, entries: list[EntryInput]) -> dict[str, Any] | None:
        """Make ``entries`` the whole ordered list. Raises :class:`UnknownSongs` for songs the owner lacks."""
        with self._session(immediate=True) as conn:
            if not _owns(conn, owner_id, setlist_id):
                return None
            _write_entries(conn, owner_id, setlist_id, entries)
            conn.execute("UPDATE setlists SET updated_at = ? WHERE id = ?", (utcnow(), setlist_id))
            return _load(conn, owner_id, setlist_id)

    def append_entry(self, owner_id: str, setlist_id: str, entry: EntryInput) -> dict[str, Any] | None:
        with self._session(immediate=True) as conn:
            if not _owns(conn, owner_id, setlist_id):
                return None
            current = [
                EntryInput(row["song_id"], row["note"], row["transpose"])
                for row in conn.execute(
                    "SELECT song_id, note, transpose FROM setlist_entries WHERE setlist_id = ? ORDER BY position",
                    (setlist_id,),
                )
            ]
            _write_entries(conn, owner_id, setlist_id, [*current, entry])
            conn.execute("UPDATE setlists SET updated_at = ? WHERE id = ?", (utcnow(), setlist_id))
            return _load(conn, owner_id, setlist_id)

    def delete_setlist(self, owner_id: str, setlist_id: str) -> bool:
        with self._session(immediate=True) as conn:
            return bool(
                conn.execute("DELETE FROM setlists WHERE id = ? AND owner_id = ?", (setlist_id, owner_id)).rowcount
            )

    def export_all(self, owner_id: str | None) -> list[dict[str, Any]]:
        """Every setlist (of one owner, or of all) with entries as plain song ids, for the backup archive."""
        with self._session() as conn:
            rows = conn.execute(
                "SELECT id, owner_id FROM setlists"
                + (" WHERE owner_id = ?" if owner_id else "")
                + " ORDER BY created_at, id",
                (owner_id,) if owner_id else (),
            ).fetchall()
            loaded = [_load(conn, row["owner_id"], row["id"]) for row in rows]
        return [item for item in loaded if item is not None]


def _clean_name(name: str) -> str:
    return name.strip()[:MAX_NAME] or "Untitled"


def _owns(conn: sqlite3.Connection, owner_id: str, setlist_id: str) -> bool:
    return (
        conn.execute("SELECT 1 FROM setlists WHERE id = ? AND owner_id = ?", (setlist_id, owner_id)).fetchone()
        is not None
    )


def _write_entries(conn: sqlite3.Connection, owner_id: str, setlist_id: str, entries: list[EntryInput]) -> None:
    if len(entries) > MAX_ENTRIES:
        raise TooManyEntries
    wanted = sorted({entry.song_id for entry in entries})
    owned = {
        row["id"]
        for row in conn.execute(
            f"SELECT id FROM songs WHERE owner_id = ? AND id IN ({','.join('?' * len(wanted))})",
            (owner_id, *wanted),
        )
    }
    missing = [song_id for song_id in wanted if song_id not in owned]
    if missing:
        raise UnknownSongs(missing)
    conn.execute("DELETE FROM setlist_entries WHERE setlist_id = ?", (setlist_id,))
    conn.executemany(
        "INSERT INTO setlist_entries (id, setlist_id, song_id, position, note, transpose) VALUES (?, ?, ?, ?, ?, ?)",
        [
            (
                uuid.uuid4().hex[:12],
                setlist_id,
                entry.song_id,
                position,
                entry.note.strip()[:MAX_NOTE],
                max(-MAX_TRANSPOSE, min(MAX_TRANSPOSE, entry.transpose)),
            )
            for position, entry in enumerate(entries)
        ],
    )


def _load(conn: sqlite3.Connection, owner_id: str, setlist_id: str) -> dict[str, Any] | None:
    head = conn.execute(
        "SELECT id, name, created_at, updated_at FROM setlists WHERE id = ? AND owner_id = ?",
        (setlist_id, owner_id),
    ).fetchone()
    if head is None:
        return None
    # Joined on the setlist's owner too, so a song never shows up under someone else's setlist.
    rows = conn.execute(
        """
        SELECT e.id, e.song_id, e.note, e.transpose,
               s.title, s.artist, s.content_kind, s.preferred_instrument, s.string_count
        FROM setlist_entries e
        JOIN songs s ON s.id = e.song_id AND s.owner_id = ?
        WHERE e.setlist_id = ?
        ORDER BY e.position, e.id
        """,
        (owner_id, setlist_id),
    ).fetchall()
    return {**dict(head), "entry_count": len(rows), "entries": [dict(row) for row in rows]}
