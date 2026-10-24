"""Song metadata: key detection, the metadata and cover endpoints, library filters, lookup, and backup."""

from __future__ import annotations

import io
import json
import time
import zipfile
from dataclasses import replace
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from fretbook import metadata as song_metadata
from fretbook.app import create_app
from fretbook.config import Settings
from fretbook.importers.safe_fetch import SafeFetcher
from fretbook.score import key as key_detect
from fretbook.score.model import Bar, Beat, Note, ScoreDocument, Track, TrackBar, Voice

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32
WEBP = b"RIFF\x00\x00\x00\x00WEBP" + b"\x00" * 16
GUITAR = [64, 59, 55, 50, 45, 40]


def _score(pitches: list[int], *, capo: int = 0) -> ScoreDocument:
    """A one-voice guitar score playing each pitch once, on whichever string reaches it in the first 12 frets."""
    beats = []
    for index, pitch in enumerate(pitches):
        string = next(i for i, open_string in enumerate(GUITAR) if 0 <= pitch - capo - open_string <= 12)
        note = Note(string=string, fret=pitch - capo - GUITAR[string])
        beats.append(Beat(position=index * 960, duration=960, notes=[note]))
    bars = [Bar(signature=(len(beats), 4))]
    track = Track(
        id="t1", name="Guitar", instrument="guitar", capo=capo, tuning_midi=GUITAR, preferred=True,
        bars=[TrackBar(voices=[Voice(beats=beats)])],
    )  # fmt: skip
    return ScoreDocument(bpm=100, bars=bars, tracks=[track])


C_MAJOR = [60, 62, 64, 65, 67, 69, 71, 72, 60, 64, 67, 64, 60, 67, 60, 64]
A_MINOR = [57, 59, 60, 62, 64, 65, 68, 69, 57, 60, 64, 60, 57, 64, 57, 60]


@pytest.fixture
def client(tmp_path: Path):
    with TestClient(create_app(Settings.for_tests(tmp_path))) as test_client:
        yield test_client


def _blank(client: TestClient, title: str = "Riff") -> dict:
    return client.post("/api/songs", json={"title": title, "preset": "bass-4"}).json()


def _song_with(client: TestClient, document: ScoreDocument, title: str = "Tune") -> dict:
    ctx = client.app.state.ctx
    return ctx.songs.create_song("local", title=title, artist="", source_kind="manual", document=document)


# --- key detection ---------------------------------------------------------------------------------------------


def test_detects_major_and_minor_keys() -> None:
    assert key_detect.detect_key(_score(C_MAJOR)) == "C"
    assert key_detect.detect_key(_score(A_MINOR)) == "Am"


def test_detection_follows_the_capo() -> None:
    assert key_detect.detect_key(_score(C_MAJOR, capo=2)) == "C"


def test_too_few_notes_or_an_empty_score_have_no_key() -> None:
    assert key_detect.detect_key(_score([60, 64, 67])) is None
    blank = Track(id="t", name="n", instrument="guitar", tuning_midi=GUITAR, bars=[TrackBar()])
    assert key_detect.detect_key(ScoreDocument(bpm=90, bars=[Bar()], tracks=[blank])) is None
    assert key_detect.best_key([0.0] * 12) is None


def test_dead_and_tied_notes_are_ignored() -> None:
    document = _score(C_MAJOR)
    beats = document.tracks[0].bars[0].voices[0].beats
    for beat in beats:
        beat.notes[0].dead = True
    assert key_detect.detect_key(document) is None


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("C", "C"),
        ("c#", "Db"),
        ("F#m", "F#m"),
        ("Bb minor", "Bbm"),
        ("a min", "Am"),
        ("G♭ major", "F#"),
        ("D♯m", "D#m"),
    ],
)
def test_parse_key_names(text: str, expected: str) -> None:
    assert key_detect.parse_key(text) == expected
    assert expected in key_detect.KEYS


@pytest.mark.parametrize("text", ["", "H", "C dorian", "key of C", "Cmaj7"])
def test_parse_key_refuses_other_text(text: str) -> None:
    assert key_detect.parse_key(text) is None


def test_chord_sheet_key_comes_from_its_directive(client: TestClient) -> None:
    sheet = client.post("/api/songs", json={"title": "Sheet", "content_kind": "chords"}).json()
    assert sheet["key"] is None
    ctx = client.app.state.ctx
    made = ctx.songs.create_song(
        "local", title="Hi", artist="", source_kind="manual", chordpro="{key: Em}\n[Em]Hello [G]you\n"
    )
    assert made["key"] == "Em" and made["key_detected"] is True


def test_a_saved_score_gets_a_detected_key_and_editing_redetects(client: TestClient) -> None:
    song = _song_with(client, _score(C_MAJOR))
    assert song["key"] == "C" and song["key_detected"] is True
    updated = client.put(
        f"/api/songs/{song['id']}",
        json={"title": "Tune", "artist": "", "revision": song["revision"], "document": _score(A_MINOR).model_dump()},
    ).json()
    assert updated["key"] == "Am"


def test_refresh_keys_fills_songs_saved_before_detection(client: TestClient) -> None:
    song = _song_with(client, _score(C_MAJOR))
    ctx = client.app.state.ctx
    from fretbook.db.connection import session

    with session(ctx.settings.database_path) as conn:
        conn.execute("UPDATE songs SET detected_key = NULL, key_version = NULL WHERE id = ?", (song["id"],))
    assert client.get(f"/api/songs/{song['id']}").json()["key"] is None
    assert ctx.songs.refresh_keys() == 1
    assert client.get(f"/api/songs/{song['id']}").json()["key"] == "C"
    assert ctx.songs.refresh_keys() == 0


# --- metadata --------------------------------------------------------------------------------------------------


def test_new_songs_have_empty_metadata(client: TestClient) -> None:
    song = _blank(client)
    assert (song["genre"], song["album"], song["notes"]) == ("", "", "")
    assert song["year"] is None and song["cover_url"] is None


def test_patch_sets_clears_and_keeps_fields(client: TestClient) -> None:
    song = _song_with(client, _score(C_MAJOR))
    url = f"/api/songs/{song['id']}/metadata"
    done = client.patch(
        url, json={"key": "f# minor", "genre": " Blues ", "album": "Live", "year": 1999, "notes": "# Hi\n\nplay *slow*"}
    )
    assert done.status_code == 200, done.text
    body = done.json()
    assert (body["key"], body["key_detected"], body["genre"], body["album"], body["year"]) == (
        "F#m",
        False,
        "Blues",
        "Live",
        1999,
    )
    assert body["notes"] == "# Hi\n\nplay *slow*"
    # Fields left out stay; an empty key falls back to the detected one.
    again = client.patch(url, json={"key": "", "year": None}).json()
    assert (again["key"], again["key_detected"], again["genre"], again["year"]) == ("C", True, "Blues", None)
    assert again["notes"] == body["notes"]


def test_patch_leaves_the_revision_alone(client: TestClient) -> None:
    song = _blank(client)
    after = client.patch(f"/api/songs/{song['id']}/metadata", json={"genre": "Funk"}).json()
    assert (after["revision"], after["updated_at"]) == (song["revision"], song["updated_at"])


@pytest.mark.parametrize(
    "body",
    [{"key": "H"}, {"key": "C dorian"}, {"year": 12}, {"year": 3500}, {"genre": "x" * 81}, {"album": "y" * 201}],
)
def test_patch_refuses_bad_values(client: TestClient, body: dict) -> None:
    song = _blank(client)
    response = client.patch(f"/api/songs/{song['id']}/metadata", json=body)
    assert response.status_code == 422, response.text


def test_patch_refuses_long_notes_and_unknown_songs(client: TestClient) -> None:
    song = _blank(client)
    too_long = client.patch(f"/api/songs/{song['id']}/metadata", json={"notes": "n" * 20_001})
    assert too_long.status_code == 422 and too_long.json()["detail"]["key"] == "metadata.invalid"
    assert client.patch("/api/songs/nope/metadata", json={"genre": "x"}).status_code == 404


def test_editor_saves_keep_metadata(client: TestClient) -> None:
    song = _blank(client)
    client.patch(f"/api/songs/{song['id']}/metadata", json={"genre": "Soul", "notes": "keep me"})
    saved = client.put(
        f"/api/songs/{song['id']}",
        json={"title": "New", "artist": "A", "revision": song["revision"], "document": song["document"]},
    ).json()
    assert (saved["genre"], saved["notes"]) == ("Soul", "keep me")


def test_library_filters_and_facets(client: TestClient) -> None:
    major = _song_with(client, _score(C_MAJOR), "Major")
    minor = _song_with(client, _score(A_MINOR), "Minor")
    plain = _blank(client, "Plain")
    client.patch(f"/api/songs/{major['id']}/metadata", json={"genre": "Rock"})
    client.patch(f"/api/songs/{minor['id']}/metadata", json={"genre": "rock"})
    client.patch(f"/api/songs/{plain['id']}/metadata", json={"key": "C"})

    def titles(**params: str) -> list[str]:
        return sorted(item["title"] for item in client.get("/api/songs", params=params).json()["items"])

    assert titles(key="C") == ["Major", "Plain"]
    assert titles(key="Am") == ["Minor"]
    assert titles(genre="ROCK") == ["Major", "Minor"]
    assert titles(key="C", genre="rock") == ["Major"]
    facets = client.get("/api/library/facets").json()
    assert facets["keys"] == [{"name": "C", "count": 2}, {"name": "Am", "count": 1}]
    assert [item["count"] for item in facets["genres"]] == [2]


# --- cover art -------------------------------------------------------------------------------------------------


@pytest.mark.parametrize(("data", "kind"), [(PNG, "image/png"), (JPEG, "image/jpeg"), (WEBP, "image/webp")])
def test_cover_upload_serves_the_image_back(client: TestClient, data: bytes, kind: str) -> None:
    song = _blank(client)
    posted = client.post(f"/api/songs/{song['id']}/cover", files={"file": ("whatever.bin", data, "text/html")})
    assert posted.status_code == 200, posted.text
    url = posted.json()["cover_url"]
    assert url.startswith(f"api/songs/{song['id']}/cover?v=")
    served = client.get(f"/api/songs/{song['id']}/cover")
    assert served.content == data and served.headers["content-type"] == kind
    assert served.headers["x-content-type-options"] == "nosniff"
    assert client.get("/api/songs").json()["items"][0]["cover_url"] == url


def test_replacing_and_deleting_the_cover(client: TestClient) -> None:
    song = _blank(client)
    first = client.post(f"/api/songs/{song['id']}/cover", files={"file": ("a.png", PNG)}).json()["cover_url"]
    second = client.post(f"/api/songs/{song['id']}/cover", files={"file": ("b.jpg", JPEG)}).json()["cover_url"]
    assert first != second
    assert len(list((client.app.state.ctx.settings.media_dir / "local" / song["id"]).iterdir())) == 1
    assert client.delete(f"/api/songs/{song['id']}/cover").json()["cover_url"] is None
    assert client.get(f"/api/songs/{song['id']}/cover").status_code == 404


@pytest.mark.parametrize(
    "data",
    [b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', b"not an image", b"GIF89a....", b""],
)
def test_cover_upload_refuses_svg_and_fakes(client: TestClient, data: bytes) -> None:
    song = _blank(client)
    response = client.post(f"/api/songs/{song['id']}/cover", files={"file": ("cover.png", data, "image/png")})
    assert response.status_code == 400 and response.json()["detail"]["key"] == "cover.notImage"
    assert client.get(f"/api/songs/{song['id']}").json()["cover_url"] is None


def test_cover_upload_has_a_size_cap(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(song_metadata, "MAX_COVER_BYTES", 100)
    song = _blank(client)
    response = client.post(f"/api/songs/{song['id']}/cover", files={"file": ("c.png", PNG + b"\x00" * 100)})
    assert response.status_code == 413 and response.json()["detail"]["key"] == "upload.tooLarge"
    assert client.post(f"/api/songs/{song['id']}/cover", files={"file": ("c.png", PNG)}).status_code == 200


def test_deleting_a_song_removes_its_cover(client: TestClient) -> None:
    song = _blank(client)
    client.post(f"/api/songs/{song['id']}/cover", files={"file": ("c.png", PNG)})
    client.delete(f"/api/songs/{song['id']}")
    assert not (client.app.state.ctx.settings.media_dir / "local" / song["id"]).exists()


# --- online lookup ---------------------------------------------------------------------------------------------


def _fetcher(handler) -> SafeFetcher:
    return SafeFetcher(transport=httpx.MockTransport(handler), resolver=lambda host, port: ["93.184.216.34"])


def _recordings() -> dict:
    return {
        "recordings": [
            {"title": "Other", "releases": []},
            {
                "title": "Song",
                "first-release-date": "1971-11-08",
                "releases": [
                    {"id": "r-single", "title": "Song (single)", "status": "Promotion", "release-group": {"id": "g0"}},
                    {
                        "id": "r1",
                        "title": "The Album",
                        "status": "Official",
                        "release-group": {"id": "g1", "primary-type": "Album"},
                    },
                ],
            },
        ]
    }


@pytest.fixture
def lookup_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(song_metadata, "_throttle", lambda: None)
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.headers["host"] == "musicbrainz.org":
            return httpx.Response(200, json=_recordings())
        if request.url.path.startswith("/release-group/g1/"):
            return httpx.Response(200, content=JPEG)
        return httpx.Response(404)

    settings = replace(Settings.for_tests(tmp_path), metadata_lookup=True)
    with TestClient(create_app(settings, fetcher=_fetcher(handler))) as test_client:
        test_client.requests = requests  # type: ignore[attr-defined]
        yield test_client


def test_lookup_is_off_by_default(client: TestClient) -> None:
    assert client.get("/api/meta").json()["metadata_lookup"] is False
    song = _blank(client)
    response = client.post(f"/api/songs/{song['id']}/metadata/lookup")
    assert response.status_code == 404 and response.json()["detail"]["key"] == "metadata.lookupDisabled"


def test_lookup_fills_album_year_and_cover(lookup_client: TestClient) -> None:
    assert lookup_client.get("/api/meta").json()["metadata_lookup"] is True
    song = lookup_client.post("/api/songs", json={"title": 'The "Song"', "preset": "bass-4"}).json()
    found = lookup_client.post(f"/api/songs/{song['id']}/metadata/lookup")
    assert found.status_code == 200, found.text
    body = found.json()
    assert (body["album"], body["year"]) == ("The Album", 1971)
    assert body["cover_url"] and lookup_client.get(f"/api/songs/{song['id']}/cover").content == JPEG
    query = lookup_client.requests[0].url.params["query"]  # type: ignore[attr-defined]
    assert 'recording:"The \\"Song\\""' in query
    assert lookup_client.requests[0].headers["user-agent"].startswith("Fretbook/")  # type: ignore[attr-defined]


def test_lookup_keeps_what_the_person_set(lookup_client: TestClient) -> None:
    song = _blank(lookup_client, "Song")
    lookup_client.patch(f"/api/songs/{song['id']}/metadata", json={"album": "Mine", "year": 2001})
    lookup_client.post(f"/api/songs/{song['id']}/cover", files={"file": ("c.png", PNG)})
    body = lookup_client.post(f"/api/songs/{song['id']}/metadata/lookup").json()
    assert (body["album"], body["year"]) == ("Mine", 2001)
    assert lookup_client.get(f"/api/songs/{song['id']}/cover").content == PNG


def test_lookup_without_a_match_or_service(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(song_metadata, "_throttle", lambda: None)
    mode = {"status": 200}

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(mode["status"], json={"recordings": []})

    settings = replace(Settings.for_tests(tmp_path), metadata_lookup=True)
    with TestClient(create_app(settings, fetcher=_fetcher(handler))) as client:
        song = _blank(client)
        missing = client.post(f"/api/songs/{song['id']}/metadata/lookup")
        assert missing.status_code == 404 and missing.json()["detail"]["key"] == "metadata.notFound"
        mode["status"] = 503
        down = client.post(f"/api/songs/{song['id']}/metadata/lookup")
        assert down.status_code == 502 and down.json()["detail"]["key"] == "metadata.lookupFailed"


def test_a_cover_that_is_not_an_image_is_dropped(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(song_metadata, "_throttle", lambda: None)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.headers["host"] == "musicbrainz.org":
            return httpx.Response(200, json=_recordings())
        return httpx.Response(200, content=b"<svg onload=alert(1)>")

    found = song_metadata.lookup(_fetcher(handler), "Song", "Artist")
    assert found is not None and found.album == "The Album" and found.cover is None


# --- backup ----------------------------------------------------------------------------------------------------


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


def test_metadata_and_cover_survive_a_backup_round_trip(tmp_path: Path) -> None:
    with TestClient(create_app(Settings.for_tests(tmp_path / "src"))) as source:
        song = _song_with(source, _score(C_MAJOR))
        source.patch(
            f"/api/songs/{song['id']}/metadata", json={"genre": "Pop", "album": "A", "year": 1980, "notes": "n"}
        )
        source.post(f"/api/songs/{song['id']}/cover", files={"file": ("c.png", PNG)})
        archive = source.get("/api/library/export").content
    with zipfile.ZipFile(io.BytesIO(archive)) as opened:
        entry = json.loads(opened.read("manifest.json"))["songs"][0]
    # A detected key is not exported as if it were chosen.
    assert entry["metadata"] == {"key": "", "genre": "Pop", "album": "A", "year": 1980, "notes": "n"}

    with TestClient(create_app(Settings.for_tests(tmp_path / "dst"))) as target:
        assert _restore(target, archive)["status"] == "done"
        restored = target.get("/api/songs").json()["items"][0]
        detail = target.get(f"/api/songs/{restored['id']}").json()
        assert (detail["genre"], detail["album"], detail["year"], detail["notes"]) == ("Pop", "A", 1980, "n")
        assert detail["key"] == "C" and detail["key_detected"] is True
        assert target.get(f"/api/songs/{restored['id']}/cover").content == PNG


def test_restore_checks_metadata_from_an_archive(tmp_path: Path) -> None:
    def archive(metadata: object, cover: bytes | None = None, cover_name: str = "cover.png") -> bytes:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as out:
            out.writestr("songs/s1/song.cho", "[C]Hello\n")
            media = []
            if cover is not None:
                out.writestr(f"songs/s1/media/m1/{cover_name}", cover)
                media = [{"kind": "cover", "filename": cover_name, "path": f"songs/s1/media/m1/{cover_name}"}]
            entry = {
                "id": "s1",
                "title": "Hi",
                "content_kind": "chords",
                "file": "songs/s1/song.cho",
                "metadata": metadata,
                "media": media,
            }
            out.writestr(
                "manifest.json", json.dumps({"format": "fretbook-library", "format_version": 1, "songs": [entry]})
            )
        return buffer.getvalue()

    with TestClient(create_app(Settings.for_tests(tmp_path))) as client:
        job = _restore(client, archive({"year": "soon", "genre": "x"}))
        assert job["status"] == "done"
        song = client.get("/api/songs").json()["items"][0]
        assert song["year"] is None and song["genre"] == ""  # all or nothing
        assert any(item["key"] == "backup.metadataFailed" for item in job["result"]["warnings"])
        client.delete(f"/api/songs/{song['id']}")

        job = _restore(client, archive({}, cover=b"<svg onload=alert(1)>"))
        song = client.get("/api/songs").json()["items"][0]
        assert song["cover_url"] is None
        assert any(item["key"] == "backup.mediaFailed" for item in job["result"]["warnings"])
        client.delete(f"/api/songs/{song['id']}")

        _restore(client, archive({}, cover=JPEG, cover_name="weird.html"))
        song = client.get("/api/songs").json()["items"][0]
        assert client.get(f"/api/songs/{song['id']}/cover").headers["content-type"] == "image/jpeg"


@pytest.mark.parametrize(
    ("chords", "expected"),
    [
        (["G", "C", "D", "G"], "G"),
        (["Am", "F", "C", "G", "Am"], "Am"),
        (["C", "Am", "F", "G", "C"], "C"),
        (["Em", "C", "G", "D", "Em"], "Em"),
        (["Dm7", "G7", "Cmaj7"], "C"),
        (["A", "D/F#", "E", "A"], "A"),
    ],
)
def test_chords_key(chords: list[str], expected: str) -> None:
    assert key_detect.chords_key(chords) == expected


def test_chords_key_needs_enough_chords() -> None:
    assert key_detect.chords_key(["C", "G"]) is None
    assert key_detect.chords_key(["C", "C", "C", "C"]) is None
    assert key_detect.chords_key([]) is None


def test_chordpro_key_prefers_directive_then_chords_then_capo() -> None:
    body = "[Verse]\n[G]Hello [C]there [D]my [G]friend\n{comment: [Am] ignored}\n"
    assert key_detect.chordpro_key(body) == "G"
    assert key_detect.chordpro_key("{key: Em}\n" + body) == "Em"
    assert key_detect.chordpro_key("{capo: 2}\n" + body) == "A"
    assert key_detect.chordpro_key("{title: x}\nno chords here\n") is None
