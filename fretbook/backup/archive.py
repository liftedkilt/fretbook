"""The library archive: one zip with every song, its media, and a manifest.

Layout::

    manifest.json                       format, versions, and one entry per song
    songs/<song id>/song.json           a tab, in the same shape as ``/api/songs/<id>/export.json``
    songs/<song id>/song.cho            a chord sheet
    songs/<song id>/media/<media id>.ext  audio and kept uploads

Each manifest entry also lists the song's ``tags`` and its ``favourite`` flag. Archives from before tags
existed have neither, and restore reads that as no tags and not starred.

The archive is written to disk one song at a time and media is copied in chunks
by ``zipfile``, so a large library never sits in memory.
"""

from __future__ import annotations

import json
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fretbook import __version__
from fretbook.config import Settings
from fretbook.db.connection import session
from fretbook.db.migrate import utcnow
from fretbook.storage.media import MediaStore
from fretbook.storage.practice import PracticeRepository
from fretbook.storage.repository import SongRepository
from fretbook.storage.setlists import SetlistRepository

FORMAT = "fretbook-library"
FORMAT_VERSION = 1
MANIFEST = "manifest.json"
# Audio is already compressed; deflating it again only costs time.
_STORED = {".mp3", ".m4a", ".ogg", ".flac", ".webm"}


@dataclass
class ArchiveSummary:
    songs: int
    media: int
    missing_media: int


def _media_suffix(filename: str) -> str:
    suffix = Path(filename).suffix.lower()[:12]
    return suffix if re.fullmatch(r"\.[a-z0-9]+", suffix or "") else ".bin"


def write_archive(
    settings: Settings,
    songs: SongRepository,
    media: MediaStore,
    dest: Path,
    *,
    owner_id: str | None,
) -> ArchiveSummary:
    """Write the archive to ``dest``. ``owner_id=None`` exports every user's songs (admins only)."""
    with session(settings.database_path) as conn:
        query = "SELECT id, owner_id FROM songs"
        rows = conn.execute(
            f"{query} WHERE owner_id = ? ORDER BY created_at, id" if owner_id else f"{query} ORDER BY created_at, id",
            (owner_id,) if owner_id else (),
        ).fetchall()
        schema_version = conn.execute("SELECT COALESCE(MAX(version), 0) FROM schema_migrations").fetchone()[0]
        users = (
            []
            if owner_id
            else [
                {"id": row["id"], "display_name": row["display_name"], "email": row["email"]}
                for row in conn.execute("SELECT id, display_name, email FROM users ORDER BY created_at, id")
            ]
        )

    entries: list[dict[str, Any]] = []
    media_count = 0
    missing = 0
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
        for row in rows:
            song = songs.get_song(row["owner_id"], row["id"])
            if song is None:  # deleted while the export ran
                continue
            base = f"songs/{song['id']}"
            if song["content_kind"] == "tab":
                member = f"{base}/song.json"
                payload = {
                    "format": "fretbook-song",
                    "format_version": 1,
                    "content_kind": "tab",
                    "title": song["title"],
                    "artist": song["artist"],
                    "document": song["document"],
                }
                archive.writestr(member, json.dumps(payload, ensure_ascii=False, indent=2))
            else:
                member = f"{base}/song.cho"
                archive.writestr(member, song["chordpro"] or "")
            files: list[dict[str, Any]] = []
            for media_row in _media_rows(settings, song["id"]):
                path = media.path_for(media_row)
                if not path.is_file():
                    missing += 1
                    continue
                suffix = _media_suffix(media_row["filename"])
                arcname = f"{base}/media/{media_row['id']}{suffix}"
                compression = zipfile.ZIP_STORED if suffix in _STORED else zipfile.ZIP_DEFLATED
                archive.write(path, arcname, compress_type=compression)
                files.append(
                    {
                        "kind": media_row["kind"],
                        "filename": media_row["filename"],
                        "content_type": media_row["content_type"],
                        "path": arcname,
                    }
                )
                media_count += 1
            entry: dict[str, Any] = {
                "id": song["id"],
                "title": song["title"],
                "artist": song["artist"],
                "content_kind": song["content_kind"],
                "source_kind": song["source_kind"],
                "source_ref": song["source_ref"],
                "created_at": song["created_at"],
                "updated_at": song["updated_at"],
                "file": member,
                "media": files,
                "tags": song["tags"],
                "favourite": song["favourite"],
            }
            if owner_id is None:
                entry["owner_id"] = row["owner_id"]
            entries.append(entry)
        manifest: dict[str, Any] = {
            "format": FORMAT,
            "format_version": FORMAT_VERSION,
            "app_version": __version__,
            "schema_version": schema_version,
            "exported_at": utcnow(),
            "scope": "user" if owner_id else "all",
            "songs": entries,
        }
        # Additive: older readers ignore the key, so FORMAT_VERSION stays 1.
        manifest["setlists"] = [
            {
                "id": setlist["id"],
                "name": setlist["name"],
                "entries": [
                    {"song_id": item["song_id"], "note": item["note"], "transpose": item["transpose"]}
                    for item in setlist["entries"]
                ],
            }
            for setlist in SetlistRepository(settings).export_all(owner_id)
        ]
        # Additive too. Sessions name their song by archive id; a single user's goal rides along.
        manifest["practice"] = PracticeRepository(settings).export_all(owner_id)
        if users:
            manifest["users"] = users
        archive.writestr(MANIFEST, json.dumps(manifest, ensure_ascii=False, indent=2))
    return ArchiveSummary(songs=len(entries), media=media_count, missing_media=missing)


def _media_rows(settings: Settings, song_id: str) -> list[dict[str, Any]]:
    with session(settings.database_path) as conn:
        return [
            dict(row)
            for row in conn.execute("SELECT * FROM media WHERE song_id = ? ORDER BY created_at, id", (song_id,))
        ]
