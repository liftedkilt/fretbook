"""What the admin dashboard reports: storage per user, orphaned media files, and system information."""

from __future__ import annotations

import os
import platform
import shutil
import time
from pathlib import Path
from typing import Any

from fretbook import __version__
from fretbook.audio.ytdlp_health import status as ytdlp_status
from fretbook.buildinfo import git_sha
from fretbook.config import Settings
from fretbook.db.connection import session

# Owner-keyed tables counted as a user's database rows. Listed by hand so a new table is a deliberate choice.
OWNED_TABLES = (
    "songs",
    "setlists",
    "practice_sessions",
    "practice_exercises",
    "lesson_progress",
    "audio_calibrations",
    "inbox_files",
)

# A file this young may be mid-save (moved in, row not yet inserted), so a sweep leaves it.
ORPHAN_MIN_AGE_SECONDS = 3600


def storage_by_user(settings: Settings) -> list[dict[str, Any]]:
    with session(settings.database_path) as conn:
        users = conn.execute("SELECT id, display_name, external_subject FROM users ORDER BY lower(display_name)")
        media = {
            row["owner_id"]: row
            for row in conn.execute(
                "SELECT owner_id, COUNT(*) AS files, COALESCE(SUM(byte_size), 0) AS bytes FROM media GROUP BY owner_id"
            )
        }
        rows = []
        for user in users.fetchall():
            counts = {
                table: conn.execute(f"SELECT COUNT(*) FROM {table} WHERE owner_id = ?", (user["id"],)).fetchone()[0]  # noqa: S608
                for table in OWNED_TABLES
            }
            found = media.get(user["id"])
            rows.append(
                {
                    "user_id": user["id"],
                    "display_name": user["display_name"],
                    "local": user["external_subject"] is None,
                    "song_count": counts["songs"],
                    "db_rows": sum(counts.values()),
                    "media_files": found["files"] if found else 0,
                    "media_bytes": found["bytes"] if found else 0,
                    "quota_bytes": settings.user_quota_mb * 1024 * 1024 or None,
                }
            )
    return rows


def _orphans(settings: Settings, now: float | None = None) -> tuple[list[tuple[Path, int]], list[Path]]:
    """Files under the media folder no ``media`` row points at, and the directories that are empty."""
    root = settings.media_dir
    if not root.is_dir():
        return [], []
    with session(settings.database_path) as conn:
        known = {row[0] for row in conn.execute("SELECT storage_relpath FROM media")}
    cutoff = (now if now is not None else time.time()) - ORPHAN_MIN_AGE_SECONDS
    files: list[tuple[Path, int]] = []
    empty: list[Path] = []
    for folder, dirs, names in os.walk(root, followlinks=False):
        here = Path(folder)
        if not dirs and not names and here != root:
            empty.append(here)
        for name in names:
            path = here / name
            if path.is_symlink() or not path.is_file():
                continue
            if path.relative_to(root).as_posix() in known:
                continue
            stat = path.stat()
            if stat.st_mtime <= cutoff:
                files.append((path, stat.st_size))
    return files, empty


def orphan_report(settings: Settings) -> dict[str, int]:
    files, empty = _orphans(settings)
    return {"files": len(files), "bytes": sum(size for _, size in files), "empty_dirs": len(empty)}


def clean_orphans(settings: Settings) -> dict[str, int]:
    files, _ = _orphans(settings)
    removed = freed = 0
    for path, size in files:
        try:
            path.unlink()
        except OSError:
            continue
        removed += 1
        freed += size
    root = settings.media_dir
    dirs = 0
    # Deepest first, so a folder that only held empty folders goes too.
    for folder, _dirs, _names in sorted(os.walk(root), key=lambda item: -len(Path(item[0]).parts)):
        here = Path(folder)
        if here != root and not here.is_symlink():
            try:
                here.rmdir()
            except OSError:
                continue
            dirs += 1
    return {"files": removed, "bytes": freed, "empty_dirs": dirs}


def schema_version(settings: Settings) -> int:
    with session(settings.database_path) as conn:
        row = conn.execute("SELECT COALESCE(MAX(version), 0) FROM schema_migrations").fetchone()
    return int(row[0])


def system_info(settings: Settings) -> dict[str, Any]:
    disk = shutil.disk_usage(settings.data_dir)
    database = settings.database_path
    return {
        "version": __version__,
        "commit": git_sha(),
        "schema_version": schema_version(settings),
        "ytdlp_version": ytdlp_status(settings).version,
        "python_version": platform.python_version(),
        "disk_free_bytes": disk.free,
        "disk_total_bytes": disk.total,
        "database_bytes": database.stat().st_size if database.exists() else 0,
        "user_quota_mb": settings.user_quota_mb,
    }
