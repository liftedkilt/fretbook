"""Tags, favourites, the library filters on them, suggestions on import, and backup."""

from __future__ import annotations

import io
import json
import time
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fretbook.app import create_app
from fretbook.config import Settings
from fretbook.tags import MAX_TAG_CHARS, MAX_TAGS_PER_SONG, clean_tags, suggest_tags

SHEET = "{title: Hello}\n{key: G}\n{capo: 2}\n[G]Hello [C]friend\n"


@pytest.fixture
def client(tmp_path: Path):
    with TestClient(create_app(Settings.for_tests(tmp_path))) as test_client:
        yield test_client


def _tab(client: TestClient, title: str, preset: str = "bass-4") -> dict:
    return client.post("/api/songs", json={"title": title, "preset": preset}).json()


def _tag(client: TestClient, song_id: str, *tags: str) -> list[str]:
    response = client.put(f"/api/songs/{song_id}/tags", json={"tags": list(tags)})
    assert response.status_code == 200, response.text
    return response.json()["tags"]


def _titles(client: TestClient, **params: object) -> list[str]:
    response = client.get("/api/songs", params=params)
    assert response.status_code == 200, response.text
    return sorted(item["title"] for item in response.json()["items"])


def test_clean_tags_trims_dedupes_and_caps() -> None:
    assert clean_tags(["  Warm   up ", "warm up", "", "   ", "Jazz"]) == ["Warm up", "Jazz"]
    assert clean_tags(["x" * 100]) == ["x" * MAX_TAG_CHARS]
    assert len(clean_tags([f"t{index}" for index in range(100)])) == MAX_TAGS_PER_SONG


def test_tags_match_ignoring_case_beyond_ascii(client: TestClient) -> None:
    one, two = _tab(client, "One")["id"], _tab(client, "Two")["id"]
    _tag(client, one, "Prática")
    assert _tag(client, two, "PRÁTICA", "prática") == ["PRÁTICA"]
    assert _titles(client, tag=["prática"]) == ["One", "Two"]
    assert [item["count"] for item in client.get("/api/tags").json()] == [2]


def test_ascii_tab_save_applies_suggestions(client: TestClient) -> None:
    text = "e|-0-3-|\nB|-----|\nG|-----|\nD|-----|\nA|-----|\nE|-----|\n"
    response = client.post("/api/imports/ascii-tab", json={"text": text, "title": "Pasted"})
    assert response.status_code == 201, response.text
    assert response.json()["tags"]  # the instrument of the converted tab


def test_set_tags_replaces_and_sorts_them(client: TestClient) -> None:
    song = _tab(client, "Riff")
    assert song["tags"] == [] and song["favourite"] is False
    assert _tag(client, song["id"], "warm-up", "Funk", "FUNK") == ["Funk", "warm-up"]
    assert client.get(f"/api/songs/{song['id']}").json()["tags"] == ["Funk", "warm-up"]
    assert _tag(client, song["id"]) == []
    assert client.put("/api/songs/nope/tags", json={"tags": ["a"]}).status_code == 404


def test_tags_and_favourite_do_not_touch_the_revision(client: TestClient) -> None:
    song = _tab(client, "Riff")
    _tag(client, song["id"], "funk")
    assert client.put(f"/api/songs/{song['id']}/favourite", json={"favourite": True}).json() == {"favourite": True}
    after = client.get(f"/api/songs/{song['id']}").json()
    assert (after["revision"], after["updated_at"]) == (song["revision"], song["updated_at"])
    assert after["favourite"] is True
    assert client.put("/api/songs/nope/favourite", json={"favourite": True}).status_code == 404


def test_filter_by_several_tags_needs_all_of_them(client: TestClient) -> None:
    one, two, three = (_tab(client, name)["id"] for name in ("One", "Two", "Three"))
    _tag(client, one, "funk", "slap")
    _tag(client, two, "Funk")
    _tag(client, three, "slap")

    assert _titles(client, tag=["funk"]) == ["One", "Two"]
    assert _titles(client, tag=["FUNK", "slap"]) == ["One"]
    assert _titles(client, tag=["funk", "missing"]) == []
    assert _titles(client) == ["One", "Three", "Two"]
    page = client.get("/api/songs", params={"tag": ["funk", "slap"]}).json()
    assert page["total"] == 1 and page["counts"]["all"] == 3
    assert [item["tags"] for item in page["items"]] == [["funk", "slap"]]


def test_favourites_filter_and_count(client: TestClient) -> None:
    star, plain = _tab(client, "Star")["id"], _tab(client, "Plain")["id"]
    client.put(f"/api/songs/{star}/favourite", json={"favourite": True})
    _tag(client, star, "funk")
    _tag(client, plain, "funk")

    assert _titles(client, favourite="true") == ["Star"]
    assert _titles(client, favourite="true", tag=["funk"]) == ["Star"]
    assert client.get("/api/songs").json()["counts"]["favourites"] == 1
    client.put(f"/api/songs/{star}/favourite", json={"favourite": False})
    assert _titles(client, favourite="true") == []


def test_tag_list_counts_songs_and_bulk_add(client: TestClient) -> None:
    ids = [_tab(client, name)["id"] for name in ("A", "B", "C")]
    _tag(client, ids[0], "funk")
    response = client.post("/api/tags/add", json={"song_ids": [*ids, "unknown"], "tags": ["Funk", "Live"]})
    assert response.json() == {"updated": 3}
    # Spellings differ between songs; the list shows one of them per tag.
    listed = client.get("/api/tags").json()
    assert [(item["tag"].lower(), item["count"]) for item in listed] == [("funk", 3), ("live", 3)]
    assert _titles(client, tag=["live"]) == ["A", "B", "C"]
    assert client.post("/api/tags/add", json={"song_ids": [], "tags": ["x"]}).status_code == 422


def test_bulk_add_stops_at_the_tag_limit(client: TestClient) -> None:
    song = _tab(client, "Full")["id"]
    _tag(client, song, *[f"t{index:02}" for index in range(MAX_TAGS_PER_SONG)])
    client.post("/api/tags/add", json={"song_ids": [song], "tags": ["extra"]})
    assert len(client.get(f"/api/songs/{song}").json()["tags"]) == MAX_TAGS_PER_SONG


def test_other_owners_cannot_see_or_change_tags(client: TestClient) -> None:
    songs = client.app.state.ctx.songs
    songs.ensure_user("other", "Other")
    mine = _tab(client, "Mine")["id"]
    theirs = songs.create_blank(
        "other", title="Theirs", artist="", preset_id="bass-4", bpm=100, measures=1, signature=(4, 4)
    )["id"]
    songs.set_tags("other", theirs, ["secret"])

    assert songs.set_tags("local", theirs, ["mine now"]) is None
    assert songs.add_tags("local", [theirs], ["mine now"]) == 0
    assert songs.set_favourite("local", theirs, True) is False
    assert client.get("/api/tags").json() == []
    assert _titles(client, tag=["secret"]) == []
    _tag(client, mine, "secret")
    assert songs.list_tags("other") == [{"tag": "secret", "count": 1}]


def test_deleting_a_song_removes_its_tags(client: TestClient) -> None:
    song = _tab(client, "Gone")["id"]
    _tag(client, song, "funk")
    client.delete(f"/api/songs/{song}")
    assert client.get("/api/tags").json() == []


def test_suggestions_for_a_tab_and_a_chord_sheet(client: TestClient) -> None:
    drop_d = _tab(client, "Drop", preset="guitar-drop-d")
    assert suggest_tags(drop_d) == ["Guitar", "Drop D"]
    assert suggest_tags(_tab(client, "Bass")) == ["Bass guitar"]

    document = drop_d["document"]
    document["tracks"][0]["capo"] = 3
    assert suggest_tags({**drop_d, "document": document}) == ["Guitar", "Drop D", "Capo 3"]

    chords = client.post("/api/songs", json={"content_kind": "chords", "title": "Hello", "chordpro": SHEET}).json()
    assert suggest_tags(chords) == ["Key of G", "Capo 2"]
    plain = client.post("/api/songs", json={"content_kind": "chords", "chordpro": "[C]x"}).json()
    assert suggest_tags(plain) == []


def test_document_import_applies_suggestions(client: TestClient) -> None:
    source = _tab(client, "Source", preset="guitar-acoustic")
    response = client.post("/api/songs/import-document", json={"title": "Imported", "document": source["document"]})
    assert response.status_code == 201
    assert response.json()["tags"] == ["Acoustic guitar"]


def _restore(client: TestClient, archive: bytes) -> dict:
    response = client.post("/api/library/import", files={"file": ("lib.zip", archive)}, data={"mode": "skip"})
    assert response.status_code == 202, response.text
    job_id = response.json()["job_id"]
    client.app.state.ctx.jobs.run_once()
    for _ in range(50):
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in {"done", "error"}:
            return job
        time.sleep(0.1)
    raise AssertionError("restore did not finish")


def test_tags_and_favourites_survive_a_backup_round_trip(tmp_path: Path) -> None:
    with TestClient(create_app(Settings.for_tests(tmp_path / "src"))) as source:
        song = _tab(source, "Riff")["id"]
        _tag(source, song, "funk", "Warm up")
        source.put(f"/api/songs/{song}/favourite", json={"favourite": True})
        archive = source.get("/api/library/export").content
    with zipfile.ZipFile(io.BytesIO(archive)) as opened:
        entry = json.loads(opened.read("manifest.json"))["songs"][0]
    assert entry["tags"] == ["funk", "Warm up"] and entry["favourite"] is True

    with TestClient(create_app(Settings.for_tests(tmp_path / "dst"))) as target:
        assert _restore(target, archive)["status"] == "done"
        restored = target.get("/api/songs").json()["items"][0]
        assert restored["tags"] == ["funk", "Warm up"] and restored["favourite"] is True


def test_restore_cleans_hostile_tags_and_reads_old_archives(tmp_path: Path) -> None:
    def archive(extra: dict) -> bytes:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as out:
            out.writestr("songs/s1/song.cho", "[C]Hello\n")
            entry = {"id": "s1", "title": "Hi", "content_kind": "chords", "file": "songs/s1/song.cho", **extra}
            manifest = {"format": "fretbook-library", "format_version": 1, "songs": [entry]}
            out.writestr("manifest.json", json.dumps(manifest))
        return buffer.getvalue()

    with TestClient(create_app(Settings.for_tests(tmp_path))) as client:
        job = _restore(client, archive({"tags": ["  Ok  ", "ok", "", "y" * 100], "favourite": True}))
        assert job["status"] == "done", job
        song = client.get("/api/songs").json()["items"][0]
        assert song["tags"] == ["Ok", "y" * MAX_TAG_CHARS] and song["favourite"] is True
        client.delete(f"/api/songs/{song['id']}")

        # A tag list of the wrong shape makes the manifest invalid; an archive without the fields restores plain.
        refused = client.post(
            "/api/library/import", files={"file": ("lib.zip", archive({"tags": [["nested"]]}))}, data={"mode": "skip"}
        )
        assert refused.status_code == 400 and refused.json()["detail"]["key"] == "backup.badManifest"
        old = _restore(client, archive({}))
        assert old["result"]["imported"] == 1
        assert client.get("/api/songs").json()["items"][0]["tags"] == []


def _revision(client: TestClient, song_id: str) -> tuple[int, str]:
    song = client.get(f"/api/songs/{song_id}").json()
    return song["revision"], song["updated_at"]


def _counts(client: TestClient) -> dict[str, int]:
    return {item["tag"]: item["count"] for item in client.get("/api/tags").json()}


def test_rename_tag_everywhere_leaves_the_revision_alone(client: TestClient) -> None:
    one, two = _tab(client, "One")["id"], _tab(client, "Two")["id"]
    _tag(client, one, "Warmup", "Jazz")
    _tag(client, two, "warmup")
    before = _revision(client, one)

    response = client.patch("/api/tags/WARMUP", json={"name": "  Warm   up "})
    assert response.status_code == 200, response.text
    assert response.json() == {"updated": 2}
    assert client.get(f"/api/songs/{one}").json()["tags"] == ["Jazz", "Warm up"]
    assert client.get(f"/api/songs/{two}").json()["tags"] == ["Warm up"]
    assert _revision(client, one) == before
    assert _titles(client, tag=["warm up"]) == ["One", "Two"]


def test_rename_only_changes_case(client: TestClient) -> None:
    song = _tab(client, "One")["id"]
    _tag(client, song, "jazz")
    assert client.patch("/api/tags/jazz", json={"name": "Jazz"}).json() == {"updated": 1}
    assert _counts(client) == {"Jazz": 1}


def test_merge_keeps_one_tag_per_song(client: TestClient) -> None:
    both, only_old, only_new = (_tab(client, name)["id"] for name in ("Both", "Old", "New"))
    _tag(client, both, "rock", "Rock n Roll")
    _tag(client, only_old, "rock")
    _tag(client, only_new, "rock n roll")

    response = client.patch("/api/tags/rock", json={"name": "ROCK N ROLL"})
    assert response.json() == {"updated": 2}
    assert _counts(client) == {"ROCK N ROLL": 3}
    assert client.get(f"/api/songs/{both}").json()["tags"] == ["ROCK N ROLL"]
    assert _titles(client, tag=["rock"]) == []


def test_rename_validates_and_reports_unknown_tags(client: TestClient) -> None:
    song = _tab(client, "One")["id"]
    _tag(client, song, "jazz")
    assert client.patch("/api/tags/jazz", json={"name": "   "}).status_code == 422
    missing = client.patch("/api/tags/blues", json={"name": "x"})
    assert missing.status_code == 404
    assert missing.json()["detail"]["key"] == "tag.notFound"
    assert client.get(f"/api/songs/{song}").json()["tags"] == ["jazz"]


def test_delete_tag_from_every_song(client: TestClient) -> None:
    one, two = _tab(client, "One")["id"], _tab(client, "Two")["id"]
    _tag(client, one, "Old", "keep")
    _tag(client, two, "old")
    before = _revision(client, one)

    response = client.delete("/api/tags/OLD")
    assert response.status_code == 200, response.text
    assert response.json() == {"updated": 2}
    assert _counts(client) == {"keep": 1}
    assert _revision(client, one) == before
    assert client.delete("/api/tags/old").status_code == 404


def test_tag_changes_with_a_slash_in_the_name(client: TestClient) -> None:
    song = _tab(client, "One")["id"]
    _tag(client, song, "a/b")
    assert client.patch("/api/tags/a%2Fb", json={"name": "c/d"}).status_code == 200
    assert _counts(client) == {"c/d": 1}
    assert client.delete("/api/tags/c%2Fd").status_code == 200
