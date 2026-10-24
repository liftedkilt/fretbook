"""Audio and other files, stored beside the SQLite database under ``media/<owner>/<song>/``."""

from __future__ import annotations

import re
import shutil
import sqlite3
import uuid
from pathlib import Path

from fretbook.config import Settings
from fretbook.db.connection import session
from fretbook.db.migrate import utcnow

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


class MediaStore:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.root = settings.media_dir

    def _session(self):
        return session(self.settings.database_path)

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
        """Move ``source`` into the media store and record it. With ``replace_kind``, older files of this kind go."""
        _check_id(owner_id, "owner id")
        _check_id(song_id, "song id")
        _check_id(kind, "media kind")
        media_id = uuid.uuid4().hex
        suffix = Path(filename).suffix.lower()[:12]
        if not re.fullmatch(r"\.[a-z0-9]+", suffix or ""):
            suffix = ".bin"
        relative = Path(owner_id) / song_id / f"{kind}-{media_id}{suffix}"
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
                        owner_id,
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
            self.delete_kind(owner_id, song_id, kind, keep=media_id)
        return {"id": media_id, "kind": kind, "filename": Path(filename).name}

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
        with self._session() as conn:
            row = conn.execute(
                """
                SELECT * FROM media
                WHERE owner_id = ? AND song_id = ? AND kind = 'audio'
                ORDER BY created_at DESC LIMIT 1
                """,
                (owner_id, song_id),
            ).fetchone()
        return dict(row) if row else None

    def stems_for(self, owner_id: str, song_id: str) -> list[dict[str, str]]:
        """The newest file of each stem kind (``stem-bass``, ...), oldest kind first."""
        with self._session() as conn:
            rows = conn.execute(
                """
                SELECT * FROM media
                WHERE owner_id = ? AND song_id = ? AND kind LIKE 'stem-%'
                ORDER BY created_at DESC, id
                """,
                (owner_id, song_id),
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
        with self._session() as conn:
            rows = conn.execute(
                "SELECT * FROM media WHERE owner_id = ? AND song_id = ? AND kind = ? AND id != ?",
                (owner_id, song_id, kind, keep or ""),
            ).fetchall()
            conn.execute(
                "DELETE FROM media WHERE owner_id = ? AND song_id = ? AND kind = ? AND id != ?",
                (owner_id, song_id, kind, keep or ""),
            )
        for row in rows:
            self.path_for(row).unlink(missing_ok=True)

    def delete_song_files(self, owner_id: str, song_id: str) -> None:
        with self._session() as conn:
            rows = conn.execute(
                "SELECT * FROM media WHERE owner_id = ? AND song_id = ?",
                (owner_id, song_id),
            ).fetchall()
        for row in rows:
            self.path_for(row).unlink(missing_ok=True)
        folder = self.root / _check_id(owner_id, "owner id") / _check_id(song_id, "song id")
        if folder.is_dir():
            shutil.rmtree(folder)
