import json
import re
import time
from dataclasses import replace
from pathlib import Path

from fastapi.testclient import TestClient

from fretbook.app import create_app
from fretbook.config import Settings

XML = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Bass</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <staff-details>
          <staff-tuning line="1"><tuning-step>E</tuning-step><tuning-octave>1</tuning-octave></staff-tuning>
          <staff-tuning line="2"><tuning-step>A</tuning-step><tuning-octave>1</tuning-octave></staff-tuning>
          <staff-tuning line="3"><tuning-step>D</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
          <staff-tuning line="4"><tuning-step>G</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
        </staff-details>
      </attributes>
      <note>
        <duration>4</duration>
        <notations><technical><string>1</string><fret>2</fret></technical></notations>
      </note>
    </measure>
  </part>
</score-partwise>
"""

WAV = (
    b"RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00"
    b"\x44\xac\x00\x00\x88X\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00"
)

SHEET = """[Verse]
G        C
Hello my friend
"""


def _client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(Settings.for_tests(tmp_path)))


def _wait(client: TestClient, job_id: str) -> dict:
    client.app.state.ctx.jobs.run_once()
    job = {"status": "queued"}
    for _ in range(30):
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in {"done", "error"}:
            break
        time.sleep(0.1)
    return job


def test_tab_lifecycle(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        assert client.get("/api/health").json()["name"] == "Fretbook"
        meta = client.get("/api/meta").json()
        assert "musicxml" in meta["exporters"]
        assert meta["auth_mode"] == "single"
        assert any(item["id"] == "guitar-6" and item["family"] == "guitar" for item in meta["instruments"])

        created = client.post(
            "/api/songs",
            json={"title": "New", "artist": "Me", "preset": "bass-4", "bpm": 90, "measures": 2},
        )
        assert created.status_code == 201
        song = created.json()
        song_id = song["id"]
        assert song["content_kind"] == "tab"
        assert song["revision"] == 1
        document = song["document"]
        assert document["tracks"][0]["tuning_midi"] == [43, 38, 33, 28]
        assert len(document["bars"]) == 2

        beat = document["tracks"][0]["bars"][0]["voices"][0]["beats"][0]
        beat["notes"] = [{"string": 0, "fret": 3}]
        updated = client.put(
            f"/api/songs/{song_id}", json={"title": "New", "artist": "Me", "revision": 1, "document": document}
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["revision"] == 2
        assert updated.json()["document"]["tracks"][0]["bars"][0]["voices"][0]["beats"][0]["notes"][0]["fret"] == 3

        synced = client.patch(f"/api/songs/{song_id}/sync", json={"bpm": 90, "anchors": {"0": 1.25}})
        assert synced.status_code == 200
        assert synced.json()["document"]["sync"]["anchors"]["0"] == 1.25
        assert synced.json()["revision"] == 3

        # The editor still holds revision 2: its save would drop the tap, so it is refused.
        stale = client.put(
            f"/api/songs/{song_id}", json={"title": "New", "artist": "Me", "revision": 2, "document": document}
        )
        assert stale.status_code == 409
        assert stale.json()["detail"]["key"] == "song.conflict"
        assert stale.json()["detail"]["params"]["current"] == 3

        bad_anchor = client.patch(f"/api/songs/{song_id}/sync", json={"bpm": 90, "anchors": {"99": 1.0}})
        assert bad_anchor.status_code == 400

        listed = client.get("/api/songs").json()
        assert listed[0]["id"] == song_id
        assert "document" not in listed[0]

        exported = client.get(f"/api/songs/{song_id}/export.json").json()
        assert exported["format"] == "fretbook-song" and exported["content_kind"] == "tab"
        xml = client.get(f"/api/songs/{song_id}/export.musicxml")
        assert xml.status_code == 200
        assert b"<score-partwise" in xml.content and b"<fret>3</fret>" in xml.content

        missing = client.get("/api/songs/missing")
        assert missing.status_code == 404
        assert missing.json()["detail"]["key"] == "song.notFound"

        assert client.delete(f"/api/songs/{song_id}").status_code == 204
        assert client.get(f"/api/songs/{song_id}").status_code == 404


def test_nan_is_refused_and_the_song_stays_readable(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        song = client.post("/api/songs", json={"title": "x"}).json()
        for body in ('{"bpm": 120, "anchors": {"0": NaN}}', '{"bpm": Infinity, "anchors": {}}'):
            response = client.patch(
                f"/api/songs/{song['id']}/sync", content=body, headers={"content-type": "application/json"}
            )
            assert response.status_code == 422
        document = json.dumps(song["document"]).replace('"bpm": 120.0', '"bpm": NaN')
        response = client.put(
            f"/api/songs/{song['id']}",
            content=f'{{"title": "x", "revision": 1, "document": {document}}}',
            headers={"content-type": "application/json"},
        )
        assert response.status_code == 422
        assert client.get(f"/api/songs/{song['id']}").status_code == 200


def test_audio_upload_replaces_and_cache_busts(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        song_id = client.post("/api/songs", json={"title": "Audio"}).json()["id"]
        first = client.post(f"/api/songs/{song_id}/audio", files={"file": ("click.wav", WAV, "text/html")})
        assert first.status_code == 200
        assert first.json()["has_audio"] is True
        fetched = client.get(first.json()["audio_url"])
        assert fetched.status_code == 200
        assert fetched.content[:4] == b"RIFF"
        # The type comes from the extension, not from what the client claimed.
        assert fetched.headers["content-type"] == "audio/wav"
        second = client.post(f"/api/songs/{song_id}/audio", files={"file": ("click.wav", WAV, "audio/wav")})
        assert second.json()["audio_url"] != first.json()["audio_url"]
        media = tmp_path / "media" / "local" / song_id
        assert len(list(media.iterdir())) == 1

        assert (
            client.post(f"/api/songs/{song_id}/audio", files={"file": ("x.exe", b"MZ", "audio/wav")}).status_code == 400
        )
        too_big = client.post(f"/api/songs/{song_id}/audio", files={"file": ("big.wav", b"0" * 2_100_000, "audio/wav")})
        assert too_big.status_code == 413
        assert not [path for path in (tmp_path / "inbox").iterdir() if path.name.startswith("upload-")]


def test_request_body_limit(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        response = client.post(
            "/api/songs/import-document", content=b"x" * 3_200_000, headers={"content-type": "application/json"}
        )
        assert response.status_code == 413
        assert response.json()["detail"]["key"] == "request.tooLarge"


def test_cross_site_writes_are_refused(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        evil = client.post("/api/songs", json={"title": "x"}, headers={"Origin": "https://evil.example"})
        assert evil.status_code == 403
        assert evil.json()["detail"]["key"] == "request.crossOrigin"
        same = client.post("/api/songs", json={"title": "x"}, headers={"Origin": "http://testserver"})
        assert same.status_code == 201
        assert client.get("/api/songs", headers={"Origin": "https://evil.example"}).status_code == 200


def test_default_instrument_is_a_user_setting(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        me = client.get("/api/me").json()
        assert me["settings"]["default_instrument"] == "bass-4"
        assert client.put("/api/me/settings", json={"default_instrument": "nope"}).status_code == 400
        saved = client.put("/api/me/settings", json={"default_instrument": "guitar-7"})
        assert saved.status_code == 200
        assert saved.json() == {"default_instrument": "guitar-7"}
        assert client.get("/api/me").json()["settings"]["default_instrument"] == "guitar-7"
        song = client.post("/api/songs", json={"title": "Default"}).json()
        assert song["string_count"] == 7
        assert client.post("/api/songs", json={"title": "Explicit", "preset": "bass-5"}).json()["string_count"] == 5


def test_chord_sheets(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        created = client.post("/api/songs", json={"content_kind": "chords", "title": "Hello", "chordpro": SHEET})
        assert created.status_code == 201
        song = created.json()
        assert song["content_kind"] == "chords"
        assert song["document"] is None
        assert "[G]Hello my [C]friend" in song["chordpro"]
        assert "{title: Hello}" in song["chordpro"]

        edited = client.put(
            f"/api/songs/{song['id']}",
            json={"title": "Hello", "revision": song["revision"], "chordpro": "{title: Hello}\n[D]Bye\n"},
        )
        assert edited.status_code == 200
        assert edited.json()["chordpro"] == "{title: Hello}\n[D]Bye\n"
        assert (
            client.put(
                f"/api/songs/{song['id']}", json={"title": "Hello", "revision": edited.json()["revision"]}
            ).status_code
            == 400
        )
        assert client.patch(f"/api/songs/{song['id']}/sync", json={"bpm": 90, "anchors": {}}).status_code == 400
        cho = client.get(f"/api/songs/{song['id']}/export.cho")
        assert cho.status_code == 200 and cho.text.startswith("{title: Hello}")
        assert client.get(f"/api/songs/{song['id']}/export.musicxml").status_code == 400
        assert client.get("/api/songs").json()[0]["content_kind"] == "chords"


def test_songsterr_preview_and_selected_guitar(tmp_path: Path, monkeypatch) -> None:
    from tests.test_songsterr import URL, FakeFetcher

    from fretbook.importers.registry import SongsterrImporter as Real

    fetcher = FakeFetcher()
    monkeypatch.setattr("fretbook.importers.registry.SongsterrImporter", lambda: Real(fetcher))
    with _client(tmp_path) as client:
        refused = client.post("/api/imports/preview", json={"url": "https://example.com/nope"})
        assert refused.status_code == 400
        assert refused.json()["detail"]["key"] == "import.noUrlImporter"

        preview = client.post("/api/imports/preview", json={"url": URL})
        assert preview.status_code == 200, preview.text
        tracks = preview.json()["tracks"]
        assert [track["part_id"] for track in tracks] == [1, 2]
        assert tracks[0]["canonical_instrument"] == "guitar"
        assert tracks[1]["is_bass"] is True
        assert not any(url.endswith(".json") for url in fetcher.urls)

        # No part_ids: the default instrument is bass, and only that part is fetched.
        fetcher.urls.clear()
        bass = client.post("/api/imports", json={"url": URL})
        assert bass.status_code == 202
        bass_job = _wait(client, bass.json()["job_id"])
        assert bass_job["status"] == "done", bass_job
        bass_song = client.get(f"/api/songs/{bass_job['result']['song_id']}").json()
        assert bass_song["preferred_instrument"] == "bass-guitar"
        assert bass_song["document"]["tracks"][0]["tuning_midi"] == [43, 38, 33, 28]
        assert bass_song["string_count"] == 4
        assert not any(url.endswith("/1.json") for url in fetcher.urls)

        guitar = client.post("/api/imports", json={"url": URL, "part_ids": [1]})
        guitar_job = _wait(client, guitar.json()["job_id"])
        assert guitar_job["status"] == "done", guitar_job
        # The first import was not edited, so choosing the guitar part refreshes that song.
        guitar_song = client.get(f"/api/songs/{guitar_job['result']['song_id']}").json()
        assert guitar_song["id"] == bass_song["id"]
        assert guitar_song["preferred_instrument"] == "guitar"
        assert guitar_song["string_count"] == 6
        assert guitar_song["document"]["tracks"][0]["tuning_midi"] == [64, 59, 55, 50, 45, 40]


def test_file_imports(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        refused = client.post(
            "/api/imports/file", files={"file": ("song.gp5", b"not-a-real-gp", "application/octet-stream")}
        )
        assert refused.status_code == 400
        assert refused.json()["detail"]["key"] == "import.guitarProInBrowser"

        accepted = client.post("/api/imports/file", files={"file": ("song.musicxml", XML.encode(), "application/xml")})
        assert accepted.status_code == 202
        job = _wait(client, accepted.json()["job_id"])
        assert job["status"] == "done", job
        assert "payload" not in job
        song = client.get(f"/api/songs/{job['result']['song_id']}").json()
        assert song["document"]["tracks"][0]["tuning_midi"] == [43, 38, 33, 28]

        sheet = client.post("/api/imports/file", files={"file": ("hello.cho", SHEET.encode(), "text/plain")})
        job = _wait(client, sheet.json()["job_id"])
        assert job["status"] == "done", job
        assert job["result"]["content_kind"] == "chords"

        unknown = client.post("/api/imports/file", files={"file": ("song.pdf", b"%PDF", "application/pdf")})
        assert unknown.status_code == 400
        assert unknown.json()["detail"]["key"] == "import.noFileImporter"
        assert not list((tmp_path / "inbox").glob("*song.pdf"))

        bad = client.post("/api/imports", json={"url": "https://example.com/nope"})
        assert bad.status_code == 400
        assert bad.json()["detail"]["key"] == "import.noUrlImporter"


def test_browser_document_import(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        blank = client.post("/api/songs", json={"title": "Seed", "preset": "guitar-7"}).json()
        payload = {
            "title": "From Guitar Pro",
            "artist": "Browser",
            "source_kind": "guitarpro",
            "document": blank["document"],
        }
        saved = client.post("/api/songs/import-document", json=payload)
        assert saved.status_code == 201
        assert saved.json()["source_kind"] == "guitarpro"
        assert saved.json()["string_count"] == 7
        payload["source_kind"] = "anything"
        assert client.post("/api/songs/import-document", json=payload).status_code == 422


def test_root_path_rewrites_base_href(tmp_path: Path) -> None:
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text('<html><head><base href="/" /></head></html>\n', encoding="utf-8")
    settings = replace(Settings.for_tests(tmp_path), root_path="/fretbook", static_dir=static)
    with TestClient(create_app(settings)) as client:
        page = client.get("/songs/abc")
        assert page.status_code == 200
        assert '<base href="/fretbook/">' in page.text


def _catalog() -> dict:
    return json.loads(Path("web/src/locales/en.json").read_text(encoding="utf-8"))


def _lookup(catalog: dict, key: str) -> object:
    node: object = catalog
    for part in key.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node


_KEY = re.compile(r'"([a-z]+\.[a-zA-Z]+)"')
_ERROR_CALLS = ("api_error(", "ImportError(", "Notice(", "AudioDownloadError(", "_json_error(", "error_key=")


def _call_span(source: str, start: int) -> str:
    """The argument text of a call whose opening parenthesis ends at ``start``."""
    depth, index, quote = 1, start, ""
    while index < len(source) and depth:
        char = source[index]
        if quote:
            if char == "\\":
                index += 1
            elif char == quote:
                quote = ""
        elif char in "\"'":
            quote = char
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        index += 1
    return source[start:index]


def _keys_after(source: str, call: str) -> set[str]:
    keys = set()
    for match in re.finditer(re.escape(call), source):
        span = _call_span(source, match.end()) if call.endswith("(") else source[match.end() : match.end() + 40]
        found = _KEY.search(span)
        if found:
            keys.add(found.group(1))
    return keys


def test_english_catalog_covers_server_keys() -> None:
    catalog = _catalog()
    error_keys: set[str] = set()
    progress_keys: set[str] = set()
    for path in Path("fretbook").rglob("*.py"):
        source = path.read_text(encoding="utf-8")
        for call in _ERROR_CALLS:
            error_keys |= _keys_after(source, call)
        progress_keys |= _keys_after(source, "progress(")
    error_keys |= {"job.interrupted", "job.failed", "job.noHandler", "import.notImplemented"}
    assert len(error_keys) > 20
    missing = sorted(key for key in error_keys if not isinstance(_lookup(catalog["errors"], key), str))
    assert missing == []
    missing_progress = sorted(key for key in progress_keys if not isinstance(_lookup(catalog, key), str))
    assert missing_progress == []
    assert catalog["app"]["title"] == "Fretbook"
