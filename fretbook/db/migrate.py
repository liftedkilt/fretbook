from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from fretbook.db.connection import connect

MIGRATIONS = Path(__file__).resolve().parent / "migrations"


def utcnow() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def migrate(database_path: Path) -> None:
    """Apply numbered SQL files in ``migrations/`` that have not been recorded.

    Each file runs in one transaction together with its ``schema_migrations``
    row, so a failing migration leaves neither a half-applied schema nor a
    record. Run one server process per database: two would race here.
    """
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
        for path in sorted(MIGRATIONS.glob("*.sql")):
            version = int(path.name.split("_", 1)[0])
            if version in applied:
                continue
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
    finally:
        conn.close()
