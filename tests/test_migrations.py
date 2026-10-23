from __future__ import annotations

import json
import logging
import sqlite3
import sys
from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fretbook.app import create_app
from fretbook.config import Settings
from fretbook.db.connection import connect
from fretbook.db.migrate import (
    _BACKUP_PATTERN,
    DatabaseVersionError,
    backup_database,
    get_available_migrations,
    migrate,
    prune_old_backups,
)


def seed_v1(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        INSERT INTO users (id, external_subject, display_name, default_instrument, created_at)
        VALUES ('user-v1', 'sub-v1', 'Alice V1', 'bass-4', '2026-01-01T00:00:00Z')
        """
    )
    conn.execute(
        """
        INSERT INTO songs (
            id, owner_id, slug, title, artist, content_kind, source_kind, source_ref,
            revision, bpm, measure_count, track_count, string_count, preferred_instrument,
            preferred_track_id, has_sync, duration, document, chordpro, created_at, updated_at
        ) VALUES (
            'song-tab-v1', 'user-v1', 'tab-v1', 'Tab Song V1', 'Artist V1', 'tab', 'scratch', '{}',
            1, 120.0, 4, 1, 4, 'bass-4', 't1', 1, 15.5, '{"bars": []}', NULL,
            '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
        )
        """
    )
    conn.execute(
        """
        INSERT INTO songs (
            id, owner_id, slug, title, artist, content_kind, source_kind, source_ref,
            revision, bpm, measure_count, track_count, string_count, preferred_instrument,
            preferred_track_id, has_sync, duration, document, chordpro, created_at, updated_at
        ) VALUES (
            'song-chords-v1', 'user-v1', 'chords-v1', 'Chords Song V1', 'Artist V1', 'chords', 'manual', '{}',
            2, 0.0, 0, 0, 0, '', '', 0, NULL, NULL, '[C]Hello [G]world',
            '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
        )
        """
    )
    conn.execute(
        """
        INSERT INTO media (
            id, owner_id, song_id, kind, filename, content_type, storage_relpath, byte_size, created_at
        ) VALUES (
            'media-v1', 'user-v1', 'song-tab-v1', 'audio', 'audio.mp3', 'audio/mpeg',
            'media/user-v1/song-tab-v1/audio.mp3', 1024, '2026-01-01T00:00:00Z'
        )
        """
    )
    conn.execute(
        """
        INSERT INTO jobs (
            id, owner_id, kind, status, payload, result, error, error_key, error_params,
            progress, progress_key, attempts, created_at, updated_at
        ) VALUES (
            'job-v1', 'user-v1', 'import', 'done', '{"url": "https://example.com"}',
            '{"song_id": "song-tab-v1"}', NULL, '', '{}', '100%', '', 1,
            '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
        )
        """
    )
    conn.commit()


def verify_v1(conn: sqlite3.Connection) -> None:
    # Verify user survives and receives migration 002 defaults
    user = conn.execute("SELECT * FROM users WHERE id = 'user-v1'").fetchone()
    assert user is not None
    assert user["external_subject"] == "sub-v1"
    assert user["display_name"] == "Alice V1"
    assert user["default_instrument"] == "bass-4"
    assert user["created_at"] == "2026-01-01T00:00:00Z"
    assert user["email"] == ""
    assert user["role"] == "user"
    assert user["last_login_at"] is None

    # Verify tab song
    tab = conn.execute("SELECT * FROM songs WHERE id = 'song-tab-v1'").fetchone()
    assert tab is not None
    assert tab["title"] == "Tab Song V1"
    assert tab["content_kind"] == "tab"
    assert tab["has_sync"] == 1
    assert tab["duration"] == 15.5
    assert tab["document"] == '{"bars": []}'

    # Verify chords song
    chords = conn.execute("SELECT * FROM songs WHERE id = 'song-chords-v1'").fetchone()
    assert chords is not None
    assert chords["title"] == "Chords Song V1"
    assert chords["content_kind"] == "chords"
    assert chords["chordpro"] == "[C]Hello [G]world"

    # Verify media
    media = conn.execute("SELECT * FROM media WHERE id = 'media-v1'").fetchone()
    assert media is not None
    assert media["filename"] == "audio.mp3"
    assert media["byte_size"] == 1024

    # Verify job
    job = conn.execute("SELECT * FROM jobs WHERE id = 'job-v1'").fetchone()
    assert job is not None
    assert job["status"] == "done"
    assert job["result"] == '{"song_id": "song-tab-v1"}'

    # Database integrity and foreign key checks
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"


def seed_v2(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        INSERT INTO users (
            id, external_subject, display_name, default_instrument, email, role, last_login_at, created_at
        ) VALUES (
            'user-v2-admin', 'sub-admin', 'Admin V2', 'bass-4', 'admin@example.com', 'admin',
            '2026-01-02T10:00:00Z', '2026-01-02T00:00:00Z'
        )
        """
    )
    conn.execute(
        """
        INSERT INTO users (
            id, external_subject, display_name, default_instrument, email, role, last_login_at, created_at
        ) VALUES (
            'user-v2-user', 'sub-user', 'User V2', 'guitar-6', 'user@example.com', 'user',
            NULL, '2026-01-02T00:00:00Z'
        )
        """
    )
    conn.execute(
        """
        INSERT INTO sessions (
            token_hash, user_id, role, id_token, created_at, expires_at
        ) VALUES (
            'hash-admin', 'user-v2-admin', 'admin', 'jwt-id-token',
            '2026-01-02T10:00:00Z', '2026-01-09T10:00:00Z'
        )
        """
    )
    conn.execute(
        """
        INSERT INTO songs (
            id, owner_id, slug, title, artist, content_kind, source_kind, source_ref,
            revision, bpm, measure_count, track_count, string_count, preferred_instrument,
            preferred_track_id, has_sync, duration, document, chordpro, created_at, updated_at
        ) VALUES (
            'song-v2', 'user-v2-admin', 'song-v2', 'V2 Title', 'V2 Artist', 'tab', 'scratch', '{}',
            1, 140.0, 8, 2, 4, 'bass-4', 't1', 0, 20.0, '{"bars": []}', NULL,
            '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z'
        )
        """
    )
    conn.commit()


def verify_v2(conn: sqlite3.Connection) -> None:
    admin = conn.execute("SELECT * FROM users WHERE id = 'user-v2-admin'").fetchone()
    assert admin is not None
    assert admin["email"] == "admin@example.com"
    assert admin["role"] == "admin"
    assert admin["last_login_at"] == "2026-01-02T10:00:00Z"

    user = conn.execute("SELECT * FROM users WHERE id = 'user-v2-user'").fetchone()
    assert user is not None
    assert user["email"] == "user@example.com"
    assert user["role"] == "user"
    assert user["last_login_at"] is None

    session = conn.execute("SELECT * FROM sessions WHERE token_hash = 'hash-admin'").fetchone()
    assert session is not None
    assert session["user_id"] == "user-v2-admin"
    assert session["role"] == "admin"
    assert session["id_token"] == "jwt-id-token"

    song = conn.execute("SELECT * FROM songs WHERE id = 'song-v2'").fetchone()
    assert song is not None
    assert song["title"] == "V2 Title"
    # Songs that predate the search migration are backfilled into the index and have never been opened.
    assert song["last_opened_at"] is None
    hit = conn.execute("SELECT song_id FROM songs_fts WHERE songs_fts MATCH 'v2'").fetchall()
    assert [row[0] for row in hit] == ["song-v2"]

    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"


def seed_v3(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        INSERT INTO users (id, external_subject, display_name, created_at)
        VALUES ('user-v3', 'sub-v3', 'User V3', '2026-01-03T00:00:00Z')
        """
    )
    conn.execute(
        """
        INSERT INTO songs (
            id, owner_id, slug, title, artist, content_kind, source_kind, source_ref,
            revision, bpm, measure_count, track_count, string_count, preferred_instrument,
            preferred_track_id, has_sync, duration, document, chordpro, created_at, updated_at
        ) VALUES (
            'song-v3', 'user-v3', 'song-v3', 'Résumé Blues', 'V3 Artist', 'chords', 'manual', '{}',
            1, 0.0, 0, 0, 0, '', '', 0, NULL, NULL, '[C]Yo',
            '2026-01-03T00:00:00Z', '2026-01-03T00:00:00Z'
        )
        """
    )
    conn.commit()


def verify_v3(conn: sqlite3.Connection) -> None:
    assert conn.execute("SELECT last_opened_at FROM songs WHERE id = 'song-v3'").fetchone()[0] is None
    # Diacritics fold, and the triggers keep the index in step with writes.
    assert conn.execute("SELECT song_id FROM songs_fts WHERE songs_fts MATCH 'resume'").fetchone()[0] == "song-v3"
    conn.execute("UPDATE songs SET title = 'Renamed' WHERE id = 'song-v3'")
    assert conn.execute("SELECT count(*) FROM songs_fts WHERE songs_fts MATCH 'resume'").fetchone()[0] == 0
    assert conn.execute("SELECT song_id FROM songs_fts WHERE songs_fts MATCH 'renamed'").fetchone()[0] == "song-v3"
    conn.execute("DELETE FROM songs WHERE id = 'song-v3'")
    assert conn.execute("SELECT count(*) FROM songs_fts WHERE songs_fts MATCH 'renamed'").fetchone()[0] == 0
    conn.rollback()
    assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"


def seed_v4(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        INSERT INTO users (id, external_subject, display_name, created_at)
        VALUES ('user-v4', 'sub-v4', 'User V4', '2026-01-04T00:00:00Z')
        """
    )
    doc = json.dumps(
        {
            "bars": [{"signature": [4, 4]}],
            "tracks": [],
            "sync": {"anchors": {"0": 1.0}, "points": [1.0], "keyed_by": "played"},
        }
    )
    conn.execute(
        """
        INSERT INTO songs (
            id, owner_id, slug, title, artist, content_kind, source_kind, source_ref,
            revision, bpm, measure_count, track_count, string_count, preferred_instrument,
            preferred_track_id, has_sync, duration, document, chordpro, created_at, updated_at
        ) VALUES (
            'song-v4', 'user-v4', 'song-v4', 'Repeat Tab', 'V4 Artist', 'tab', 'manual', '{}',
            1, 120.0, 2, 1, 4, 'bass-4', 't1', 1, 4.0, ?, NULL,
            '2026-01-04T00:00:00Z', '2026-01-04T00:00:00Z'
        )
        """,
        (doc,),
    )
    conn.commit()


def verify_v4(conn: sqlite3.Connection) -> None:
    row = conn.execute("SELECT document FROM songs WHERE id = 'song-v4'").fetchone()
    assert row is not None
    doc = json.loads(row["document"])
    assert doc["sync"]["keyed_by"] == "played"
    assert doc["sync"]["anchors"] == {"0": 1.0}
    assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"


def test_migration_004_updates_existing_sync_marks_to_played(tmp_path: Path) -> None:
    db_path = tmp_path / "migration4_test.sqlite"
    migrate(db_path, target_version=3)
    conn = connect(db_path)
    try:
        conn.execute(
            """
            INSERT INTO users (id, external_subject, display_name, created_at)
            VALUES ('u1', 'sub1', 'User 1', '2026-01-01T00:00:00Z')
            """
        )
        conn.execute(
            """
            INSERT INTO songs (
                id, owner_id, slug, title, artist, content_kind, source_kind, source_ref,
                revision, bpm, measure_count, track_count, string_count, preferred_instrument,
                preferred_track_id, has_sync, duration, document, chordpro, created_at, updated_at
            ) VALUES (
                's1', 'u1', 's1', 'Title', 'Artist', 'tab', 'scratch', '{}',
                1, 120.0, 4, 1, 4, 'bass-4', 't1', 1, 4.0,
                '{"bars": [], "tracks": [], "sync": {"anchors": {"1": 2.5}, "points": [0.0, 2.5]}}',
                NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
            )
            """
        )
        conn.commit()
    finally:
        conn.close()

    migrate(db_path, target_version=4)
    conn = connect(db_path)
    try:
        row = conn.execute("SELECT document FROM songs WHERE id = 's1'").fetchone()
        assert row is not None
        doc = json.loads(row["document"])
        assert doc["sync"]["keyed_by"] == "played"
        assert doc["sync"]["anchors"] == {"1": 2.5}
        assert doc["sync"]["points"] == [0.0, 2.5]
    finally:
        conn.close()


def seed_v5(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        INSERT INTO users (id, external_subject, display_name, created_at)
        VALUES ('user-v5', 'sub-v5', 'User V5', '2026-01-05T00:00:00Z')
        """
    )
    conn.execute(
        """
        INSERT INTO songs (
            id, owner_id, slug, title, artist, content_kind, source_kind, source_ref,
            revision, bpm, measure_count, track_count, string_count, preferred_instrument,
            preferred_track_id, has_sync, duration, document, chordpro, created_at, updated_at, favourite
        ) VALUES (
            'song-v5', 'user-v5', 'song-v5', 'Tagged', 'V5 Artist', 'chords', 'manual', '{}',
            1, 0.0, 0, 0, 0, '', '', 0, NULL, NULL, '[C]Yo',
            '2026-01-05T00:00:00Z', '2026-01-05T00:00:00Z', 1
        )
        """
    )
    conn.execute("INSERT INTO song_tags (song_id, tag, tag_key) VALUES ('song-v5', 'Funk', 'funk')")
    conn.commit()


def verify_v5(conn: sqlite3.Connection) -> None:
    assert conn.execute("SELECT favourite FROM songs WHERE id = 'song-v5'").fetchone()[0] == 1
    assert (
        conn.execute("SELECT tag FROM song_tags WHERE song_id = 'song-v5' AND tag_key = 'funk'").fetchone()[0] == "Funk"
    )
    conn.execute("DELETE FROM songs WHERE id = 'song-v5'")
    assert conn.execute("SELECT count(*) FROM song_tags WHERE song_id = 'song-v5'").fetchone()[0] == 0
    conn.rollback()
    assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"


def seed_v9(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        INSERT INTO users (id, external_subject, display_name, created_at)
        VALUES ('user-v9', 'sub-v9', 'User V9', '2026-01-09T00:00:00Z')
        """
    )
    conn.execute(
        """
        INSERT INTO api_tokens (id, user_id, name, prefix, token_hash, created_at, expires_at)
        VALUES ('token-v9', 'user-v9', 'nightly import', 'fb_abcde', 'hash-v9', '2026-01-09T00:00:00Z', NULL)
        """
    )
    conn.commit()


def verify_v9(conn: sqlite3.Connection) -> None:
    row = conn.execute("SELECT name, token_hash, last_used_at FROM api_tokens WHERE id = 'token-v9'").fetchone()
    assert tuple(row) == ("nightly import", "hash-v9", None)
    # Tokens go with their owner.
    conn.execute("DELETE FROM users WHERE id = 'user-v9'")
    assert conn.execute("SELECT count(*) FROM api_tokens WHERE id = 'token-v9'").fetchone()[0] == 0
    conn.rollback()
    assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"


SEEDS: dict[int, tuple[Callable[[sqlite3.Connection], None], Callable[[sqlite3.Connection], None]]] = {
    1: (seed_v1, verify_v1),
    2: (seed_v2, verify_v2),
    3: (seed_v3, verify_v3),
    4: (seed_v4, verify_v4),
    5: (seed_v5, verify_v5),
    9: (seed_v9, verify_v9),
}


def test_every_migration_has_registered_seed() -> None:
    available = get_available_migrations()
    assert available, "No migrations found in migrations directory"
    for version, path in available:
        assert version in SEEDS, (
            f"Migration {path.name} (version {version}) has no representative data seed registered in SEEDS"
        )


@pytest.mark.parametrize("level", [v for v, _ in get_available_migrations()])
def test_upgrade_from_every_migration_level(tmp_path: Path, level: int) -> None:
    available = get_available_migrations()
    latest_version = max(v for v, _ in available)

    db_path = tmp_path / f"test_migrate_from_{level}.sqlite"
    backups_dir = tmp_path / f"backups_from_{level}"

    # Step 1: Migrate up to historical level
    migrate(db_path, target_version=level, backups_dir=backups_dir)

    # Step 2: Seed representative data for this level
    seed_fn, verify_fn = SEEDS[level]
    conn = connect(db_path)
    try:
        seed_fn(conn)
    finally:
        conn.close()

    # Step 3: Run remaining migrations to latest version
    migrate(db_path, backups_dir=backups_dir)

    # Step 4: Verify that all data survived the migration to latest
    conn = connect(db_path)
    try:
        verify_fn(conn)
    finally:
        conn.close()

    # Step 5: Check pre-migration backup behaviour
    if level < latest_version:
        # A pre-migration backup should have been taken before upgrading
        backups = [p for p in backups_dir.glob("*.sqlite") if _BACKUP_PATTERN.match(p.name)]
        assert len(backups) == 1
        backup_file = backups[0]
        assert backup_file.name.startswith(f"pre-migrate-{level}-{latest_version}-")

        # Verify that the backup file is consistent SQLite and holds pre-migration data
        backup_conn = connect(backup_file)
        try:
            assert backup_conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
            # In level 1 backup, sessions table does not exist
            if level == 1:
                tables = {
                    row[0]
                    for row in backup_conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
                }
                assert "sessions" not in tables
                # Original user row exists in backup
                user = backup_conn.execute("SELECT * FROM users WHERE id = 'user-v1'").fetchone()
                assert user is not None
                assert user["display_name"] == "Alice V1"
        finally:
            backup_conn.close()


def test_backup_created_only_when_pending_migrations(tmp_path: Path) -> None:
    db_path = tmp_path / "app.sqlite"
    backups_dir = tmp_path / "backups"

    # Fresh database installation: no backup taken on fresh init
    migrate(db_path, target_version=1, backups_dir=backups_dir)
    assert not backups_dir.exists() or len(list(backups_dir.glob("*.sqlite"))) == 0

    # Running migrate with target_version=1 again when no migrations are pending: no backup taken
    migrate(db_path, target_version=1, backups_dir=backups_dir)
    assert not backups_dir.exists() or len(list(backups_dir.glob("*.sqlite"))) == 0

    # Now run migrate without target_version: detects the pending migrations on an existing database,
    # takes one backup before applying them.
    migrate(db_path, backups_dir=backups_dir)
    backups = [p for p in backups_dir.glob("*.sqlite") if _BACKUP_PATTERN.match(p.name)]
    assert len(backups) == 1
    assert backups[0].name.startswith(f"pre-migrate-1-{max(v for v, _ in get_available_migrations())}-")

    # Running migrate again on the fully migrated database: no new backup taken
    migrate(db_path, backups_dir=backups_dir)
    backups_after = [p for p in backups_dir.glob("*.sqlite") if _BACKUP_PATTERN.match(p.name)]
    assert len(backups_after) == 1


def test_backup_retention_pruning(tmp_path: Path) -> None:
    backups_dir = tmp_path / "backups"
    backups_dir.mkdir(parents=True, exist_ok=True)

    # Create dummy non-backup files that should never be pruned
    keep_non_backup = backups_dir / "custom-backup.sqlite"
    keep_non_backup.write_text("user custom backup")
    keep_txt = backups_dir / "notes.txt"
    keep_txt.write_text("important notes")

    # Create 6 pre-migrate backup files
    created_backups: list[Path] = []
    for i in range(1, 7):
        p = backups_dir / f"pre-migrate-1-2-20260101T00000{i}Z.sqlite"
        p.write_text(f"backup {i}")
        # Ensure distinct mtime ordering
        created_backups.append(p)

    pruned = prune_old_backups(backups_dir, keep=3)
    assert len(pruned) == 3
    assert set(pruned) == set(created_backups[:3])

    remaining = sorted(p.name for p in backups_dir.glob("pre-migrate-*.sqlite"))
    assert remaining == [
        "pre-migrate-1-2-20260101T000004Z.sqlite",
        "pre-migrate-1-2-20260101T000005Z.sqlite",
        "pre-migrate-1-2-20260101T000006Z.sqlite",
    ]

    # Non-backup files still exist intact
    assert keep_non_backup.exists()
    assert keep_txt.exists()


def test_refuse_newer_database_version(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    db_path = tmp_path / "future.sqlite"
    conn = connect(db_path)
    try:
        conn.execute(
            """
            CREATE TABLE schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            )
            """
        )
        conn.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (999, '2099-01-01T00:00:00Z')")
        conn.commit()
    finally:
        conn.close()

    caplog.clear()
    with caplog.at_level(logging.ERROR):
        with pytest.raises(DatabaseVersionError, match="Database schema version 999 is newer"):
            migrate(db_path)

    assert "Database schema version 999 is newer than the highest migration supported" in caplog.text
    assert "Refusing to start" in caplog.text


def test_refuse_newer_database_version_in_app_lifespan(tmp_path: Path) -> None:
    settings = Settings.for_tests(tmp_path)
    conn = connect(settings.database_path)
    try:
        conn.execute(
            """
            CREATE TABLE schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            )
            """
        )
        conn.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (999, '2099-01-01T00:00:00Z')")
        conn.commit()
    finally:
        conn.close()

    app = create_app(settings)
    with pytest.raises(DatabaseVersionError):
        with TestClient(app):
            pass


def test_backup_database_wal_snapshot(tmp_path: Path) -> None:
    src_path = tmp_path / "source.sqlite"
    dst_path = tmp_path / "target.sqlite"

    src_conn = connect(src_path)
    try:
        src_conn.execute("PRAGMA journal_mode = WAL")
        src_conn.execute("CREATE TABLE test_table (id INTEGER PRIMARY KEY, value TEXT)")
        src_conn.execute("INSERT INTO test_table (value) VALUES ('first')")
        src_conn.commit()

        # Uncommitted write in another transaction / WAL page
        src_conn.execute("INSERT INTO test_table (value) VALUES ('second')")
        src_conn.commit()

        backup_database(src_conn, dst_path)
    finally:
        src_conn.close()

    assert dst_path.exists()
    dst_conn = connect(dst_path)
    try:
        rows = [r["value"] for r in dst_conn.execute("SELECT value FROM test_table ORDER BY id").fetchall()]
        assert rows == ["first", "second"]
        assert dst_conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    finally:
        dst_conn.close()


def test_migration_failure_rolls_back_and_preserves_backup(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    db_path = tmp_path / "rollback_test.sqlite"
    backups_dir = tmp_path / "backups"

    # Start at migration 1
    migrate(db_path, target_version=1, backups_dir=backups_dir)

    # Monkeypatch migration files to inject a bad migration file for version 2
    migrate_module = sys.modules["fretbook.db.migrate"]

    bad_migration = tmp_path / "002_broken.sql"
    bad_migration.write_text("THIS IS INVALID SQL STATEMENT;")

    def fake_get_available() -> list[tuple[int, Path]]:
        return [(1, Path("001_initial.sql")), (2, bad_migration)]

    monkeypatch.setattr(migrate_module, "get_available_migrations", fake_get_available)

    # migrate should take a backup first, then fail when executing migration 2
    with pytest.raises(sqlite3.OperationalError):
        migrate(db_path, backups_dir=backups_dir)

    # Verify backup exists and is intact
    backups = [p for p in backups_dir.glob("*.sqlite") if _BACKUP_PATTERN.match(p.name)]
    assert len(backups) == 1
    assert backups[0].name.startswith("pre-migrate-1-2-")

    # Verify DB was rolled back: version 2 was not recorded in schema_migrations
    conn = connect(db_path)
    try:
        applied = {row[0] for row in conn.execute("SELECT version FROM schema_migrations")}
        assert applied == {1}
    finally:
        conn.close()


def test_create_pre_migration_backup_same_second_collision(tmp_path: Path) -> None:
    db_path = tmp_path / "collision_test.sqlite"
    backups_dir = tmp_path / "backups"

    conn = connect(db_path)
    try:
        conn.execute("CREATE TABLE sample (id INT)")
        conn.commit()

        # Call with fixed timestamp twice
        from fretbook.db.migrate import create_pre_migration_backup

        p1 = create_pre_migration_backup(conn, backups_dir, from_version=1, to_version=2, timestamp="20260101T120000Z")
        p2 = create_pre_migration_backup(conn, backups_dir, from_version=1, to_version=2, timestamp="20260101T120000Z")

        assert p1 != p2
        assert p1.name == "pre-migrate-1-2-20260101T120000Z.sqlite"
        assert p2.name == "pre-migrate-1-2-20260101T120000Z-1.sqlite"
        assert p1.exists()
        assert p2.exists()
    finally:
        conn.close()
