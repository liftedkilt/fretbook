"""Audio and other files, stored beside the SQLite database under ``media/<owner>/<song>/``."""

from __future__ import annotations

import re
import shutil
import sqlite3
import uuid
from pathlib import Path

from fretbook.api.errors import api_error
from fretbook.config import Settings
from fretbook.db.connection import session
from fretbook.db.migrate import utcnow
from fretbook.storage.access import song_access

# Served back with this type, so it is chosen from the extension rather than taken from a client or an archive.
AUDIO_TYPES = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
    ".flac": "audio/flac",
    ".webm": "audio/webm",
}

_SAFE_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")


def _check_id(value: str, what: str) -> str:
    # Ids become directory names. users.id is internal (never an OIDC sub), but check anyway.
    if not _SAFE_ID.fullmatch(value):
        raise ValueError(f"{what} {value!r} cannot be used in a media path")
    return value


class QuotaExceeded(Exception):
    """A save would take a user over ``FRETBOOK_USER_QUOTA_MB``. ``key`` and ``params`` make it translatable."""

    key = "storage.quotaExceeded"

    def __init__(self, quota_bytes: int, used_bytes: int) -> None:
        super().__init__("your storage quota is full")
        self.params = {"quota_bytes": quota_bytes, "used_bytes": used_bytes}


class MediaStore:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.root = settings.media_dir

    def _session(self, *, immediate: bool = False):
        return session(self.settings.database_path, immediate=immediate)

    def _library(self, actor_id: str, song_id: str, *, write: bool) -> str | None:
        """The library that owns the song when ``actor_id`` may use it.

        A song that does not exist yet keeps ``actor_id`` (imports record the file after the row, and a
        missing id must not be treated as someone else's song). A song the actor cannot see is ``None``.
        """
        with self._session() as conn:
            access = song_access(conn, actor_id, song_id)
            if access is None:
                exists = conn.execute("SELECT 1 FROM songs WHERE id = ?", (song_id,)).fetchone()
                return None if exists else actor_id
            library_id, role = access
            if write and role != "edit":
                return None
            return library_id

    def save_file(
        self,
        owner_id: str,
        song_id: str,
        *,
        kind: str,
        filename: str,
        content_type: str,
        source: Path,
        replace_kind: bool = False,
    ) -> dict[str, str]:
        """Move ``source`` into the media store and record it. With ``replace_kind``, older files of this kind go.

        ``owner_id`` is the caller. The file is stored under the song's library when the caller may edit it.
        """
        library_id = self._library(owner_id, song_id, write=True)
        if library_id is None:
            raise api_error(403, "library.readOnly", "you can view this song but not change it")
        _check_id(library_id, "owner id")
        _check_id(song_id, "song id")
        _check_id(kind, "media kind")
        self._check_quota(library_id, source.stat().st_size, song_id=song_id if replace_kind else None, kind=kind)
        media_id = uuid.uuid4().hex
        suffix = Path(filename).suffix.lower()[:12]
        if not re.fullmatch(r"\.[a-z0-9]+", suffix or ""):
            suffix = ".bin"
        relative = Path(library_id) / song_id / f"{kind}-{media_id}{suffix}"
        dest = self.root / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(source), dest)
        size = dest.stat().st_size
        try:
            with self._session() as conn:
                conn.execute(
                    """
                    INSERT INTO media (
                        id, owner_id, song_id, kind, filename, content_type,
                        storage_relpath, byte_size, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        media_id,
                        library_id,
                        song_id,
                        kind,
                        Path(filename).name,
                        content_type,
                        relative.as_posix(),
                        size,
                        utcnow(),
                    ),
                )
        except sqlite3.Error:
            dest.unlink(missing_ok=True)
            raise
        # Remove the old file only once the new one is safely recorded.
        if replace_kind:
            self.delete_kind(library_id, song_id, kind, keep=media_id)
        return {"id": media_id, "kind": kind, "filename": Path(filename).name}

    def usage(self, owner_id: str) -> int:
        """Bytes of media the user stores."""
        with self._session() as conn:
            row = conn.execute("SELECT COALESCE(SUM(byte_size), 0) FROM media WHERE owner_id = ?", (owner_id,))
            return int(row.fetchone()[0])

    def _check_quota(self, owner_id: str, incoming: int, *, song_id: str | None, kind: str) -> None:
        quota = self.settings.user_quota_mb * 1024 * 1024
        if quota <= 0:
            return
        used = self.usage(owner_id)
        replaced = 0
        if song_id is not None:
            with self._session() as conn:
                row = conn.execute(
                    "SELECT COALESCE(SUM(byte_size), 0) FROM media WHERE owner_id = ? AND song_id = ? AND kind = ?",
                    (owner_id, song_id, kind),
                )
                replaced = int(row.fetchone()[0])
        if used - replaced + incoming > quota:
            raise QuotaExceeded(quota, used)

    def save(
        self,
        owner_id: str,
        song_id: str,
        *,
        kind: str,
        filename: str,
        content_type: str,
        data: bytes,
        replace_kind: bool = False,
    ) -> dict[str, str]:
        staging = self.settings.inbox_dir / f"media-{uuid.uuid4().hex}"
        staging.parent.mkdir(parents=True, exist_ok=True)
        staging.write_bytes(data)
        try:
            return self.save_file(
                owner_id,
                song_id,
                kind=kind,
                filename=filename,
                content_type=content_type,
                source=staging,
                replace_kind=replace_kind,
            )
        finally:
            staging.unlink(missing_ok=True)

    def audio_for(self, owner_id: str, song_id: str) -> dict[str, str] | None:
        if self._library(owner_id, song_id, write=False) is None:
            return None
        return self.file_for_song(song_id, "audio")

    def file_for_song(self, song_id: str, kind: str) -> dict[str, str] | None:
        """The newest file of ``kind`` for a song the caller has already been allowed to see."""
        with self._session() as conn:
            row = conn.execute(
                """
                SELECT * FROM media
                WHERE song_id = ? AND kind = ?
                ORDER BY created_at DESC LIMIT 1
                """,
                (song_id, kind),
            ).fetchone()
        return dict(row) if row else None

    def latest_of_kind(self, owner_id: str, song_id: str, kind: str) -> dict[str, str] | None:
        if self._library(owner_id, song_id, write=False) is None:
            return None
        return self.file_for_song(song_id, kind)

    def stems_for(self, owner_id: str, song_id: str) -> list[dict[str, str]]:
        """The newest file of each stem kind (``stem-bass``, ...), oldest kind first."""
        if self._library(owner_id, song_id, write=False) is None:
            return []
        with self._session() as conn:
            rows = conn.execute(
                """
                SELECT * FROM media
                WHERE song_id = ? AND kind LIKE 'stem-%'
                ORDER BY created_at DESC, id
                """,
                (song_id,),
            ).fetchall()
        newest: dict[str, dict[str, str]] = {}
        for row in rows:
            newest.setdefault(row["kind"], dict(row))
        return sorted(newest.values(), key=lambda item: item["kind"])

    def delete_stems(self, owner_id: str, song_id: str) -> None:
        for row in self.stems_for(owner_id, song_id):
            self.delete_kind(owner_id, song_id, row["kind"])

    def path_for(self, row: dict[str, str] | sqlite3.Row) -> Path:
        path = (self.root / str(row["storage_relpath"])).resolve()
        if not path.is_relative_to(self.root.resolve()):
            raise ValueError("media path escapes the data directory")
        return path

    def delete_kind(self, owner_id: str, song_id: str, kind: str, *, keep: str | None = None) -> None:
        library_id = self._library(owner_id, song_id, write=True)
        if library_id is None:
            return
        with self._session() as conn:
            rows = conn.execute(
                "SELECT * FROM media WHERE song_id = ? AND kind = ? AND id != ?",
                (song_id, kind, keep or ""),
            ).fetchall()
            conn.execute(
                "DELETE FROM media WHERE song_id = ? AND kind = ? AND id != ?",
                (song_id, kind, keep or ""),
            )
        for row in rows:
            self.path_for(row).unlink(missing_ok=True)

    def delete_song_files(self, owner_id: str, song_id: str) -> None:
        library_id = self._library(owner_id, song_id, write=True)
        if library_id is None:
            return
        with self._session() as conn:
            rows = conn.execute("SELECT * FROM media WHERE song_id = ?", (song_id,)).fetchall()
        folders: set[Path] = set()
        for row in rows:
            path = self.path_for(row)
            path.unlink(missing_ok=True)
            folders.add(path.parent)
        folders.add(self.root / _check_id(library_id, "owner id") / _check_id(song_id, "song id"))
        root = self.root.resolve()
        for folder in folders:
            resolved = folder.resolve()
            if resolved != root and resolved.is_relative_to(root) and resolved.is_dir():
                shutil.rmtree(resolved)

    def copy_song_files(self, song_id: str, dest_library: str, dest_song: str) -> None:
        """Copy every file of a song the caller already decided may be copied."""
        _check_id(dest_library, "owner id")
        _check_id(dest_song, "song id")
        with self._session() as conn:
            rows = conn.execute("SELECT * FROM media WHERE song_id = ?", (song_id,)).fetchall()
        written: list[Path] = []
        try:
            with self._session(immediate=True) as conn:
                for row in rows:
                    source = self.path_for(row)
                    if not source.is_file():
                        continue
                    media_id = uuid.uuid4().hex
                    suffix = source.suffix.lower()[:12]
                    if not re.fullmatch(r"\.[a-z0-9]+", suffix or ""):
                        suffix = ".bin"
                    relative = Path(dest_library) / dest_song / f"{row['kind']}-{media_id}{suffix}"
                    dest = self.root / relative
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(source, dest)
                    written.append(dest)
                    conn.execute(
                        """
                        INSERT INTO media (
                            id, owner_id, song_id, kind, filename, content_type,
                            storage_relpath, byte_size, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            media_id,
                            dest_library,
                            dest_song,
                            row["kind"],
                            row["filename"],
                            row["content_type"],
                            relative.as_posix(),
                            dest.stat().st_size,
                            utcnow(),
                        ),
                    )
        except Exception:
            for path in written:
                path.unlink(missing_ok=True)
            raise

    def relocate_song_files(self, song_id: str, library_id: str) -> None:
        """Move a song's files under ``library_id`` and point the rows at the new paths."""
        _check_id(library_id, "owner id")
        _check_id(song_id, "song id")
        with self._session() as conn:
            rows = list(conn.execute("SELECT * FROM media WHERE song_id = ?", (song_id,)))
        moved: list[tuple[Path, Path]] = []
        try:
            with self._session(immediate=True) as conn:
                for row in rows:
                    source = self.path_for(row)
                    relative = Path(library_id) / song_id / source.name
                    dest = self.root / relative
                    if source.is_file() and source.resolve() != dest.resolve():
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        shutil.move(str(source), dest)
                        moved.append((dest, source))
                    conn.execute(
                        "UPDATE media SET owner_id = ?, storage_relpath = ? WHERE id = ?",
                        (library_id, relative.as_posix(), row["id"]),
                    )
        except Exception:
            for dest, source in reversed(moved):
                if dest.exists() and not source.exists():
                    source.parent.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(dest), source)
            raise
