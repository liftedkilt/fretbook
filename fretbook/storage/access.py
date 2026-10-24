"""Who may read or change a song.

``songs.owner_id`` is a library id. A personal library's id is the user's id, so passing that
user still matches the row directly. Anyone else needs a ``library_members`` row. Callers that
are not members get no row back; routes turn that into 404 so a guess does not reveal the song.
"""

from __future__ import annotations

import sqlite3

_ROLES = frozenset({"view", "edit"})


def song_access(conn: sqlite3.Connection, actor_id: str, song_id: str) -> tuple[str, str] | None:
    """``(library_id, role)`` when ``actor_id`` may see the song, else ``None``.

    The actor's own id counts as ``edit`` when it is the library id. That is how personal
    libraries and internal calls that already hold the library id keep working.
    """
    row = conn.execute("SELECT owner_id FROM songs WHERE id = ?", (song_id,)).fetchone()
    if row is None:
        return None
    library_id = row["owner_id"]
    if actor_id == library_id:
        return library_id, "edit"
    member = conn.execute(
        "SELECT role FROM library_members WHERE library_id = ? AND user_id = ?",
        (library_id, actor_id),
    ).fetchone()
    if member is None or member["role"] not in _ROLES:
        return None
    return library_id, member["role"]


def can_read(conn: sqlite3.Connection, actor_id: str, song_id: str) -> bool:
    return song_access(conn, actor_id, song_id) is not None


def editable_library(conn: sqlite3.Connection, actor_id: str, song_id: str) -> str | None:
    """The library id when ``actor_id`` may change the song, else ``None``."""
    access = song_access(conn, actor_id, song_id)
    if access is None or access[1] != "edit":
        return None
    return access[0]
