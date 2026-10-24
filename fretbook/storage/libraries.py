"""Band libraries and read-only share links.

A personal library's id is the user's id. A band is a separate library. Songs move between
libraries the caller can edit; a copy needs read on the source and edit on the destination.
Share tokens are stored as SHA-256 only and are shown once.
"""

from __future__ import annotations

import hashlib
import json
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fretbook.api.errors import api_error
from fretbook.config import Settings
from fretbook.db.connection import session
from fretbook.db.migrate import utcnow
from fretbook.storage.access import can_read, editable_library, song_access
from fretbook.storage.media import MediaStore, QuotaExceeded
from fretbook.storage.repository import SongRepository, _index_lyrics, _unique_slug

MAX_NAME = 80
MAX_ACTIVE_SHARES = 20
MAX_EXPIRY_DAYS = 3650
SHARE_PREFIX = "sh_"


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _later(days: int) -> str:
    return (datetime.now(UTC) + timedelta(days=days)).replace(microsecond=0).isoformat()


def _clean_name(name: str) -> str:
    cleaned = " ".join(name.split())
    if not cleaned or len(cleaned) > MAX_NAME:
        raise api_error(400, "library.badName", "the library name must be 1 to 80 characters")
    return cleaned


class LibraryStore:
    def __init__(self, settings: Settings, songs: SongRepository, media: MediaStore) -> None:
        self.settings = settings
        self.songs = songs
        self.media = media

    def _session(self, *, immediate: bool = False):
        return session(self.settings.database_path, immediate=immediate)

    def _role(self, conn, user_id: str, library_id: str) -> str | None:
        row = conn.execute(
            "SELECT role FROM library_members WHERE library_id = ? AND user_id = ?",
            (library_id, user_id),
        ).fetchone()
        if row is not None:
            return row["role"]
        if (
            user_id == library_id
            and conn.execute("SELECT 1 FROM libraries WHERE id = ? AND kind = 'personal'", (library_id,)).fetchone()
        ):
            return "edit"
        return None

    def _library(self, conn, library_id: str):
        return conn.execute("SELECT id, kind, name, created_at FROM libraries WHERE id = ?", (library_id,)).fetchone()

    def require(self, user_id: str, library_id: str, *, write: bool = False) -> dict[str, Any]:
        """The library when ``user_id`` is a member. Missing and forbidden look the same."""
        with self._session() as conn:
            row = self._library(conn, library_id)
            role = self._role(conn, user_id, library_id) if row is not None else None
        if row is None or role is None:
            raise api_error(404, "library.notFound", "that library was not found")
        if write and role != "edit":
            raise api_error(403, "library.readOnly", "you can view this library but not change it")
        return {**dict(row), "role": role}

    def list_for(self, user_id: str) -> list[dict[str, Any]]:
        with self._session() as conn:
            rows = conn.execute(
                """
                SELECT l.id, l.kind, l.name, m.role,
                       (SELECT count(*) FROM songs s WHERE s.owner_id = l.id) AS song_count
                FROM libraries l
                JOIN library_members m ON m.library_id = l.id AND m.user_id = ?
                ORDER BY l.kind DESC, lower(l.name), l.id
                """,
                (user_id,),
            ).fetchall()
        return [
            {
                "id": row["id"],
                "kind": row["kind"],
                "name": row["name"],
                "role": row["role"],
                "song_count": row["song_count"],
            }
            for row in rows
        ]

    def create_band(self, user_id: str, name: str) -> dict[str, Any]:
        cleaned = _clean_name(name)
        library_id = uuid.uuid4().hex
        now = utcnow()
        with self._session(immediate=True) as conn:
            conn.execute(
                "INSERT INTO libraries (id, kind, name, created_at) VALUES (?, 'band', ?, ?)",
                (library_id, cleaned, now),
            )
            conn.execute(
                "INSERT INTO library_members (library_id, user_id, role, created_at) VALUES (?, ?, 'edit', ?)",
                (library_id, user_id, now),
            )
        return self.require(user_id, library_id)

    def rename(self, user_id: str, library_id: str, name: str) -> dict[str, Any]:
        library = self.require(user_id, library_id, write=True)
        if library["kind"] != "band":
            raise api_error(403, "library.personal", "a personal library cannot be shared")
        cleaned = _clean_name(name)
        with self._session() as conn:
            conn.execute("UPDATE libraries SET name = ? WHERE id = ? AND kind = 'band'", (cleaned, library_id))
        return self.require(user_id, library_id)

    def delete_band(self, user_id: str, library_id: str) -> None:
        library = self.require(user_id, library_id, write=True)
        if library["kind"] != "band":
            raise api_error(403, "library.personal", "a personal library cannot be shared")
        with self._session() as conn:
            songs = conn.execute("SELECT count(*) FROM songs WHERE owner_id = ?", (library_id,)).fetchone()[0]
            if songs:
                raise api_error(409, "library.notEmpty", "move or delete this band's songs before deleting it")
            conn.execute("DELETE FROM libraries WHERE id = ?", (library_id,))

    def members(self, user_id: str, library_id: str) -> list[dict[str, Any]]:
        self.require(user_id, library_id)
        with self._session() as conn:
            rows = conn.execute(
                """
                SELECT m.user_id, m.role, u.display_name
                FROM library_members m
                JOIN users u ON u.id = m.user_id
                WHERE m.library_id = ?
                ORDER BY m.role DESC, lower(u.display_name), m.user_id
                """,
                (library_id,),
            ).fetchall()
        return [{"user_id": row["user_id"], "display_name": row["display_name"], "role": row["role"]} for row in rows]

    def add_member(self, user_id: str, library_id: str, email: str, role: str) -> dict[str, Any]:
        library = self.require(user_id, library_id, write=True)
        if library["kind"] != "band":
            raise api_error(403, "library.personal", "a personal library cannot be shared")
        if role not in {"view", "edit"}:
            raise api_error(400, "library.badRole", "role must be view or edit")
        wanted = email.strip()
        if not wanted:
            raise api_error(404, "library.memberNotFound", "no member has that email address")
        with self._session(immediate=True) as conn:
            found = conn.execute(
                "SELECT id, display_name FROM users WHERE email != '' AND lower(email) = lower(?)",
                (wanted,),
            ).fetchall()
            if len(found) != 1:
                if len(found) > 1:
                    raise api_error(409, "library.ambiguousEmail", "more than one account has that email address")
                raise api_error(404, "library.memberNotFound", "no member has that email address")
            member_id = found[0]["id"]
            if conn.execute(
                "SELECT 1 FROM library_members WHERE library_id = ? AND user_id = ?",
                (library_id, member_id),
            ).fetchone():
                raise api_error(409, "library.alreadyMember", "that person is already in this band")
            conn.execute(
                "INSERT INTO library_members (library_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
                (library_id, member_id, role, utcnow()),
            )
            display_name = found[0]["display_name"]
        return {"user_id": member_id, "display_name": display_name, "role": role}

    def set_member_role(self, user_id: str, library_id: str, member_id: str, role: str) -> dict[str, Any]:
        library = self.require(user_id, library_id, write=True)
        if library["kind"] != "band":
            raise api_error(403, "library.personal", "a personal library cannot be shared")
        if role not in {"view", "edit"}:
            raise api_error(400, "library.badRole", "role must be view or edit")
        with self._session(immediate=True) as conn:
            current = conn.execute(
                "SELECT role FROM library_members WHERE library_id = ? AND user_id = ?",
                (library_id, member_id),
            ).fetchone()
            if current is None:
                raise api_error(404, "library.memberNotFound", "that person is not in this band")
            if current["role"] == "edit" and role != "edit":
                self._keep_an_editor(conn, library_id)
            conn.execute(
                "UPDATE library_members SET role = ? WHERE library_id = ? AND user_id = ?",
                (role, library_id, member_id),
            )
            name = conn.execute("SELECT display_name FROM users WHERE id = ?", (member_id,)).fetchone()
        return {
            "user_id": member_id,
            "display_name": name["display_name"] if name else "",
            "role": role,
        }

    def remove_member(self, user_id: str, library_id: str, member_id: str) -> None:
        library = self.require(user_id, library_id, write=True)
        if library["kind"] != "band":
            raise api_error(403, "library.personal", "a personal library cannot be shared")
        with self._session(immediate=True) as conn:
            current = conn.execute(
                "SELECT role FROM library_members WHERE library_id = ? AND user_id = ?",
                (library_id, member_id),
            ).fetchone()
            if current is None:
                raise api_error(404, "library.memberNotFound", "that person is not in this band")
            if current["role"] == "edit":
                self._keep_an_editor(conn, library_id)
            conn.execute(
                "DELETE FROM library_members WHERE library_id = ? AND user_id = ?",
                (library_id, member_id),
            )

    def _keep_an_editor(self, conn, library_id: str) -> None:
        editors = conn.execute(
            "SELECT count(*) FROM library_members WHERE library_id = ? AND role = 'edit'",
            (library_id,),
        ).fetchone()[0]
        if editors <= 1:
            raise api_error(409, "library.lastEditor", "a band needs at least one person who can edit")

    def _dest(self, user_id: str, library_id: str) -> str:
        return self.require(user_id, library_id, write=True)["id"]

    def copy_song(self, user_id: str, song_id: str, library_id: str) -> dict[str, Any]:
        dest = self._dest(user_id, library_id)
        with self._session() as conn:
            access = song_access(conn, user_id, song_id)
            if access is None:
                raise api_error(404, "song.notFound", "song not found")
            if access[0] == dest:
                raise api_error(409, "library.same", "choose a different library")
            row = conn.execute("SELECT * FROM songs WHERE id = ?", (song_id,)).fetchone()
            size = conn.execute(
                "SELECT COALESCE(SUM(byte_size), 0) FROM media WHERE song_id = ?", (song_id,)
            ).fetchone()[0]
        self._check_quota(dest, int(size))
        new_id = uuid.uuid4().hex
        now = utcnow()
        with self._session(immediate=True) as conn:
            slug = _unique_slug(conn, dest, row["slug"])
            conn.execute(
                """
                INSERT INTO songs (
                    id, owner_id, slug, title, artist, content_kind, source_kind, source_ref, revision,
                    bpm, measure_count, track_count, string_count, preferred_instrument, preferred_track_id,
                    has_sync, duration, document, chordpro, created_at, updated_at, last_opened_at,
                    favourite, difficulty, difficulty_detail, difficulty_version, lyrics_indexed,
                    musical_key, detected_key, key_version, genre, album, year, notes
                ) VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, 1,
                    ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, NULL,
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?
                )
                """,
                (
                    new_id,
                    dest,
                    slug,
                    row["title"],
                    row["artist"],
                    row["content_kind"],
                    row["source_kind"],
                    row["source_ref"],
                    row["bpm"],
                    row["measure_count"],
                    row["track_count"],
                    row["string_count"],
                    row["preferred_instrument"],
                    row["preferred_track_id"],
                    row["has_sync"],
                    row["duration"],
                    row["document"],
                    row["chordpro"],
                    now,
                    now,
                    row["favourite"],
                    row["difficulty"],
                    row["difficulty_detail"],
                    row["difficulty_version"],
                    row["lyrics_indexed"],
                    row["musical_key"],
                    row["detected_key"],
                    row["key_version"],
                    row["genre"],
                    row["album"],
                    row["year"],
                    row["notes"],
                ),
            )
            conn.execute(
                "INSERT INTO song_tags (song_id, tag, tag_key) SELECT ?, tag, tag_key FROM song_tags WHERE song_id = ?",
                (new_id, song_id),
            )
            _index_lyrics(conn, new_id, row["chordpro"])
        try:
            self.media.copy_song_files(song_id, dest, new_id)
        except Exception:
            with self._session() as conn:
                conn.execute("DELETE FROM songs WHERE id = ?", (new_id,))
            raise
        copied = self.songs.get_song(user_id, new_id)
        assert copied is not None
        return copied

    def move_song(self, user_id: str, song_id: str, library_id: str) -> dict[str, Any]:
        dest = self._dest(user_id, library_id)
        with self._session() as conn:
            source = editable_library(conn, user_id, song_id)
            if source is None:
                if can_read(conn, user_id, song_id):
                    raise api_error(403, "library.readOnly", "you can view this song but not change it")
                raise api_error(404, "song.notFound", "song not found")
            if source == dest:
                raise api_error(409, "library.same", "choose a different library")
            row = conn.execute("SELECT slug FROM songs WHERE id = ?", (song_id,)).fetchone()
            old_slug = row["slug"]
        with self._session(immediate=True) as conn:
            slug = _unique_slug(conn, dest, old_slug)
            conn.execute("UPDATE songs SET owner_id = ?, slug = ? WHERE id = ?", (dest, slug, song_id))
            conn.execute("UPDATE song_shares SET library_id = ? WHERE song_id = ?", (dest, song_id))
        try:
            self.media.relocate_song_files(song_id, dest)
        except Exception:
            with self._session() as conn:
                conn.execute("UPDATE songs SET owner_id = ?, slug = ? WHERE id = ?", (source, old_slug, song_id))
                conn.execute("UPDATE song_shares SET library_id = ? WHERE song_id = ?", (source, song_id))
            raise
        moved = self.songs.get_song(user_id, song_id)
        assert moved is not None
        return moved

    def _check_quota(self, library_id: str, incoming: int) -> None:
        quota = self.settings.user_quota_mb * 1024 * 1024
        if quota <= 0 or incoming <= 0:
            return
        used = self.media.usage(library_id)
        if used + incoming > quota:
            raise QuotaExceeded(quota, used)

    # --- share links -------------------------------------------------------

    def _editable_song(self, user_id: str, song_id: str) -> str:
        with self._session() as conn:
            library_id = editable_library(conn, user_id, song_id)
            if library_id is None:
                if can_read(conn, user_id, song_id):
                    raise api_error(403, "library.readOnly", "you can view this song but not change it")
                raise api_error(404, "song.notFound", "song not found")
        return library_id

    def list_shares(self, user_id: str, song_id: str) -> list[dict[str, Any]]:
        self._editable_song(user_id, song_id)
        now = utcnow()
        with self._session() as conn:
            rows = conn.execute(
                """
                SELECT id, prefix, created_at, expires_at FROM song_shares
                WHERE song_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
                ORDER BY created_at DESC, id
                """,
                (song_id, now),
            ).fetchall()
        return [dict(row) for row in rows]

    def create_share(self, user_id: str, song_id: str, expires_in_days: int | None) -> dict[str, Any]:
        if not self.settings.share_links:
            raise api_error(403, "share.disabled", "share links are turned off on this server")
        library_id = self._editable_song(user_id, song_id)
        if expires_in_days is None:
            expires_at = None
        elif 1 <= expires_in_days <= MAX_EXPIRY_DAYS:
            expires_at = _later(expires_in_days)
        else:
            raise api_error(400, "share.badExpiry", "expiry must be between 1 and 3650 days")
        token = SHARE_PREFIX + secrets.token_urlsafe(32)
        share_id = uuid.uuid4().hex
        now = utcnow()
        with self._session(immediate=True) as conn:
            active = conn.execute(
                """
                SELECT count(*) FROM song_shares
                WHERE song_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
                """,
                (song_id, now),
            ).fetchone()[0]
            if active >= MAX_ACTIVE_SHARES:
                raise api_error(409, "share.tooMany", "this song already has as many links as it can")
            conn.execute(
                """
                INSERT INTO song_shares (
                    id, song_id, library_id, created_by, token_hash, prefix, created_at, expires_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (share_id, song_id, library_id, user_id, _hash(token), token[:8], now, expires_at),
            )
        return {
            "id": share_id,
            "prefix": token[:8],
            "token": token,
            "created_at": now,
            "expires_at": expires_at,
        }

    def revoke_share(self, user_id: str, song_id: str, share_id: str) -> bool:
        self._editable_song(user_id, song_id)
        with self._session() as conn:
            cursor = conn.execute(
                """
                UPDATE song_shares SET revoked_at = ?
                WHERE id = ? AND song_id = ? AND revoked_at IS NULL
                """,
                (utcnow(), share_id, song_id),
            )
            return cursor.rowcount > 0

    def open_share(self, token: str) -> dict[str, Any] | None:
        """A redacted song for a live link, or ``None`` for every failure (including the flag being off)."""
        if not self.settings.share_links or not token:
            return None
        now = utcnow()
        with self._session() as conn:
            share = conn.execute(
                """
                SELECT song_id FROM song_shares
                WHERE token_hash = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
                """,
                (_hash(token), now),
            ).fetchone()
            if share is None:
                return None
            row = conn.execute("SELECT * FROM songs WHERE id = ?", (share["song_id"],)).fetchone()
            if row is None:
                return None
            audio = conn.execute(
                "SELECT 1 FROM media WHERE song_id = ? AND kind = 'audio' LIMIT 1", (row["id"],)
            ).fetchone()
        return {"song_id": row["id"], "song": _public_song(row, token, audio is not None)}


def _public_song(row, token: str, has_audio: bool) -> dict[str, Any]:
    """Playback fields only. No ids, notes, tags, catalogue metadata, or source reference."""
    key = row["musical_key"] or row["detected_key"]
    try:
        tracks = json.loads(row["difficulty_detail"] or "[]")
    except json.JSONDecodeError:
        tracks = []
    document = json.loads(row["document"]) if row["document"] else None
    return {
        "id": "shared",
        "library_id": "shared",
        "library_role": "view",
        "slug": "shared",
        "title": row["title"],
        "artist": row["artist"],
        "content_kind": row["content_kind"],
        "source_kind": "shared",
        "source_ref": {},
        "revision": 0,
        "bpm": row["bpm"],
        "measure_count": row["measure_count"],
        "track_count": row["track_count"],
        "string_count": row["string_count"],
        "preferred_instrument": row["preferred_instrument"],
        "preferred_track_id": row["preferred_track_id"],
        "has_sync": bool(row["has_sync"]),
        "has_audio": has_audio,
        "duration": row["duration"],
        "updated_at": row["updated_at"],
        "favourite": False,
        "difficulty": row["difficulty"],
        "tags": [],
        "key": key,
        "key_detected": not row["musical_key"] and row["detected_key"] is not None,
        "genre": "",
        "album": "",
        "year": None,
        "cover_url": None,
        "lyrics_snippet": None,
        "notes": "",
        "document": document,
        "chordpro": row["chordpro"],
        "created_at": row["created_at"],
        "audio_url": f"api/share/{token}/audio" if has_audio else None,
        "difficulty_tracks": tracks,
    }
