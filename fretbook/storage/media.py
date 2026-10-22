"""Audio and other files, stored beside the SQLite database."""

from __future__ import annotations

import sqlite3
import uuid
from pathlib import Path

from fretbook.config import Settings
from fretbook.db.connection import connect
from fretbook.db.migrate import utcnow


class MediaStore:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.root = settings.media_dir

    def _conn(self) -> sqlite3.Connection:
        return connect(self.settings.database_path)

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
        if replace_kind:
            self.delete_kind(owner_id, song_id, kind)
        media_id = uuid.uuid4().hex
        suffix = Path(filename).suffix.lower()[:12]
        if not suffix or any(ch not in ".abcdefghijklmnopqrstuvwxyz0123456789" for ch in suffix):
            suffix = ".bin"
        relative = Path(owner_id) / song_id / f"{kind}-{media_id}{suffix}"
        dest = self.root / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        with self._conn() as conn:
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
                    len(data),
                    utcnow(),
                ),
            )
        return {"id": media_id, "kind": kind, "filename": Path(filename).name}

    def audio_for(self, owner_id: str, song_id: str) -> dict[str, str] | None:
        with self._conn() as conn:
            row = conn.execute(
                """
                SELECT * FROM media
                WHERE owner_id = ? AND song_id = ? AND kind = 'audio'
                ORDER BY created_at DESC LIMIT 1
                """,
                (owner_id, song_id),
            ).fetchone()
        if row is None:
            return None
        return dict(row)

    def path_for(self, row: dict[str, str] | sqlite3.Row) -> Path:
        relative = Path(str(row["storage_relpath"]))
        path = (self.root / relative).resolve()
        root = self.root.resolve()
        if not path.is_relative_to(root):
            raise ValueError("media path escapes the data directory")
        return path

    def delete_kind(self, owner_id: str, song_id: str, kind: str) -> None:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM media WHERE owner_id = ? AND song_id = ? AND kind = ?",
                (owner_id, song_id, kind),
            ).fetchall()
            conn.execute(
                "DELETE FROM media WHERE owner_id = ? AND song_id = ? AND kind = ?",
                (owner_id, song_id, kind),
            )
        for row in rows:
            path = self.path_for(row)
            if path.is_file():
                path.unlink()

    def delete_song_files(self, owner_id: str, song_id: str) -> None:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM media WHERE owner_id = ? AND song_id = ?",
                (owner_id, song_id),
            ).fetchall()
        for row in rows:
            path = self.path_for(row)
            if path.is_file():
                path.unlink()
        folder = self.root / owner_id / song_id
        if folder.is_dir():
            for child in folder.iterdir():
                if child.is_file():
                    child.unlink()
            folder.rmdir()
