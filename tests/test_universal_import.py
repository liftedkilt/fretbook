import io
import time
import zipfile
from dataclasses import replace
from pathlib import Path

import httpx
from fastapi.testclient import TestClient
from tests.test_api import SHEET, WAV, XML

from fretbook.app import create_app
from fretbook.config import Settings
from fretbook.importers.safe_fetch import SafeFetcher

CORPUS = Path(__file__).parent / "fixtures" / "corpus"
TAB = (CORPUS / "asciitab" / "standard-guitar.tab").read_text()
PUBLIC = "93.184.216.34"


def _fetcher(routes: dict[str, httpx.Response | tuple[str, bytes]]) -> SafeFetcher:
    def handler(request: httpx.Request) -> httpx.Response:
        key = f"{request.headers['host']}{request.url.path}"
        found = routes.get(key)
        if found is None:
            return httpx.Response(404)
        if isinstance(found, tuple):
            return httpx.Response(200, content=found[1], headers={"content-type": found[0]})
        return found

    def resolve(host: str, _port: int) -> list[str]:
        return ["10.0.0.5"] if host == "intranet.example" else [PUBLIC]

    return SafeFetcher(transport=httpx.MockTransport(handler), resolver=resolve)


def _client(tmp_path: Path, fetcher: SafeFetcher | None = None, **changes) -> TestClient:
    settings = replace(Settings.for_tests(tmp_path), **changes)
    return TestClient(create_app(settings, fetcher=fetcher))


def _wait(client: TestClient, job_id: str) -> dict:
    client.app.state.ctx.jobs.run_once()
    job = {"status": "queued"}
    for _ in range(30):
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in {"done", "error"}:
            break
        time.sleep(0.1)
    return job


def _auto(client: TestClient, **kwargs):
    return client.post("/api/imports/auto", **kwargs)


def _done(client: TestClient, response) -> dict:
    assert response.status_code == 202, response.text
    job = _wait(client, response.json()["job_id"])
    assert job["status"] == "done", job
    return client.get(f"/api/songs/{job['result']['song_id']}").json()


def _mxl() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(
            "META-INF/container.xml",
            '<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>',
        )
        archive.writestr("score.xml", XML)
    return buffer.getvalue()


def test_files_are_recognised_by_content_whatever_they_are_called(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        xml = _auto(client, files={"file": ("download", XML.encode(), "application/octet-stream")})
        assert xml.json()["detected"] == "musicxml"
        assert _done(client, xml)["document"]["tracks"][0]["tuning_midi"] == [43, 38, 33, 28]

        mxl = _auto(client, files={"file": ("score.zip", _mxl(), "application/zip")})
        assert mxl.json()["detected"] == "musicxml"
        assert _done(client, mxl)["content_kind"] == "tab"

        sheet = _auto(client, files={"file": ("notes.dat", SHEET.encode(), "text/plain")})
        assert sheet.json()["detected"] == "chordpro"
        assert _done(client, sheet)["content_kind"] == "chords"

        tab = _auto(client, files={"file": ("riff.txt", TAB.encode(), "text/plain")})
        assert tab.json()["detected"] == "ascii-tab"
        assert _done(client, tab)["source_kind"] == "ascii-tab"
        assert not list((tmp_path / "inbox").iterdir())


def test_audio_file_becomes_a_song_with_audio_and_a_blank_tab(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        # The name and the client's content type lie; the bytes say WAV.
        response = _auto(client, files={"file": ("My Jam.txt", WAV, "text/plain")})
        assert response.json()["detected"] == "audio"
        song = _done(client, response)
        assert song["title"] == "My Jam"
        assert song["content_kind"] == "tab"
        assert song["document"]["tracks"][0]["bars"]
        assert song["has_audio"] is True
        audio = client.get(f"/api/songs/{song['id']}/audio")
        assert audio.status_code == 200
        assert audio.headers["content-type"].startswith("audio/wav")
        assert audio.content == WAV


def test_unsupported_and_unknown_files_are_refused_and_cleaned_up(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        cases = {
            "scan.pdf": (b"%PDF-1.4 ...", "import.notYetSupported"),
            "photo.png": (b"\x89PNG\r\n\x1a\n" + b"\x00" * 16, "import.notYetSupported"),
            "backup.zip": (_zipped("manifest.json"), "import.isLibraryArchive"),
            "blob.bin": (b"\x00\x01\x02" * 100, "import.noFileImporter"),
            "essay.dat": (b"Dear diary, nothing musical happened today.", "import.noFileImporter"),
        }
        for name, (content, key) in cases.items():
            refused = _auto(client, files={"file": (name, content, "application/octet-stream")})
            assert refused.status_code == 400, name
            assert refused.json()["detail"]["key"] == key, name
        assert not list((tmp_path / "inbox").iterdir())


def _zipped(*names: str) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name in names:
            archive.writestr(name, "{}")
    return buffer.getvalue()


def test_pasted_text(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        tab = _auto(client, data={"text": TAB})
        assert tab.json()["detected"] == "ascii-tab"
        assert _done(client, tab)["source_kind"] == "ascii-tab"

        chords = _auto(client, data={"text": SHEET})
        assert chords.json()["detected"] == "chordpro"
        assert _done(client, chords)["content_kind"] == "chords"

        xml = _auto(client, data={"text": XML})
        assert xml.json()["detected"] == "musicxml"
        _done(client, xml)

        prose = _auto(client, data={"text": "Remember to buy milk and call mum."})
        assert prose.status_code == 400
        assert prose.json()["detail"]["key"] == "import.noFileImporter"


def test_exactly_one_input_is_required(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        for kwargs in (
            {},
            {"data": {"text": "  ", "url": ""}},
            {"data": {"text": SHEET, "url": "https://example.com/a"}},
        ):
            response = _auto(client, **kwargs)
            assert response.status_code == 400
            assert response.json()["detail"]["key"] == "import.chooseOne"
        mixed = _auto(client, data={"url": "https://example.com/a"}, files={"file": ("a.cho", SHEET.encode())})
        assert mixed.json()["detail"]["key"] == "import.chooseOne"


def test_bad_links(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        for url in ("ftp://example.com/a.gp5", "example.com/tab", "https://", "http:// spaced.example/a"):
            response = _auto(client, data={"url": url})
            assert response.status_code == 400, url
            assert response.json()["detail"]["key"] == "import.badUrl", url


def test_link_routing_is_reported(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        songsterr = _auto(client, data={"url": "https://www.songsterr.com/a/wsa/artist-song-tab-s123"})
        assert songsterr.status_code == 202
        assert songsterr.json()["detected"] == "songsterr"
        youtube = _auto(client, data={"url": "https://youtu.be/dQw4w9WgXcQ"})
        assert youtube.json()["detected"] == "youtube"
        web = _auto(client, data={"url": "https://example.com/some/page"})
        assert web.json()["detected"] == "web"
        # A pasted block that is just a link is a link.
        pasted = _auto(client, data={"text": "  https://example.com/page  \n"})
        assert pasted.json()["detected"] == "web"


def test_direct_file_link(tmp_path: Path) -> None:
    fetcher = _fetcher({"files.example/riff.musicxml": ("application/xml", XML.encode())})
    with _client(tmp_path, fetcher) as client:
        song = _done(client, _auto(client, data={"url": "https://files.example/riff.musicxml"}))
        assert song["source_ref"]["url"] == "https://files.example/riff.musicxml"
        assert song["document"]["tracks"][0]["tuning_midi"] == [43, 38, 33, 28]
        assert not list((tmp_path / "inbox").iterdir())


def test_direct_link_to_content_with_a_wrong_name_or_type(tmp_path: Path) -> None:
    fetcher = _fetcher({"files.example/download": ("application/octet-stream", SHEET.encode())})
    with _client(tmp_path, fetcher) as client:
        song = _done(client, _auto(client, data={"url": "https://files.example/download"}))
        assert song["content_kind"] == "chords"


def test_page_that_links_a_score_file(tmp_path: Path) -> None:
    page = (
        "<html><title>Forum</title><body>"
        '<a href="/old.cho">chords</a><a href="/files/riff.musicxml">xml</a>'
        "</body></html>"
    )
    fetcher = _fetcher(
        {
            "forum.example/thread": ("text/html", page.encode()),
            "forum.example/files/riff.musicxml": ("application/xml", XML.encode()),
            "forum.example/old.cho": ("text/plain", SHEET.encode()),
        }
    )
    with _client(tmp_path, fetcher) as client:
        song = _done(client, _auto(client, data={"url": "https://forum.example/thread"}))
        # The score file ranks above the chord file.
        assert song["content_kind"] == "tab"
        assert song["source_ref"]["url"] == "https://forum.example/files/riff.musicxml"


def test_page_with_a_pre_block_of_tab(tmp_path: Path) -> None:
    bare = "e|-0---3---|\nB|---------|\nG|---------|\nD|---------|\n"
    page = f"<html><head><title>Easy riff &amp; more</title></head><body><p>hi</p><pre>{bare}</pre></body></html>"
    fetcher = _fetcher({"blog.example/riff": ("text/html; charset=utf-8", page.encode())})
    with _client(tmp_path, fetcher) as client:
        song = _done(client, _auto(client, data={"url": "https://blog.example/riff"}))
        assert song["source_kind"] == "ascii-tab"
        assert song["title"].startswith("Easy riff")


def test_page_with_nothing_usable(tmp_path: Path) -> None:
    fetcher = _fetcher({"blog.example/empty": ("text/html", b"<html><body><pre>no tab here</pre></body></html>")})
    with _client(tmp_path, fetcher) as client:
        response = _auto(client, data={"url": "https://blog.example/empty"})
        job = _wait(client, response.json()["job_id"])
        assert job["status"] == "error"
        assert job["error_key"] == "import.noFileImporter"


def test_private_links_fail_the_job(tmp_path: Path) -> None:
    with _client(tmp_path, _fetcher({})) as client:
        job = _wait(client, _auto(client, data={"url": "http://intranet.example/tab.txt"}).json()["job_id"])
        assert job["status"] == "error"
        assert job["error_key"] == "import.urlBlocked"


def test_youtube_link_makes_a_blank_tab_with_audio(tmp_path: Path, monkeypatch) -> None:
    calls: list[str] = []

    def fake_download(video_id, dest, progress, **_kwargs):
        calls.append(video_id)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"ID3fake")

    monkeypatch.setattr("fretbook.jobs.handlers.download_audio", fake_download)
    with _client(tmp_path, download_audio=True) as client:
        song = _done(client, _auto(client, data={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5"}))
        assert calls == ["dQw4w9WgXcQ"]
        assert song["has_audio"] is True
        assert song["source_ref"]["video_id"] == "dQw4w9WgXcQ"


def test_youtube_link_without_audio_downloads_enabled(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        job = _wait(client, _auto(client, data={"url": "https://youtu.be/dQw4w9WgXcQ"}).json()["job_id"])
        assert job["status"] == "error"
        assert job["error_key"] == "import.audioDisabled"


def test_fretbook_json_exports_round_trip_through_every_import_path(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        made = client.post("/api/songs", json={"content_kind": "chords", "title": "Chords", "chordpro": SHEET})
        tab = _done(client, _auto(client, data={"text": TAB}))
        for song_id, content_kind in ((made.json()["id"], "chords"), (tab["id"], "tab")):
            exported = client.get(f"/api/songs/{song_id}/export.json").content
            for send in (
                lambda data: _auto(client, files={"file": ("download", data, "application/json")}),
                lambda data: _auto(client, data={"text": data.decode()}),
                lambda data: client.post("/api/imports/file", files={"file": ("song.json", data)}),
            ):
                response = send(exported)
                assert response.status_code == 202, response.text
                if "detected" in response.json():
                    assert response.json()["detected"] == "fretbook-json"
                copy = _done(client, response)
                assert copy["content_kind"] == content_kind
                assert copy["source_kind"] == "fretbook-json"
