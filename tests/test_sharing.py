"""Read-only share links and band libraries.

A person who is not a member gets 404 for a band's songs, lists, and media. A view member can
read and cannot write. Share links are off unless the server turns them on, and a public response
does not carry real ids.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from tests.test_oidc import MockProvider, _settings, sign_in

from fretbook.app import create_app
from fretbook.config import Settings
from fretbook.db.connection import connect
from fretbook.db.migrate import migrate


@pytest.fixture
def provider() -> MockProvider:
    return MockProvider()


@pytest.fixture
def app_factory(tmp_path: Path, provider: MockProvider):
    def make(**changes):
        return create_app(_settings(tmp_path, **changes), oidc_transport=provider.transport())

    return make


def test_personal_library_is_the_user_and_links_are_off(tmp_path: Path) -> None:
    with TestClient(create_app(Settings.for_tests(tmp_path))) as client:
        song = client.post("/api/songs", json={"title": "Mine", "content_kind": "chords", "chordpro": "C"}).json()
        assert song["library_id"] == "local"
        assert song["library_role"] == "edit"
        libraries = client.get("/api/libraries").json()
        assert libraries == [{"id": "local", "kind": "personal", "name": "Local", "role": "edit", "song_count": 1}]
        refused = client.post(f"/api/songs/{song['id']}/shares", json={})
        assert refused.status_code == 403
        assert refused.json()["detail"]["key"] == "share.disabled"
        missing = client.get("/api/share/sh_not-a-real-token")
        assert missing.status_code == 404
        assert missing.json()["detail"]["key"] == "share.notFound"
        personal = client.post("/api/libraries/local/members", json={"email": "a@b.c", "role": "view"})
        assert personal.status_code == 403
        assert personal.json()["detail"]["key"] == "library.personal"


def test_share_link_is_read_only_and_revocable(tmp_path: Path) -> None:
    settings = replace(Settings.for_tests(tmp_path), share_links=True)
    with TestClient(create_app(settings)) as client:
        song = client.post(
            "/api/songs",
            json={
                "title": "Shared Tune",
                "artist": "Ada",
                "content_kind": "chords",
                "chordpro": "{comment: secret}\n[C]Hello",
            },
        ).json()
        client.patch(f"/api/songs/{song['id']}/metadata", json={"notes": "private note", "genre": "Folk"})
        client.post(f"/api/songs/{song['id']}/tags", json={"tags": ["rehearsal"]})
        audio = client.post(
            f"/api/songs/{song['id']}/audio",
            files={"file": ("room.wav", b"RIFFxxxxWAVEfmt ", "audio/wav")},
        )
        assert audio.status_code == 200

        created = client.post(f"/api/songs/{song['id']}/shares", json={"expires_in_days": 7})
        assert created.status_code == 201
        body = created.json()
        token = body["token"]
        assert token.startswith("sh_")
        assert body["prefix"] == token[:8]
        listed = client.get(f"/api/songs/{song['id']}/shares").json()
        assert listed == [
            {
                "id": body["id"],
                "prefix": body["prefix"],
                "created_at": body["created_at"],
                "expires_at": body["expires_at"],
            }
        ]
        assert "token" not in listed[0]

        opened = client.get(f"/api/share/{token}")
        assert opened.status_code == 200
        assert opened.headers["cache-control"] == "private, no-store"
        assert opened.headers["x-robots-tag"] == "noindex"
        public = opened.json()
        assert public["title"] == "Shared Tune"
        assert public["artist"] == "Ada"
        assert public["chordpro"]
        assert public["id"] == "shared"
        assert public["library_id"] == "shared"
        assert public["library_role"] == "view"
        assert public["notes"] == ""
        assert public["tags"] == []
        assert public["genre"] == ""
        assert public["source_ref"] == {}
        assert song["id"] not in opened.text
        assert public["audio_url"] == f"api/share/{token}/audio"
        audio_out = client.get(f"/api/share/{token}/audio")
        assert audio_out.status_code == 200
        assert audio_out.content.startswith(b"RIFF")

        written = client.patch(
            "/api/songs/shared/sync",
            json={"bpm": 120, "anchors": {}},
        )
        assert written.status_code == 404
        assert client.put(f"/api/share/{token}", json={"title": "nope"}).status_code == 405

        assert client.delete(f"/api/songs/{song['id']}/shares/{body['id']}").status_code == 204
        revoked = client.get(f"/api/share/{token}")
        assert revoked.status_code == 404
        assert revoked.json()["detail"]["key"] == "share.notFound"
        assert client.get(f"/api/share/{token}/audio").status_code == 404


def test_expired_share_matches_a_missing_one(tmp_path: Path) -> None:
    settings = replace(Settings.for_tests(tmp_path), share_links=True)
    with TestClient(create_app(settings)) as client:
        song = client.post("/api/songs", json={"title": "Old", "content_kind": "chords", "chordpro": "C"}).json()
        created = client.post(f"/api/songs/{song['id']}/shares", json={}).json()
        past = (datetime.now(UTC) - timedelta(days=1)).replace(microsecond=0).isoformat()
        conn = connect(settings.database_path)
        try:
            conn.execute("UPDATE song_shares SET expires_at = ? WHERE id = ?", (past, created["id"]))
            conn.commit()
        finally:
            conn.close()
        expired = client.get(f"/api/share/{created['token']}")
        unknown = client.get("/api/share/sh_does-not-exist")
        assert expired.status_code == unknown.status_code == 404
        assert expired.json() == unknown.json()


def test_band_isolation_copy_and_move(app_factory, provider) -> None:  # noqa: F811
    app = app_factory(share_links=True)
    with TestClient(app) as ada_client, TestClient(app) as bea_client:
        sign_in(ada_client, provider, "ada", ["fretbook_users", "fretbook_admins"])
        ada = ada_client.get("/api/me").json()
        song = ada_client.post(
            "/api/songs", json={"title": "Band Song", "content_kind": "chords", "chordpro": "[G]Together"}
        ).json()
        band = ada_client.post("/api/libraries", json={"name": "Tuesday Band"}).json()
        assert band["kind"] == "band"
        assert band["role"] == "edit"
        moved = ada_client.post(f"/api/songs/{song['id']}/move", json={"library_id": band["id"]})
        assert moved.status_code == 200
        assert moved.json()["library_id"] == band["id"]
        assert ada_client.get("/api/songs").json()["total"] == 0
        listed = ada_client.get("/api/songs", params={"library": band["id"]}).json()
        assert listed["total"] == 1
        assert listed["items"][0]["id"] == song["id"]

        sign_in(bea_client, provider, "bea", ["fretbook_users"])
        bea = bea_client.get("/api/me").json()
        for path in (
            f"/api/songs/{song['id']}",
            f"/api/songs/{song['id']}/audio",
            f"/api/songs/{song['id']}/export.json",
            f"/api/libraries/{band['id']}/members",
        ):
            response = bea_client.get(path)
            assert response.status_code == 404, path
        probe = bea_client.get("/api/songs", params={"library": band["id"]})
        assert probe.status_code == 404
        assert probe.json()["detail"]["key"] == "library.notFound"
        assert (
            bea_client.put(
                f"/api/songs/{song['id']}",
                json={"title": "Stolen", "artist": "", "revision": 1, "chordpro": "nope"},
            ).status_code
            == 404
        )
        assert bea_client.delete(f"/api/songs/{song['id']}").status_code == 404

        added = ada_client.post(
            f"/api/libraries/{band['id']}/members",
            json={"email": bea["email"], "role": "view"},
        )
        assert added.status_code == 201
        assert "email" not in added.json()
        viewed = bea_client.get(f"/api/songs/{song['id']}")
        assert viewed.status_code == 200
        assert viewed.json()["library_role"] == "view"
        forbidden = bea_client.put(
            f"/api/songs/{song['id']}",
            json={"title": "Nope", "artist": "", "revision": viewed.json()["revision"], "chordpro": "no"},
        )
        assert forbidden.status_code == 403
        assert forbidden.json()["detail"]["key"] == "library.readOnly"
        assert bea_client.post(f"/api/songs/{song['id']}/shares", json={}).status_code == 403

        uploaded = ada_client.post(
            f"/api/songs/{song['id']}/audio",
            files={"file": ("room.wav", b"RIFFxxxxWAVEfmt ", "audio/wav")},
        )
        assert uploaded.status_code == 200
        ada_client.patch(
            f"/api/libraries/{band['id']}/members/{bea['user_id']}",
            json={"role": "edit"},
        )
        edited = bea_client.put(
            f"/api/songs/{song['id']}",
            json={"title": "Our Song", "artist": "Ada", "revision": viewed.json()["revision"], "chordpro": "[G]Ours"},
        )
        assert edited.status_code == 200
        assert edited.json()["title"] == "Our Song"

        copied = bea_client.post(f"/api/songs/{song['id']}/copy", json={"library_id": bea["user_id"]})
        assert copied.status_code == 201
        assert copied.json()["library_id"] == bea["user_id"]
        assert copied.json()["id"] != song["id"]
        assert bea_client.get(f"/api/songs/{copied.json()['id']}/audio").content.startswith(b"RIFF")
        assert ada_client.get(f"/api/songs/{song['id']}/audio").content.startswith(b"RIFF")
        assert bea_client.get("/api/songs").json()["total"] == 1
        assert ada_client.get(f"/api/songs/{song['id']}").json()["title"] == "Our Song"

        assert ada_client.delete(f"/api/libraries/{band['id']}").status_code == 409
        same = ada_client.post(f"/api/songs/{song['id']}/move", json={"library_id": band["id"]})
        assert same.status_code == 409
        assert same.json()["detail"]["key"] == "library.same"
        assert (
            ada_client.patch(f"/api/libraries/{band['id']}/members/{bea['user_id']}", json={"role": "view"}).status_code
            == 200
        )
        last = ada_client.delete(f"/api/libraries/{band['id']}/members/{ada['user_id']}")
        assert last.status_code == 409
        assert last.json()["detail"]["key"] == "library.lastEditor"
        moved_home = ada_client.post(f"/api/songs/{song['id']}/move", json={"library_id": ada["user_id"]})
        assert moved_home.status_code == 200
        assert ada_client.get(f"/api/songs/{song['id']}/audio").content.startswith(b"RIFF")
        assert ada_client.delete(f"/api/libraries/{band['id']}").status_code == 204
        assert bea_client.get(f"/api/songs/{song['id']}").status_code == 404


def test_upgrade_from_v20_keeps_songs_and_checks_foreign_keys(tmp_path: Path) -> None:
    db = tmp_path / "fretbook.sqlite"
    migrate(db, target_version=20)
    conn = connect(db)
    try:
        conn.execute(
            """
            INSERT INTO users (id, external_subject, display_name, created_at)
            VALUES ('local', NULL, 'Local', '2026-01-01T00:00:00+00:00')
            """
        )
        conn.execute(
            """
            INSERT INTO songs (
                id, owner_id, slug, title, artist, content_kind, source_kind, source_ref,
                revision, bpm, measure_count, track_count, string_count, preferred_instrument,
                preferred_track_id, has_sync, duration, document, chordpro, created_at, updated_at
            ) VALUES (
                'song-old', 'local', 'old', 'Old Song', '', 'chords', 'manual', '{}',
                1, 0, 0, 0, 0, '', '', 0, NULL, NULL, 'C',
                '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00'
            )
            """
        )
        conn.commit()
    finally:
        conn.close()
    migrate(db)
    conn = connect(db)
    try:
        assert conn.execute("SELECT title FROM songs WHERE id = 'song-old'").fetchone()[0] == "Old Song"
        assert conn.execute("SELECT kind FROM libraries WHERE id = 'local'").fetchone()[0] == "personal"
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
        row = conn.execute("SELECT sql FROM sqlite_master WHERE name = 'songs'").fetchone()[0]
        assert "REFERENCES libraries" in row
    finally:
        conn.close()
