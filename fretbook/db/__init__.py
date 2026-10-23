"""SQLite connection helpers and versioned SQL migrations."""

from fretbook.db.migrate import DatabaseVersionError, SchemaVersionError, migrate

__all__ = ["DatabaseVersionError", "SchemaVersionError", "migrate"]
