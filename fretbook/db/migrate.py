from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from fretbook.db.connection import connect

MIGRATIONS = Path(__file__).resolve().parent / "migrations"


def utcnow() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def migrate(database_path: Path) -> None:
    """Apply numbered SQL files in ``migrations/`` that have not been recorded."""
    conn = connect(database_path)
    try:
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
        for path in sorted(MIGRATIONS.glob("*.sql")):
            version = int(path.name.split("_", 1)[0])
            if version in applied:
                continue
            conn.executescript(path.read_text(encoding="utf-8"))
            conn.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
                (version, utcnow()),
            )
            conn.commit()
    finally:
        conn.close()
