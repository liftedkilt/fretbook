"""Setlists: CRUD, ordering, ownership, and the backup round trip."""

import io
import json
import time
import zipfile
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fretbook.app import create_app
from fretbook.config import Settings
from fretbook.storage.repository import SongRepository
from fretbook.storage.setlists import MAX_ENTRIES, EntryInput, SetlistRepository, TooManyEntries, UnknownSongs

SHEET = "{title: Hello}\n[G]Hello [C]friend\n"


@pytest.fixture
def client(tmp_path: Path):
    with TestClient(create_app(replace(Settings.for_tests(tmp_path / "a")))) as started:
        yield started


def _song(client: TestClient, title: str, kind: str = "chords") -> str:
    body = {"content_kind": "chords", "title": title, "chordpro": SHEET} if kind == "chords" else {"title": title}
    return client.post("/api/songs", json=body).json()["id"]


def _titles(setlist: dict) -> list[str]:
    return [entry["title"] for entry in setlist["entries"]]


def test_create_rename_list_and_delete(client: TestClient) -> None:
    created = client.post("/api/setlists", json={"name": "  Friday gig "})
    assert created.status_code == 201
    setlist = created.json()
    assert setlist["name"] == "Friday gig"
    assert setlist["entries"] == [] and setlist["entry_count"] == 0

    renamed = client.patch(f"/api/setlists/{setlist['id']}", json={"name": "Saturday"})
    assert renamed.json()["name"] == "Saturday"
    listed = client.get("/api/setlists").json()
    assert [(row["name"], row["entry_count"]) for row in listed] == [("Saturday", 0)]

    assert client.delete(f"/api/setlists/{setlist['id']}").status_code == 204
    assert client.get(f"/api/setlists/{setlist['id']}").json()["detail"]["key"] == "setlist.notFound"
    assert client.delete(f"/api/setlists/{setlist['id']}").status_code == 404
    assert client.patch(f"/api/setlists/{setlist['id']}", json={"name": "x"}).status_code == 404
    assert client.put(f"/api/setlists/{setlist['id']}/entries", json={"entries": []}).status_code == 404
    assert client.post(f"/api/setlists/{setlist['id']}/entries", json={"song_id": "x"}).status_code == 404


def test_blank_names_are_refused(client: TestClient) -> None:
    assert client.post("/api/setlists", json={"name": ""}).status_code == 422
    assert client.post("/api/setlists", json={"name": "   "}).json()["name"] == "Untitled"


def test_entries_keep_their_order_note_and_transpose(client: TestClient) -> None:
    a, b, c = (_song(client, title) for title in ("Alpha", "Bravo", "Charlie"))
    setlist = client.post("/api/setlists", json={"name": "Set"}).json()
    url = f"/api/setlists/{setlist['id']}/entries"

    added = client.post(url, json={"song_id": a, "note": "capo 2", "transpose": 2})
    assert added.status_code == 201
    client.post(url, json={"song_id": b})
    client.post(url, json={"song_id": c})
    loaded = client.get(f"/api/setlists/{setlist['id']}").json()
    assert _titles(loaded) == ["Alpha", "Bravo", "Charlie"]
    assert (loaded["entries"][0]["note"], loaded["entries"][0]["transpose"]) == ("capo 2", 2)
    assert loaded["entry_count"] == 3

    reordered = client.put(
        url,
        json={
            "entries": [
                {"song_id": c},
                {"song_id": a, "note": "skip solo", "transpose": -3},
                {"song_id": a},
            ]
        },
    ).json()
    assert _titles(reordered) == ["Charlie", "Alpha", "Alpha"]  # a song may repeat
    assert [entry["note"] for entry in reordered["entries"]] == ["", "skip solo", ""]
    assert reordered["entries"][1]["transpose"] == -3
    assert len({entry["id"] for entry in reordered["entries"]}) == 3
    assert client.get("/api/setlists").json()[0]["entry_count"] == 3


def test_a_song_can_be_in_many_setlists_and_leaves_them_when_deleted(client: TestClient) -> None:
    song = _song(client, "Shared")
    other = _song(client, "Other")
    ids = []
    for name in ("One", "Two"):
        setlist = client.post("/api/setlists", json={"name": name, "entries": [{"song_id": song}, {"song_id": other}]})
        ids.append(setlist.json()["id"])
    assert client.delete(f"/api/songs/{song}").status_code == 204
    for setlist_id in ids:
        assert _titles(client.get(f"/api/setlists/{setlist_id}").json()) == ["Other"]


def test_entry_limits_and_validation(client: TestClient) -> None:
    song = _song(client, "Alpha")
    setlist = client.post("/api/setlists", json={"name": "Set"}).json()
    url = f"/api/setlists/{setlist['id']}/entries"
    assert client.post(url, json={"song_id": "nope"}).json()["detail"]["key"] == "setlist.unknownSong"
    assert client.post(url, json={"song_id": song, "transpose": 12}).status_code == 422
    assert client.post(url, json={"song_id": song, "note": "x" * 501}).status_code == 422
    too_many = {"entries": [{"song_id": song}] * 501}
    assert client.put(url, json=too_many).status_code == 422
    # A refused save leaves the list as it was.
    client.post(url, json={"song_id": song})
    assert client.put(url, json={"entries": [{"song_id": song}, {"song_id": "nope"}]}).status_code == 400
    assert _titles(client.get(f"/api/setlists/{setlist['id']}").json()) == ["Alpha"]


def test_repository_limits(tmp_path: Path) -> None:
    settings = Settings.for_tests(tmp_path / "r")
    with TestClient(create_app(settings)):
        songs = SongRepository(settings)
        songs.ensure_user("ann", "Ann")
        song = songs.create_song(
            "ann", title="S", artist="", source_kind="manual", source_ref={}, document=None, chordpro=SHEET
        )
        repo = SetlistRepository(settings)
        made = repo.create_setlist("ann", "x" * 500, [EntryInput(song["id"], "n" * 900, 40)])
        assert len(made["name"]) == 200
        assert (len(made["entries"][0]["note"]), made["entries"][0]["transpose"]) == (500, 11)
        with pytest.raises(TooManyEntries):
            repo.replace_entries("ann", made["id"], [EntryInput(song["id"])] * (MAX_ENTRIES + 1))


def test_setlists_are_private_to_their_owner(tmp_path: Path) -> None:
    settings = Settings.for_tests(tmp_path / "p")
    with TestClient(create_app(settings)):
        songs = SongRepository(settings)
        for user in ("ann", "bob"):
            songs.ensure_user(user, user)
        make = {"source_kind": "manual", "source_ref": {}, "document": None, "chordpro": SHEET, "artist": ""}
        ann_song = songs.create_song("ann", title="Ann's", **make)
        bob_song = songs.create_song("bob", title="Bob's", **make)
        repo = SetlistRepository(settings)
        mine = repo.create_setlist("ann", "Ann's set", [EntryInput(ann_song["id"])])

        assert repo.get_setlist("bob", mine["id"]) is None
        assert repo.list_setlists("bob") == []
        assert repo.rename("bob", mine["id"], "mine now") is None
        assert repo.replace_entries("bob", mine["id"], []) is None
        assert repo.append_entry("bob", mine["id"], EntryInput(bob_song["id"])) is None
        assert repo.delete_setlist("bob", mine["id"]) is False
        # Ann cannot slip Bob's song into her list, so its title never leaks.
        with pytest.raises(UnknownSongs):
            repo.append_entry("ann", mine["id"], EntryInput(bob_song["id"]))
        assert [entry["title"] for entry in repo.get_setlist("ann", mine["id"])["entries"]] == ["Ann's"]


def test_adopting_the_local_library_moves_its_setlists(tmp_path: Path) -> None:
    settings = Settings.for_tests(tmp_path / "adopt")
    with TestClient(create_app(settings)) as client:
        song = _song(client, "Local")
        created = client.post("/api/setlists", json={"name": "Local set", "entries": [{"song_id": song}]}).json()
        ctx = client.app.state.ctx
        ctx.songs.ensure_user("ann", "Ann")
        ctx.users.adopt_local("ann")
        repo = SetlistRepository(settings)
        assert repo.get_setlist("local", created["id"]) is None
        assert _titles(repo.get_setlist("ann", created["id"])) == ["Local"]


def _restore(client: TestClient, archive: bytes, mode: str = "skip") -> dict:
    response = client.post("/api/library/import", files={"file": ("lib.zip", archive)}, data={"mode": mode})
    assert response.status_code == 202, response.text
    job_id = response.json()["job_id"]
    client.app.state.ctx.jobs.run_once()
    for _ in range(50):
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in {"done", "error"}:
            return job
        time.sleep(0.1)
    raise AssertionError("restore did not finish")


def test_backup_round_trip_keeps_setlists(tmp_path: Path) -> None:
    with TestClient(create_app(Settings.for_tests(tmp_path / "src"))) as source:
        a, b = _song(source, "Alpha"), _song(source, "Bravo")
        source.post(
            "/api/setlists",
            json={
                "name": "Friday",
                "entries": [
                    {"song_id": b, "note": "capo 3", "transpose": 3},
                    {"song_id": a},
                    {"song_id": b},
                ],
            },
        )
        source.post("/api/setlists", json={"name": "Empty"})
        archive = source.get("/api/library/export").content
        with zipfile.ZipFile(io.BytesIO(archive)) as zf:
            manifest = json.loads(zf.read("manifest.json"))
        assert manifest["format_version"] == 1
        assert {item["name"] for item in manifest["setlists"]} == {"Friday", "Empty"}

        with TestClient(create_app(Settings.for_tests(tmp_path / "dst"))) as target:
            job = _restore(target, archive)
            assert job["status"] == "done", job
            assert job["result"]["setlists"] == 2
            names = {row["name"]: row for row in target.get("/api/setlists").json()}
            friday = target.get(f"/api/setlists/{names['Friday']['id']}").json()
            assert _titles(friday) == ["Bravo", "Alpha", "Bravo"]
            assert (friday["entries"][0]["note"], friday["entries"][0]["transpose"]) == ("capo 3", 3)
            assert names["Empty"]["entry_count"] == 0

            # Restoring again skips setlists that are already there, and copies them on request.
            again = _restore(target, archive, "skip")["result"]
            assert again["setlists"] == 0 and again["skipped"] == 2
            assert len(target.get("/api/setlists").json()) == 2
            copied = _restore(target, archive, "copy")["result"]
            assert copied["setlists"] == 2
            assert len(target.get("/api/setlists").json()) == 4


def test_restored_setlists_follow_songs_that_got_new_ids_or_already_existed(tmp_path: Path) -> None:
    with TestClient(create_app(Settings.for_tests(tmp_path / "src"))) as source:
        a = _song(source, "Alpha")
        source.post("/api/setlists", json={"name": "Set", "entries": [{"song_id": a}]})
        archive = source.get("/api/library/export").content

        with TestClient(create_app(Settings.for_tests(tmp_path / "dst"))) as target:
            # The same song (title, artist, source) lives here under a different id: the setlist points at it.
            existing = target.post(
                "/api/songs", json={"content_kind": "chords", "title": "Alpha", "chordpro": SHEET}
            ).json()["id"]
            assert existing != a
            assert _restore(target, archive, "skip")["result"]["skipped"] == 1
            setlist = target.get("/api/setlists").json()[0]
            assert target.get(f"/api/setlists/{setlist['id']}").json()["entries"][0]["song_id"] == existing

            # Kept as a copy, the song's id is taken, so it gets a new one and the setlist follows it.
            _restore(target, archive, "copy")
            copied = [row for row in target.get("/api/setlists").json()]
            assert len(copied) == 2
            for row in copied:
                entry = target.get(f"/api/setlists/{row['id']}").json()["entries"][0]
                assert target.get(f"/api/songs/{entry['song_id']}").status_code == 200


def test_restore_drops_entries_for_songs_that_are_not_in_the_archive(tmp_path: Path) -> None:
    buffer = io.BytesIO()
    manifest = {
        "format": "fretbook-library",
        "format_version": 1,
        "songs": [
            {
                "id": "s1",
                "title": "Hello",
                "content_kind": "chords",
                "file": "songs/s1/song.cho",
            }
        ],
        "setlists": [
            {
                "id": "l1",
                "name": "Set",
                "entries": [{"song_id": "s1", "transpose": 2}, {"song_id": "ghost"}],
            },
            {"id": "../bad", "name": "Bad", "entries": []},
        ],
    }
    with zipfile.ZipFile(buffer, "w") as zf:
        zf.writestr("songs/s1/song.cho", SHEET)
        zf.writestr("manifest.json", json.dumps(manifest))
    with TestClient(create_app(Settings.for_tests(tmp_path / "dst"))) as target:
        refused = target.post("/api/library/import", files={"file": ("l.zip", buffer.getvalue())})
        assert refused.json()["detail"]["key"] == "backup.badManifest"

        manifest["setlists"].pop()
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as zf:
            zf.writestr("songs/s1/song.cho", SHEET)
            zf.writestr("manifest.json", json.dumps(manifest))
        job = _restore(target, buffer.getvalue())
        assert job["result"]["setlists"] == 1
        assert [w["key"] for w in job["result"]["warnings"]] == ["backup.setlistEntriesDropped"]
        setlist = target.get("/api/setlists").json()[0]
        entries = target.get(f"/api/setlists/{setlist['id']}").json()["entries"]
        assert [(e["title"], e["transpose"]) for e in entries] == [("Hello", 2)]
