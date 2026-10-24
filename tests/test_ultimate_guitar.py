import html
import json
import re
import time
from dataclasses import replace
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from fretbook.app import create_app
from fretbook.config import Settings
from fretbook.importers import remote, ultimate_guitar
from fretbook.importers.base import ImportError
from fretbook.importers.safe_fetch import SafeFetcher

FIXTURES = Path(__file__).parent / "fixtures" / "ultimate_guitar"
HOST = "tabs.ultimate-guitar.com"
CHORDS_URL = f"https://{HOST}/tab/fixture-band/lantern-road-chords-9000001"
TAB_URL = f"https://{HOST}/tab/fixture-band/synthetic-riff-tabs-9000002"
OFFICIAL_URL = f"https://{HOST}/tab/fixture-band/pro-only-official-9000003"
BLOCKED_URL = f"https://{HOST}/tab/fixture-band/blocked-chords-1"


def _page(name: str) -> str:
    return (FIXTURES / name).read_text()


def _edited(name: str, change) -> str:
    """The fixture page with its JSON store changed by ``change(data)``."""
    page = _page(name)
    found = re.search(r'data-content="([^"]*)"', page)
    assert found
    data = json.loads(html.unescape(found.group(1)))
    change(data["store"]["page"]["data"])
    return page.replace(found.group(1), html.escape(json.dumps(data), quote=True))


def _client(tmp_path: Path, pages: dict[str, str]) -> TestClient:
    def handler(request: httpx.Request) -> httpx.Response:
        body = pages.get(request.url.path)
        if body is None:
            return httpx.Response(404)
        return httpx.Response(200, content=body.encode(), headers={"content-type": "text/html; charset=utf-8"})

    fetcher = SafeFetcher(transport=httpx.MockTransport(handler), resolver=lambda _host, _port: ["93.184.216.34"])
    return TestClient(create_app(replace(Settings.for_tests(tmp_path)), fetcher=fetcher))


def _import(client: TestClient, url: str, **form: str) -> dict:
    response = client.post("/api/imports/auto", data={"url": url, **form})
    assert response.status_code == 202, response.text
    assert response.json()["detected"] == "ultimate-guitar"
    job_id = response.json()["job_id"]
    client.app.state.ctx.jobs.run_once()
    job = {"status": "queued"}
    for _ in range(30):
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in {"done", "error"}:
            break
        time.sleep(0.1)
    return job


def _pages() -> dict[str, str]:
    return {
        "/tab/fixture-band/lantern-road-chords-9000001": _page("chords.html"),
        "/tab/fixture-band/synthetic-riff-tabs-9000002": _page("tab.html"),
        "/tab/fixture-band/pro-only-official-9000003": _page("official.html"),
        "/tab/fixture-band/blocked-chords-1": _page("no_store.html"),
    }


def test_url_matching() -> None:
    for url in (
        CHORDS_URL,
        "https://www.ultimate-guitar.com/tab/artist/song-chords-1",
        "http://ultimate-guitar.com/tab/1234",
    ):
        assert remote.provider_for(url) == "ultimate-guitar", url
    for url in (
        "https://www.ultimate-guitar.com/artist/fixture-band-1",
        "https://notultimate-guitar.com/tab/x",
        "https://example.com/?u=https://tabs.ultimate-guitar.com/tab/x",
    ):
        assert remote.provider_for(url) == "web", url


def test_chords_page_becomes_chordpro_with_capo_and_key() -> None:
    result = ultimate_guitar.parse_page(_page("chords.html"), CHORDS_URL)
    assert (result.title, result.artist, result.source_kind) == ("Lantern Road", "Fixture Band", "ultimate-guitar")
    text = result.chordpro or ""
    assert "{title: Lantern Road}" in text and "{artist: Fixture Band}" in text
    assert "{key: G}" in text and "{capo: 2}" in text
    assert "Tuning" not in text  # standard tuning is not worth a comment
    assert "[ch]" not in text and "[/ch]" not in text
    assert "{comment: Verse 1}" in text and "{comment: Chorus}" in text
    assert "[G]Walk along the river [D]bend" in text or "[G]Walk" in text
    assert result.source_ref == {
        "url": CHORDS_URL,
        "tab_id": "9000001",
        "type": "chords",
        "capo": 2,
        "key": "G",
        "tuning": "E A D G B E",
    }


def test_tab_page_becomes_a_score_in_the_pages_tuning() -> None:
    result = ultimate_guitar.parse_page(_page("tab.html"), TAB_URL)
    assert result.document is not None and result.chordpro is None
    assert (result.title, result.artist) == ("Synthetic Riff", "Fixture Band")
    track = result.document.tracks[0]
    assert track.tuning_midi == [64, 59, 55, 50, 45, 38]  # drop D, highest string first
    assert result.source_ref["rhythm_estimated"] is True
    assert result.source_ref["tuning"] == "D A D G B E"
    assert [warning.key for warning in result.warnings][0] == "import.rhythmEstimated"
    assert result.document.bars[0].section == "Intro"


def test_tab_page_without_tab_rows_falls_back_to_a_chord_sheet() -> None:
    def change(data: dict) -> None:
        data["tab"]["type"] = "Tabs"

    result = ultimate_guitar.parse_page(_edited("chords.html", change), CHORDS_URL)
    assert result.document is None and "[G]Walk" in (result.chordpro or "")


def test_non_standard_tuning_is_kept_as_a_comment_and_no_capo_means_no_directive() -> None:
    def change(data: dict) -> None:
        data["tab_view"]["meta"].update({"capo": 0, "tuning": {"value": "D A D G B E"}})

    text = ultimate_guitar.parse_page(_edited("chords.html", change), CHORDS_URL).chordpro or ""
    assert "{comment: Tuning: D A D G B E}" in text
    assert "{capo" not in text


def _emptied(data: dict) -> None:
    data["tab_view"]["wiki_tab"]["content"] = ""


def test_pages_with_nothing_to_import() -> None:
    cases = [
        (_edited("chords.html", _emptied), "ultimateGuitar.noTab"),
        (_page("no_store.html"), "ultimateGuitar.noStore"),
        (_page("official.html"), "ultimateGuitar.notText"),
    ]
    for page, key in cases:
        with pytest.raises(ImportError) as raised:
            ultimate_guitar.parse_page(page, OFFICIAL_URL)
        assert raised.value.key == key


def test_guitar_pro_based_pages_are_refused_with_a_reason() -> None:
    def change(data: dict) -> None:
        data["tab"]["type"] = "Pro"

    with pytest.raises(ImportError) as raised:
        ultimate_guitar.parse_page(_edited("chords.html", change), OFFICIAL_URL)
    assert raised.value.key == "ultimateGuitar.notText"
    assert "Guitar Pro" in str(raised.value)


def test_malformed_store_is_reported_as_unreadable() -> None:
    page = '<div class="js-store" data-content="{not json"></div>'
    with pytest.raises(ImportError) as raised:
        ultimate_guitar.parse_page(page, CHORDS_URL)
    assert raised.value.key == "ultimateGuitar.noStore"


def test_oversized_chord_sheet_is_refused() -> None:
    def change(data: dict) -> None:
        data["tab_view"]["wiki_tab"]["content"] += "la " * 70_000

    with pytest.raises(ImportError) as raised:
        ultimate_guitar.parse_page(_edited("chords.html", change), CHORDS_URL)
    assert raised.value.key == "chords.tooLong"


def test_chords_import_through_the_api_and_refresh_on_reimport(tmp_path: Path) -> None:
    pages = _pages()
    with _client(tmp_path, pages) as client:
        job = _import(client, CHORDS_URL)
        assert job["status"] == "done", job
        song = client.get(f"/api/songs/{job['result']['song_id']}").json()
        assert song["content_kind"] == "chords" and song["source_kind"] == "ultimate-guitar"
        assert song["source_ref"]["url"] == CHORDS_URL and song["source_ref"]["tab_id"] == "9000001"

        # The site fixes a chord: an untouched import is refreshed in place.
        path = "/tab/fixture-band/lantern-road-chords-9000001"
        pages[path] = pages[path].replace("then count again", "then count once more")
        again = _import(client, CHORDS_URL)
        assert again["status"] == "done", again
        assert again["result"]["song_id"] == song["id"]
        refreshed = client.get(f"/api/songs/{song['id']}").json()
        assert "once more" in refreshed["chordpro"], refreshed["chordpro"]
        assert refreshed["revision"] == song["revision"] + 1, (refreshed["revision"], song["revision"])
        assert len(client.get("/api/songs").json()["items"]) == 1

        # Once the user edits it, a re-import keeps their copy and saves the new one next to it.
        edited = client.put(
            f"/api/songs/{song['id']}",
            json={
                "title": refreshed["title"],
                "artist": refreshed["artist"],
                "chordpro": refreshed["chordpro"] + "{comment: mine}\n",
                "revision": refreshed["revision"],
            },
        )
        assert edited.status_code == 200, edited.text
        third = _import(client, CHORDS_URL)
        assert third["status"] == "done", third
        assert third["result"]["song_id"] != song["id"]
        assert any(w["key"] == "import.keptEditedCopy" for w in third["result"]["warnings"])
        assert len(client.get("/api/songs").json()["items"]) == 2


def test_tab_import_through_the_api_and_reimport(tmp_path: Path) -> None:
    with _client(tmp_path, _pages()) as client:
        job = _import(client, TAB_URL)
        assert job["status"] == "done", job
        song = client.get(f"/api/songs/{job['result']['song_id']}").json()
        assert song["content_kind"] == "tab"
        assert song["source_ref"]["rhythm_estimated"] is True
        again = _import(client, TAB_URL)
        assert again["result"]["song_id"] == song["id"]
        assert len(client.get("/api/songs").json()["items"]) == 1


def test_unusable_pages_fail_the_job_with_a_translatable_key(tmp_path: Path) -> None:
    with _client(tmp_path, _pages()) as client:
        for url, key in ((OFFICIAL_URL, "ultimateGuitar.notText"), (BLOCKED_URL, "ultimateGuitar.noStore")):
            job = _import(client, url)
            assert job["status"] == "error", job
            assert job["error_key"] == key, job
