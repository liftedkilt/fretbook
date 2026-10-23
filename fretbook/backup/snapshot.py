"""``python -m fretbook backup``: a consistent copy of the database and the media folder.

The database goes through SQLite's online backup API, so the copy is
consistent even while the server writes. Media is copied afterwards; a file
added in between is only an unreferenced extra in the snapshot. Run it from
cron or a sidecar container that mounts the data volume.
"""

from __future__ import annotations

import json
import re
import shutil
from datetime import UTC, datetime
from pathlib import Path

from fretbook import __version__
from fretbook.config import Settings
from fretbook.db.connection import connect
from fretbook.db.migrate import backup_database, utcnow

PREFIX = "fretbook-backup-"
_NAME = re.compile(rf"^{PREFIX}\d{{8}}T\d{{6}}Z(-\d+)?$")


class SnapshotError(Exception):
    pass


def take_snapshot(settings: Settings, dest: Path, *, keep: int | None = None) -> Path:
    """Write ``dest/fretbook-backup-<UTC timestamp>/`` and, with ``keep``, prune older snapshots in ``dest``."""
    database = settings.database_path
    if not database.is_file():
        raise SnapshotError(f"no database at {database}")
    dest = dest.expanduser().resolve()
    media_dir = settings.media_dir.resolve()
    if dest == media_dir or media_dir in dest.parents:
        raise SnapshotError("the destination is inside the media folder")
    dest.mkdir(parents=True, exist_ok=True)

    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    final = dest / f"{PREFIX}{stamp}"
    counter = 0
    while final.exists():
        counter += 1
        final = dest / f"{PREFIX}{stamp}-{counter}"
    partial = dest / f".{final.name}.partial"
    shutil.rmtree(partial, ignore_errors=True)
    partial.mkdir()
    try:
        source = connect(database)
        try:
            backup_database(source, partial / "fretbook.sqlite")
            row = source.execute("SELECT COALESCE(MAX(version), 0) FROM schema_migrations").fetchone()
        finally:
            source.close()
        if media_dir.is_dir():
            shutil.copytree(media_dir, partial / "media")
        else:
            (partial / "media").mkdir()
        (partial / "manifest.json").write_text(
            json.dumps(
                {
                    "format": "fretbook-snapshot",
                    "format_version": 1,
                    "app_version": __version__,
                    "schema_version": row[0],
                    "created_at": utcnow(),
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        partial.rename(final)
    except BaseException:
        shutil.rmtree(partial, ignore_errors=True)
        raise
    if keep is not None:
        prune_snapshots(dest, keep)
    return final


def prune_snapshots(dest: Path, keep: int) -> list[Path]:
    """Delete the oldest ``fretbook-backup-*`` folders in ``dest`` so ``keep`` remain. Other files are left alone."""
    snapshots = sorted(path for path in dest.iterdir() if path.is_dir() and _NAME.match(path.name))
    removed = snapshots[: max(len(snapshots) - keep, 0)]
    for path in removed:
        shutil.rmtree(path)
    return removed
