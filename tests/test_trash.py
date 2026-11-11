"""The trash: a deleted song is invisible everywhere but /api/trash, can be restored whole, and is purged by age."""

from __future__ import annotations

import io
import json
import zipfile
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from tests.test_api import WAV
from tests.test_oidc import MockProvider, _settings, sign_in

from fretbook.app import create_app
from fretbook.config import Settings
from fretbook.db.connection import connect
from fretbook.storage.media import MediaStore, QuotaExceeded
from fretbook.storage.trash import TrashPurger, TrashStore

SHEET = "{key: G}\n[G]Lanterns over the [C]harbour wall\n"


@pytest.fixture
def client(tmp_path: Path):
    settings = replace(Settings.for_tests(tmp_path), share_links=True)
    with TestClient(create_app(settings)) as started:
        yield started


def _settings_of(client: TestClient) -> Settings:
    return client.app.state.ctx.settings  # type: ignore[attr-defined]


def _today() -> str:
    return datetime.now(UTC).date().isoformat()


def _sheet(client: TestClient, title: str = "Harbour Lights") -> dict:
    created = client.post(
        "/api/songs", json={"title": title, "artist": "Ada", "content_kind": "chords", "chordpro": SHEET}
    )
    assert created.status_code == 201, created.text
    return created.json()


def _dress(client: TestClient, song_id: str) -> dict:
    """Give a song audio, a tag, a genre, a setlist entry, a practice session and a share link."""
    assert client.post(f"/api/songs/{song_id}/audio", files={"file": ("a.wav", WAV, "audio/wav")}).status_code == 200
    assert client.put(f"/api/songs/{song_id}/tags", json={"tags": ["quayside"]}).status_code == 200
    assert client.patch(f"/api/songs/{song_id}/metadata", json={"genre": "Shanty"}).status_code == 200
    setlist = client.post("/api/setlists", json={"name": "Friday"}).json()
    assert client.post(f"/api/setlists/{setlist['id']}/entries", json={"song_id": song_id}).status_code == 201
    day = _today()
    logged = client.post(
        "/api/practice/sessions",
        json={"song_id": song_id, "day": day, "duration_seconds": 600, "started_at": f"{day}T12:00:00+00:00"},
    )
    assert logged.status_code == 201, logged.text
    share = client.post(f"/api/songs/{song_id}/shares", json={})
    assert share.status_code == 201, share.text
    return {"setlist": setlist["id"], "token": share.json()["token"]}


def _media_files(client: TestClient) -> list[Path]:
    return [path for path in _settings_of(client).media_dir.rglob("*") if path.is_file()]


def _age(client: TestClient, song_id: str, days: int) -> None:
    stamp = (datetime.now(UTC) - timedelta(days=days)).replace(microsecond=0).isoformat()
    conn = connect(_settings_of(client).database_path)
    conn.execute("UPDATE songs SET deleted_at = ? WHERE id = ?", (stamp, song_id))
    conn.commit()
    conn.close()


def test_a_trashed_song_is_gone_from_every_read(client: TestClient) -> None:
    keeper = client.post(
        "/api/songs", json={"title": "Keeper", "content_kind": "chords", "chordpro": "{key: D}\n[D]Stay"}
    ).json()
    song = _sheet(client)
    song_id = song["id"]
    extras = _dress(client, song_id)
    today = _today()

    assert client.delete(f"/api/songs/{song_id}").status_code == 204

    listed = client.get("/api/songs").json()
    assert [item["id"] for item in listed["items"]] == [keeper["id"]]
    assert listed["total"] == 1
    assert listed["counts"]["all"] == 1 and listed["counts"]["chords"] == 1
    for query in ({"q": "harbour"}, {"q": "lanterns"}, {"q": "quayside"}, {"tag": "quayside"}, {"genre": "Shanty"}):
        assert client.get("/api/songs", params=query).json()["total"] == 0, query
    facets = client.get("/api/library/facets").json()
    assert facets["genres"] == []
    assert [item["count"] for item in facets["keys"]] == [1]
    assert client.get("/api/tags").json() == []
    assert client.get("/api/libraries").json()[0]["song_count"] == 1

    setlist = client.get(f"/api/setlists/{extras['setlist']}").json()
    assert setlist["entries"] == [] and setlist["entry_count"] == 0
    assert client.get("/api/setlists").json()[0]["entry_count"] == 0

    stats = client.get(f"/api/practice/stats?today={today}").json()
    assert stats["recent"] == [] and stats["songs_practised"] == 0 and stats["songs_this_month"] == 0
    assert stats["total_seconds"] == 0 and stats["heatmap"] == []
    recommended = json.dumps(client.get(f"/api/practice/recommendations?today={today}").json())
    assert song_id not in recommended and keeper["id"] in recommended

    assert client.get(f"/api/share/{extras['token']}").status_code == 404
    assert client.get(f"/api/share/{extras['token']}/audio").status_code == 404

    for path in (
        f"/api/songs/{song_id}",
        f"/api/songs/{song_id}/audio",
        f"/api/songs/{song_id}/cover",
        f"/api/songs/{song_id}/stems",
        f"/api/songs/{song_id}/practice",
        f"/api/songs/{song_id}/shares",
        f"/api/songs/{song_id}/export.json",
    ):
        assert client.get(path).status_code == 404, path
    writes = (
        client.put(f"/api/songs/{song_id}", json={"title": "x", "artist": "", "revision": 1, "chordpro": "C"}),
        client.delete(f"/api/songs/{song_id}"),
        client.put(f"/api/songs/{song_id}/tags", json={"tags": ["x"]}),
        client.put(f"/api/songs/{song_id}/favourite", json={"favourite": True}),
        client.patch(f"/api/songs/{song_id}/metadata", json={"genre": "x"}),
        client.post(f"/api/songs/{song_id}/audio", files={"file": ("a.wav", WAV, "audio/wav")}),
        client.post(f"/api/songs/{song_id}/opened"),
        client.post(f"/api/songs/{song_id}/copy", json={"library_id": "local"}),
    )
    assert [response.status_code for response in writes] == [404] * len(writes)
    day = _today()
    refused = client.post("/api/practice/sessions", json={"song_id": song_id, "day": day, "duration_seconds": 60})
    assert refused.status_code == 404
    added = client.post(f"/api/setlists/{extras['setlist']}/entries", json={"song_id": song_id})
    assert added.status_code == 400

    # Tag edits on the library leave the trashed song's tags alone.
    assert client.delete("/api/tags/quayside").status_code == 404

    trash = client.get("/api/trash").json()
    assert trash["retention_days"] == 30
    assert [item["id"] for item in trash["items"]] == [song_id]
    item = trash["items"][0]
    assert item["title"] == "Harbour Lights" and item["artist"] == "Ada" and item["media_bytes"] == len(WAV)
    kept = datetime.fromisoformat(item["purge_at"]) - datetime.fromisoformat(item["deleted_at"])
    assert kept == timedelta(days=30)


def test_restore_brings_everything_back(client: TestClient) -> None:
    created = client.post("/api/songs", json={"title": "Riff", "artist": "Me", "preset": "bass-4", "measures": 2})
    song_id = created.json()["id"]
    assert client.patch(f"/api/songs/{song_id}/sync", json={"bpm": 90, "anchors": {"0": 1.25}}).status_code == 200
    extras = _dress(client, song_id)
    other = _sheet(client, "Other")
    before = client.get(f"/api/songs/{song_id}").json()

    assert client.delete(f"/api/songs/{song_id}").status_code == 204
    # Reordering the setlist while the song is in the trash keeps its place for later.
    assert (
        client.put(f"/api/setlists/{extras['setlist']}/entries", json={"entries": [{"song_id": other["id"]}]}).json()[
            "entry_count"
        ]
        == 1
    )
    appended = client.post(f"/api/setlists/{extras['setlist']}/entries", json={"song_id": other["id"]})
    assert appended.json()["entry_count"] == 2

    restored = client.post(f"/api/trash/{song_id}/restore")
    assert restored.status_code == 200, restored.text
    assert restored.json() == before
    assert restored.json()["tags"] == ["quayside"] and restored.json()["has_audio"] is True
    assert restored.json()["document"]["sync"]["anchors"]["0"] == 1.25
    audio = client.get(restored.json()["audio_url"])
    assert audio.status_code == 200 and audio.content == WAV
    entries = client.get(f"/api/setlists/{extras['setlist']}").json()["entries"]
    assert [entry["song_id"] for entry in entries] == [song_id, other["id"], other["id"]]
    history = client.get(f"/api/songs/{song_id}/practice").json()
    assert history["session_count"] == 1 and history["total_seconds"] == 600
    assert client.get(f"/api/practice/stats?today={_today()}").json()["total_seconds"] == 600
    assert client.get(f"/api/share/{extras['token']}").status_code == 200
    assert client.get("/api/songs", params={"q": "riff"}).json()["total"] == 1
    assert client.get("/api/trash").json()["items"] == []
    assert client.post(f"/api/trash/{song_id}/restore").status_code == 404


def test_a_trashed_song_keeps_its_slug_and_is_not_a_duplicate(client: TestClient) -> None:
    first = _sheet(client)
    client.delete(f"/api/songs/{first['id']}")
    second = _sheet(client)
    assert second["slug"] == "harbour-lights-2"
    restored = client.post(f"/api/trash/{first['id']}/restore").json()
    assert restored["slug"] == "harbour-lights"
    assert {item["slug"] for item in client.get("/api/songs").json()["items"]} == {"harbour-lights", "harbour-lights-2"}

    # An import that matches only a trashed song makes a new one, even when asked to replace.
    client.delete(f"/api/songs/{first['id']}")
    client.delete(f"/api/songs/{second['id']}")
    document = client.post("/api/songs", json={"title": "Riff", "preset": "bass-4", "measures": 1}).json()
    client.delete(f"/api/songs/{document['id']}")
    body = {"title": "Riff", "artist": "", "document": document["document"], "on_duplicate": "replace"}
    imported = client.post("/api/songs/import-document", json=body)
    assert imported.status_code in {200, 201}, imported.text
    assert imported.json()["id"] != document["id"]
    assert len(client.get("/api/trash").json()["items"]) == 3
    repo = client.app.state.ctx.songs  # type: ignore[attr-defined]
    assert repo.find_duplicate("local", "Harbour Lights", "Ada", "manual") is False
    assert repo.id_taken(first["id"]) is True


def test_delete_for_good_and_empty(client: TestClient) -> None:
    one, two, three = (_sheet(client, title) for title in ("One", "Two", "Three"))
    for song in (one, two, three):
        client.post(f"/api/songs/{song['id']}/audio", files={"file": ("a.wav", WAV, "audio/wav")})
    assert len(_media_files(client)) == 3
    assert client.delete(f"/api/trash/{one['id']}").status_code == 404  # still live
    for song in (one, two):
        client.delete(f"/api/songs/{song['id']}")
    assert len(_media_files(client)) == 3

    assert client.delete(f"/api/trash/{one['id']}").status_code == 204
    assert client.delete(f"/api/trash/{one['id']}").status_code == 404
    assert len(_media_files(client)) == 2
    client.delete(f"/api/songs/{three['id']}")
    assert client.delete("/api/trash").json() == {"deleted": 2}
    assert client.get("/api/trash").json()["items"] == []
    assert _media_files(client) == []
    assert client.delete("/api/trash").json() == {"deleted": 0}


def test_purge_removes_only_songs_past_the_retention_period(client: TestClient) -> None:
    old, fresh, live = (_sheet(client, title) for title in ("Old", "Fresh", "Live"))
    for song in (old, fresh, live):
        client.post(f"/api/songs/{song['id']}/audio", files={"file": ("a.wav", WAV, "audio/wav")})
    client.delete(f"/api/songs/{old['id']}")
    client.delete(f"/api/songs/{fresh['id']}")
    _age(client, old["id"], 31)
    _age(client, fresh["id"], 29)
    settings = _settings_of(client)
    store = TrashStore(settings, MediaStore(settings))

    assert TrashPurger(store).run_once() == 1
    assert [item["id"] for item in client.get("/api/trash").json()["items"]] == [fresh["id"]]
    assert client.post(f"/api/trash/{old['id']}/restore").status_code == 404
    assert len(_media_files(client)) == 2
    assert store.purge_expired() == 0
    assert store.purge_expired(datetime.now(UTC) + timedelta(days=2)) == 1
    assert len(_media_files(client)) == 1
    assert client.get("/api/songs").json()["total"] == 1


def test_purger_runs_at_start_up_and_survives_a_failure(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    settings = Settings.for_tests(tmp_path)
    with TestClient(create_app(settings)) as first:
        song = _sheet(first)
        first.delete(f"/api/songs/{song['id']}")
        _age(first, song["id"], 40)
    with TestClient(create_app(settings)) as second:
        assert second.get("/api/trash").json()["items"] == []

    store = TrashStore(settings, MediaStore(settings))
    purger = TrashPurger(store)
    purger.start()
    purger.start()
    purger.stop()
    assert purger._thread is not None
    purger._thread.join(timeout=5)
    assert not purger._thread.is_alive()

    def boom() -> int:
        raise RuntimeError("disk on fire")

    store.purge_expired = boom  # type: ignore[method-assign]
    assert purger.run_once() == 0
    assert "purging the trash failed" in caplog.text


def test_trash_days_zero_deletes_at_once(tmp_path: Path) -> None:
    settings = replace(Settings.for_tests(tmp_path), trash_days=0)
    with TestClient(create_app(settings)) as client:
        song = _sheet(client)
        client.post(f"/api/songs/{song['id']}/audio", files={"file": ("a.wav", WAV, "audio/wav")})
        assert client.delete(f"/api/songs/{song['id']}").status_code == 204
        assert client.get("/api/trash").json() == {"retention_days": 0, "items": []}
        assert _media_files(client) == []
        assert client.post(f"/api/trash/{song['id']}/restore").status_code == 404
        assert _sheet(client)["slug"] == "harbour-lights"

    # Turning the trash off empties what was in it at the next start.
    with TestClient(create_app(replace(settings, trash_days=30))) as client:
        song = _sheet(client, "Later")
        client.delete(f"/api/songs/{song['id']}")
        assert len(client.get("/api/trash").json()["items"]) == 1
    with TestClient(create_app(settings)) as client:
        assert client.get("/api/songs").json()["total"] == 1


def test_trashed_media_counts_towards_the_quota(tmp_path: Path) -> None:
    settings = replace(Settings.for_tests(tmp_path), user_quota_mb=1)
    with TestClient(create_app(settings)) as client:
        media: MediaStore = client.app.state.ctx.media  # type: ignore[attr-defined]
        song = _sheet(client)
        big = b"0" * 700_000
        media.save("local", song["id"], kind="upload", filename="a.bin", content_type="x/y", data=big)
        client.delete(f"/api/songs/{song['id']}")
        assert media.usage("local") == 700_000
        other = _sheet(client, "Other")
        with pytest.raises(QuotaExceeded):
            media.save("local", other["id"], kind="upload", filename="b.bin", content_type="x/y", data=big)
        assert client.delete(f"/api/trash/{song['id']}").status_code == 204
        assert media.usage("local") == 0
        media.save("local", other["id"], kind="upload", filename="b.bin", content_type="x/y", data=big)


def test_backup_leaves_the_trash_out(client: TestClient) -> None:
    kept = _sheet(client, "Kept")
    gone = _sheet(client, "Gone")
    extras = _dress(client, gone["id"])
    client.post(f"/api/setlists/{extras['setlist']}/entries", json={"song_id": kept["id"]})
    client.delete(f"/api/songs/{gone['id']}")

    with zipfile.ZipFile(io.BytesIO(client.get("/api/library/export").content)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        names = archive.namelist()
    assert [song["title"] for song in manifest["songs"]] == ["Kept"]
    assert not any(gone["id"] in name for name in names)
    assert gone["id"] not in json.dumps(manifest)


def test_band_trash_is_for_editors(tmp_path: Path) -> None:
    provider = MockProvider()
    app = create_app(_settings(tmp_path), oidc_transport=provider.transport())
    with TestClient(app) as ada, TestClient(app) as bea, TestClient(app) as cy:
        sign_in(ada, provider, "ada", ["fretbook_users", "fretbook_admins"])
        sign_in(bea, provider, "bea", ["fretbook_users"])
        sign_in(cy, provider, "cy", ["fretbook_users"])
        band = ada.post("/api/libraries", json={"name": "Tuesday Band"}).json()
        song = ada.post(
            "/api/songs",
            json={"title": "Band Song", "content_kind": "chords", "chordpro": "[G]Together", "library": band["id"]},
        ).json()
        assert song["library_id"] == band["id"]
        mine = _sheet(ada, "Private")
        members = f"/api/libraries/{band['id']}/members"
        assert ada.post(members, json={"email": "bea@example.test", "role": "view"}).status_code in {200, 201}
        bea_id = bea.get("/api/me").json()["user_id"]

        # A viewer cannot delete, and sees no trash.
        assert bea.delete(f"/api/songs/{song['id']}").status_code == 403
        assert ada.delete(f"/api/songs/{song['id']}").status_code == 204
        assert ada.delete(f"/api/songs/{mine['id']}").status_code == 204
        assert bea.get("/api/songs", params={"library": band["id"]}).json()["total"] == 0
        assert bea.get(f"/api/songs/{song['id']}").status_code == 404
        assert bea.get("/api/trash", params={"library": band["id"]}).status_code == 403
        assert bea.post(f"/api/trash/{song['id']}/restore").status_code == 404
        assert bea.delete(f"/api/trash/{song['id']}").status_code == 404
        assert bea.delete("/api/trash", params={"library": band["id"]}).status_code == 403
        # Someone outside the band learns nothing.
        assert cy.get("/api/trash", params={"library": band["id"]}).status_code == 404
        assert cy.post(f"/api/trash/{song['id']}/restore").status_code == 404
        assert cy.post(f"/api/trash/{mine['id']}/restore").status_code == 404
        assert cy.get("/api/trash").json()["items"] == []

        # Each library has its own trash.
        assert [item["id"] for item in ada.get("/api/trash").json()["items"]] == [mine["id"]]
        in_band = ada.get("/api/trash", params={"library": band["id"]}).json()["items"]
        assert [item["id"] for item in in_band] == [song["id"]]

        # An editor restores what another editor deleted.
        assert ada.patch(f"{members}/{bea_id}", json={"role": "edit"}).status_code == 200
        restored = bea.post(f"/api/trash/{song['id']}/restore")
        assert restored.status_code == 200 and restored.json()["library_id"] == band["id"]

        # A band whose songs are all in the trash can be deleted; the trash goes with it.
        assert bea.delete(f"/api/songs/{song['id']}").status_code == 204
        assert ada.delete(f"/api/libraries/{band['id']}").status_code == 204
        assert ada.post(f"/api/trash/{song['id']}/restore").status_code == 404
        assert [item["id"] for item in ada.get("/api/trash").json()["items"]] == [mine["id"]]
