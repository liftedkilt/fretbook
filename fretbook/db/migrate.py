from __future__ import annotations

import logging
import re
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from fretbook.db.connection import connect

logger = logging.getLogger("fretbook.db")

MIGRATIONS = Path(__file__).resolve().parent / "migrations"
_BACKUP_PATTERN = re.compile(r"^pre-migrate-(\d+)-(\d+)-(.+)\.sqlite$")


class DatabaseVersionError(RuntimeError):
    """Raised when the database has a schema version newer than the running code."""


SchemaVersionError = DatabaseVersionError


SchemaVersionError = DatabaseVersionError


def utcnow() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def get_available_migrations() -> list[tuple[int, Path]]:
    """Return sorted (version, path) pairs for all migrations in MIGRATIONS."""
    results: list[tuple[int, Path]] = []
    for path in sorted(MIGRATIONS.glob("*.sql")):
        try:
            version = int(path.name.split("_", 1)[0])
        except ValueError:
            continue
        results.append((version, path))
    return results


def backup_database(src_conn: sqlite3.Connection, target_path: Path) -> None:
    """Take a consistent SQLite online snapshot from src_conn to target_path."""
    target_path.parent.mkdir(parents=True, exist_ok=True)
    temp_target = target_path.with_name(f"{target_path.name}.tmp")
    if temp_target.exists():
        temp_target.unlink()

    dst = sqlite3.connect(temp_target)
    try:
        src_conn.backup(dst)
    except Exception:
        dst.close()
        temp_target.unlink(missing_ok=True)
        raise
    else:
        dst.close()
        temp_target.replace(target_path)


def prune_old_backups(backups_dir: Path, keep: int = 5) -> list[Path]:
    """Delete oldest pre-migrate-*.sqlite files in backups_dir so only keep remain."""
    if keep <= 0 or not backups_dir.is_dir():
        return []
    backups: list[Path] = []
    for p in backups_dir.iterdir():
        if p.is_file() and _BACKUP_PATTERN.match(p.name):
            backups.append(p)
    backups.sort(key=lambda p: (p.stat().st_mtime_ns, p.name))
    removed: list[Path] = []
    if len(backups) > keep:
        to_delete = backups[: len(backups) - keep]
        for p in to_delete:
            p.unlink(missing_ok=True)
            removed.append(p)
            logger.info("Pruned old migration backup %s", p.name)
    return removed


def create_pre_migration_backup(
    conn: sqlite3.Connection,
    backups_dir: Path,
    from_version: int,
    to_version: int,
    *,
    timestamp: str | None = None,
    keep: int = 5,
) -> Path:
    """Create a consistent pre-migration backup and prune old backups."""
    backups_dir.mkdir(parents=True, exist_ok=True)
    if timestamp is None:
        timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")

    filename = f"pre-migrate-{from_version}-{to_version}-{timestamp}.sqlite"
    target_path = backups_dir / filename
    if target_path.exists():
        counter = 1
        while (backups_dir / f"pre-migrate-{from_version}-{to_version}-{timestamp}-{counter}.sqlite").exists():
            counter += 1
        target_path = backups_dir / f"pre-migrate-{from_version}-{to_version}-{timestamp}-{counter}.sqlite"

    backup_database(conn, target_path)
    prune_old_backups(backups_dir, keep=keep)
    return target_path


def migrate(
    database_path: Path,
    *,
    target_version: int | None = None,
    backups_dir: Path | None = None,
    backup_dir: Path | None = None,
    backup_keep: int = 5,
) -> Path | None:
    """Apply numbered SQL files in ``migrations/`` that have not been recorded.

    Each file runs in one transaction together with its ``schema_migrations``
    row, so a failing migration leaves neither a half-applied schema nor a
    record. Run one server process per database: two would race here.

    Before applying pending migrations to an existing database, a consistent SQLite
    online backup is created in backups_dir (defaulting to database_path.parent / "backups"),
    retaining the last backup_keep backups.

    Refuses to start if the database schema version is newer than the highest
    migration supported by this version of Fretbook.
    """
    db_existed = database_path.is_file() and database_path.stat().st_size > 0

    available = get_available_migrations()
    max_code_version = max((v for v, _ in available), default=0)

    conn = connect(database_path)
    try:
        # WAL is a property of the database file, so setting it once is enough.
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            )
            """
        )
        conn.commit()
        applied = {row[0] for row in conn.execute("SELECT version FROM schema_migrations")}
        max_applied_version = max(applied, default=0)

        if max_applied_version > max_code_version:
            msg = (
                f"Database schema version {max_applied_version} is newer than "
                f"the highest migration supported by this version of Fretbook ({max_code_version}). "
                f"Refusing to start."
            )
            logger.error(msg)
            raise DatabaseVersionError(msg)

        pending = [(v, p) for v, p in available if v not in applied]
        if target_version is not None:
            pending = [(v, p) for v, p in pending if v <= target_version]

        if not pending:
            return None

        backup_path: Path | None = None
        if db_existed or max_applied_version > 0:
            dest_dir = backups_dir or backup_dir or (database_path.parent / "backups")
            from_v = max_applied_version
            to_v = max(v for v, _ in pending)
            backup_path = create_pre_migration_backup(
                conn,
                backups_dir=dest_dir,
                from_version=from_v,
                to_version=to_v,
                keep=backup_keep,
            )
            logger.info("Created pre-migration backup at %s (from=%d, to=%d)", backup_path, from_v, to_v)

        for version, path in pending:
            script = (
                "BEGIN;\n"
                + path.read_text(encoding="utf-8")
                + f"\nINSERT INTO schema_migrations (version, applied_at) VALUES ({version}, '{utcnow()}');\n"
                + "COMMIT;\n"
            )
            try:
                conn.executescript(script)
            except sqlite3.Error:
                if conn.in_transaction:
                    conn.execute("ROLLBACK")
                raise

        return backup_path
    finally:
        conn.close()
