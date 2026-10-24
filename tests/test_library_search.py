"""Server-side library search, sorting, filtering, paging and last-opened tracking."""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fretbook.app import create_app
from fretbook.config import Settings

SHEET = "[C]Hello"


@pytest.fixture
def client(tmp_path: Path):
    with TestClient(create_app(Settings.for_tests(tmp_path))) as test_client:
        yield test_client


def _tab(client: TestClient, title: str, artist: str = "", preset: str = "bass-4") -> str:
    return client.post("/api/songs", json={"title": title, "artist": artist, "preset": preset}).json()["id"]


def _chords(client: TestClient, title: str, artist: str = "") -> str:
    body = {"content_kind": "chords", "title": title, "artist": artist, "chordpro": SHEET}
    return client.post("/api/songs", json=body).json()["id"]


def _titles(client: TestClient, **params: object) -> list[str]:
    response = client.get("/api/songs", params=params)
    assert response.status_code == 200, response.text
    return [item["title"] for item in response.json()["items"]]


def test_search_matches_title_and_artist_prefixes(client: TestClient) -> None:
    _tab(client, "Synced Groove", "The Funk Brothers")
    _tab(client, "Blue Monday", "New Order")
    _chords(client, "Café Song", "Grooveline")

    assert _titles(client, q="groo", sort="title") == ["Café Song", "Synced Groove"]
    assert _titles(client, q="funk bro") == ["Synced Groove"]
    assert _titles(client, q="cafe") == ["Café Song"]
    assert _titles(client, q="nothing like it") == []
    page = client.get("/api/songs", params={"q": "blue"}).json()
    assert page["total"] == 1 and page["counts"]["all"] == 3


@pytest.mark.parametrize("text", ['"', "AND", "a-b", "*", "title:x", "(", "NEAR(", "OR OR", "'; DROP TABLE songs; --"])
def test_hostile_search_text_never_errors(client: TestClient, text: str) -> None:
    _tab(client, "Plain Song")
    assert client.get("/api/songs", params={"q": text}).status_code == 200


def test_search_follows_renames_and_deletes(client: TestClient) -> None:
    song_id = _tab(client, "Old Name")
    song = client.get(f"/api/songs/{song_id}").json()
    client.put(
        f"/api/songs/{song_id}",
        json={"title": "Fresh Name", "artist": "", "revision": song["revision"], "document": song["document"]},
    )
    assert _titles(client, q="old") == []
    assert _titles(client, q="fresh") == ["Fresh Name"]
    client.delete(f"/api/songs/{song_id}")
    assert _titles(client, q="fresh") == []


LYRICS_SHEET = "{title: Hidden}\n{start_of_chorus}\n[Am]Take me [F]down to the paradise [C]city\n{end_of_chorus}\n"


def test_search_finds_chord_sheet_lyrics_but_not_chords_or_directives(client: TestClient) -> None:
    body = {"content_kind": "chords", "title": "Sheet", "artist": "", "chordpro": LYRICS_SHEET}
    client.post("/api/songs", json=body)
    _tab(client, "Other")

    assert _titles(client, q="paradise city") == ["Sheet"]
    assert _titles(client, q="para") == ["Sheet"]
    assert _titles(client, q="take me down") == ["Sheet"]
    assert _titles(client, q="Am") == []
    assert _titles(client, q="chorus") == []
    assert _titles(client, q="hidden") == []


def test_lyrics_follow_edits_and_survive_renames(client: TestClient) -> None:
    song_id = client.post(
        "/api/songs", json={"content_kind": "chords", "title": "Sheet", "artist": "", "chordpro": "[C]first words"}
    ).json()["id"]
    song = client.get(f"/api/songs/{song_id}").json()
    edit = {"title": "Sheet", "artist": "", "revision": song["revision"], "chordpro": "[C]second words"}
    assert client.put(f"/api/songs/{song_id}", json=edit).status_code == 200
    assert _titles(client, q="first") == [] and _titles(client, q="second") == ["Sheet"]

    song = client.get(f"/api/songs/{song_id}").json()
    rename = {**edit, "title": "Renamed", "revision": song["revision"], "chordpro": song["chordpro"]}
    assert client.put(f"/api/songs/{song_id}", json=rename).status_code == 200
    assert _titles(client, q="second") == ["Renamed"]
    client.delete(f"/api/songs/{song_id}")
    assert _titles(client, q="second") == []


def test_search_finds_tags_and_follows_tag_changes(client: TestClient) -> None:
    a = _tab(client, "Alpha")
    b = _chords(client, "Beta")
    assert client.put(f"/api/songs/{a}/tags", json={"tags": ["Campfire", "slow jam"]}).status_code == 200
    client.put(f"/api/songs/{b}/tags", json={"tags": ["Campfire"]})

    assert _titles(client, q="campfire", sort="title") == ["Alpha", "Beta"]
    assert _titles(client, q="slow") == ["Alpha"]
    client.put(f"/api/songs/{a}/tags", json={"tags": ["other"]})
    assert _titles(client, q="campfire") == ["Beta"]
    assert _titles(client, q="slow") == []
    client.delete(f"/api/songs/{b}")
    assert _titles(client, q="campfire") == []


def test_startup_indexes_lyrics_of_existing_sheets(tmp_path: Path) -> None:
    settings = Settings.for_tests(tmp_path)
    with TestClient(create_app(settings)) as client:
        song_id = _chords(client, "Old Sheet")
        conn = sqlite3.connect(settings.database_path)
        conn.execute("UPDATE songs SET lyrics_indexed = 0 WHERE id = ?", (song_id,))
        conn.execute("UPDATE songs_fts SET lyrics = '' WHERE song_id = ?", (song_id,))
        conn.commit()
        conn.close()
        assert _titles(client, q="hello") == []
    with TestClient(create_app(settings)) as client:
        assert _titles(client, q="hello") == ["Old Sheet"]


def test_sort_keys_and_order(client: TestClient) -> None:
    a = _tab(client, "beta", "Zed")
    b = _tab(client, "Alpha", "")
    c = _tab(client, "gamma", "Amy")
    # Timestamps have one-second resolution, so pin the creation order.
    conn = sqlite3.connect(client.app.state.ctx.settings.database_path)
    for index, song_id in enumerate((a, b, c)):
        conn.execute("UPDATE songs SET created_at = ? WHERE id = ?", (f"2026-01-0{index + 1}T00:00:00+00:00", song_id))
    conn.commit()
    conn.close()

    assert _titles(client, sort="title") == ["Alpha", "beta", "gamma"]
    assert _titles(client, sort="title", order="desc") == ["gamma", "beta", "Alpha"]
    # A song with no artist sorts last in both directions.
    assert _titles(client, sort="artist") == ["gamma", "beta", "Alpha"]
    assert _titles(client, sort="artist", order="desc") == ["beta", "gamma", "Alpha"]
    assert _titles(client, sort="added", order="asc") == ["beta", "Alpha", "gamma"]

    # Never-opened songs sort last for both directions; opening bumps a song to the front.
    assert client.post(f"/api/songs/{a}/opened").status_code == 204
    assert _titles(client, sort="opened")[0] == "beta"
    assert _titles(client, sort="opened", order="asc")[0] == "beta"


def test_opening_does_not_touch_revision_or_updated_at(client: TestClient) -> None:
    song_id = _tab(client, "Quiet")
    before = client.get(f"/api/songs/{song_id}").json()
    assert client.post(f"/api/songs/{song_id}/opened").status_code == 204
    after = client.get(f"/api/songs/{song_id}").json()
    assert (after["revision"], after["updated_at"]) == (before["revision"], before["updated_at"])
    assert client.post("/api/songs/missing/opened").status_code == 404


def test_instrument_filters_and_counts(client: TestClient) -> None:
    _tab(client, "Bass One", preset="bass-4")
    _tab(client, "Guitar One", preset="guitar-6")
    _chords(client, "Chords One")
    page = client.get("/api/songs", params={"instrument": "bass"}).json()
    assert [item["title"] for item in page["items"]] == ["Bass One"]
    assert page["total"] == 1
    assert page["counts"] == {"all": 3, "bass": 1, "electric": 1, "acoustic": 0, "chords": 1, "favourites": 0}
    assert _titles(client, instrument="chords") == ["Chords One"]
    assert _titles(client, instrument="electric") == ["Guitar One"]


def test_paging_walks_every_song_once(client: TestClient) -> None:
    for index in range(7):
        _chords(client, f"Song {index}")
    seen: list[str] = []
    cursor = ""
    pages = 0
    while True:
        page = client.get("/api/songs", params={"limit": 3, "sort": "title", "cursor": cursor}).json()
        seen += [item["title"] for item in page["items"]]
        pages += 1
        assert page["total"] == 7
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert pages == 3
    assert seen == [f"Song {index}" for index in range(7)]


def test_bad_parameters_are_rejected(client: TestClient) -> None:
    assert client.get("/api/songs", params={"cursor": "garbage!"}).status_code == 400
    assert client.get("/api/songs", params={"sort": "nope"}).status_code == 422
    assert client.get("/api/songs", params={"limit": 0}).status_code == 422
    assert client.get("/api/songs", params={"limit": 1000}).status_code == 422
    assert client.get("/api/songs", params={"instrument": "kazoo"}).status_code == 422


def test_listing_2000_songs_stays_fast(tmp_path: Path) -> None:
    settings = Settings.for_tests(tmp_path)
    with TestClient(create_app(settings)) as client:
        client.post("/api/songs", json={"title": "Seed"})
        conn = sqlite3.connect(settings.database_path)
        owner = conn.execute("SELECT owner_id FROM songs").fetchone()[0]
        # A realistically large score document per row: the list must never read it.
        document = json.dumps({"bars": [{"id": index, "notes": "x" * 40} for index in range(400)]})
        rows = [
            (
                f"perf-{index}",
                owner,
                f"perf-{index}",
                f"Song number {index} {'blues' if index % 3 == 0 else 'rock'}",
                f"Artist {index % 97}",
                "tab",
                "manual",
                "bass-guitar" if index % 2 else "guitar",
                document,
                f"2026-01-01T00:{index // 60 % 60:02d}:{index % 60:02d}+00:00",
            )
            for index in range(2000)
        ]
        conn.executemany(
            """
            INSERT INTO songs (id, owner_id, slug, title, artist, content_kind, source_kind, source_ref,
                               preferred_instrument, document, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?)
            """,
            [(*row[:-1], row[-1], row[-1]) for row in rows],
        )
        conn.commit()
        conn.close()

        queries = [
            {},
            {"sort": "title", "limit": 50},
            {"q": "blues", "sort": "artist", "instrument": "bass"},
            {"sort": "opened", "limit": 200},
        ]
        for params in queries:
            best = float("inf")
            for _ in range(3):
                started = time.perf_counter()
                response = client.get("/api/songs", params=params)
                best = min(best, time.perf_counter() - started)
                assert response.status_code == 200
            # Typically a few milliseconds; the budget is generous so a slow CI runner does not flake.
            assert best < 1.0, f"{params} took {best:.3f}s"
        assert client.get("/api/songs", params={"limit": 1}).json()["total"] == 2001
