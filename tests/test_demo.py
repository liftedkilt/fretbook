"""The bundled demo library and FRETBOOK_DEMO_MODE."""

import wave
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fretbook import demo
from fretbook.app import create_app
from fretbook.config import Settings


def make_client(tmp_path: Path, *, demo_mode: bool = False) -> TestClient:
    settings = replace(Settings.for_tests(tmp_path / "data"), demo_mode=demo_mode)
    return TestClient(create_app(settings))


@pytest.fixture
def client(tmp_path: Path):
    with make_client(tmp_path) as test_client:
        yield test_client


def titles(client: TestClient) -> list[str]:
    return sorted(song["title"] for song in client.get("/api/songs").json()["items"])


def test_bundled_songs_build() -> None:
    kinds = {song.id: song.kind for song in demo.SONGS}
    assert kinds == {"walking-home": "bass", "open-string-riff": "guitar", "porch-light": "chords"}
    for song in demo.SONGS:
        document, chordpro = demo.build_document(song), demo.build_chordpro(song)
        assert (document is None) == (chordpro is not None)
    walking = demo.build_document(demo.SONGS[0])
    assert walking is not None and walking.sync.points == [0.0, 2.0, 4.0, 6.0]


def test_add_is_idempotent_and_listed(client: TestClient) -> None:
    before = client.get("/api/demo").json()
    assert before["installed"] == 0 and [s["song_id"] for s in before["songs"]] == [None] * 3
    first = client.post("/api/demo")
    assert first.status_code == 200 and first.json()["changed"] == 3 and first.json()["installed"] == 3
    assert client.post("/api/demo").json()["changed"] == 0
    assert titles(client) == ["Open String Riff", "Porch Light", "Walking Home"]


def test_demo_songs_have_the_promised_content(client: TestClient) -> None:
    client.post("/api/demo")
    by_title = {song["title"]: song for song in client.get("/api/songs").json()["items"]}
    walking = client.get(f"/api/songs/{by_title['Walking Home']['id']}").json()
    assert walking["content_kind"] == "tab" and walking["has_sync"] and walking["audio_url"]
    audio = client.get(walking["audio_url"])
    assert audio.status_code == 200 and audio.headers["content-type"].startswith("audio/")
    riff = client.get(f"/api/songs/{by_title['Open String Riff']['id']}").json()
    assert riff["content_kind"] == "tab" and not riff["audio_url"]
    chords = client.get(f"/api/songs/{by_title['Porch Light']['id']}").json()
    assert chords["content_kind"] == "chords" and "[Am]" in chords["chordpro"]


def test_remove_keeps_other_songs_and_deletes_audio(client: TestClient, tmp_path: Path) -> None:
    client.post("/api/songs", json={"title": "Mine", "artist": "Me", "preset": "bass-4"})
    client.post("/api/demo")
    media = tmp_path / "data" / "media"
    assert any(media.rglob("*.wav"))
    removed = client.delete("/api/demo")
    assert removed.status_code == 200 and removed.json()["changed"] == 3 and removed.json()["installed"] == 0
    assert titles(client) == ["Mine"]
    assert not any(media.rglob("*.wav"))
    assert client.delete("/api/demo").json()["changed"] == 0


def test_audio_is_a_valid_wav(tmp_path: Path) -> None:
    document = demo.build_document(demo.SONGS[0])
    assert document is not None
    dest = tmp_path / "tone.wav"
    demo.render_audio(document, dest)
    with wave.open(str(dest)) as handle:
        assert handle.getnchannels() == 1
        assert handle.getnframes() / handle.getframerate() == pytest.approx(8.0, abs=0.01)


def test_meta_reports_demo_mode(tmp_path: Path) -> None:
    with make_client(tmp_path / "off") as off, make_client(tmp_path / "on", demo_mode=True) as on:
        assert off.get("/api/meta").json()["demo_mode"] is False
        assert on.get("/api/meta").json()["demo_mode"] is True


def test_demo_mode_refuses_writes_but_not_reads(tmp_path: Path) -> None:
    with make_client(tmp_path, demo_mode=True) as client:
        # The server reset the library to the demo songs when it started.
        assert titles(client) == ["Open String Riff", "Porch Light", "Walking Home"]
        song_id = client.get("/api/songs").json()["items"][0]["id"]
        for method, path in [
            ("post", "/api/songs"),
            ("delete", f"/api/songs/{song_id}"),
            ("put", f"/api/songs/{song_id}"),
            ("post", "/api/demo"),
            ("delete", "/api/demo"),
            ("post", "/api/imports/preview"),
            ("post", "/api/setlists"),
        ]:
            response = client.request(method.upper(), path, json={})
            assert response.status_code == 403, path
            assert response.json()["detail"]["key"] == "demo.readOnly"
        assert titles(client) == ["Open String Riff", "Porch Light", "Walking Home"]
        assert client.get(f"/api/songs/{song_id}").status_code == 200
        assert client.post(f"/api/songs/{song_id}/opened").status_code == 204
        assert client.put("/api/me/settings", json={"default_instrument": "guitar-6"}).status_code == 200


def test_reset_restores_the_demo_library(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        client.post("/api/songs", json={"title": "Mine", "artist": "Me", "preset": "bass-4"})
        client.post("/api/demo")
        demo.reset(client.app.state.ctx)  # type: ignore[attr-defined]
        assert titles(client) == ["Open String Riff", "Porch Light", "Walking Home"]


def test_reset_hour_is_03_utc() -> None:
    before = datetime(2026, 1, 1, 2, 0, tzinfo=UTC)
    after = datetime(2026, 1, 1, 4, 0, tzinfo=UTC)
    assert demo.seconds_until_reset(before) == 3600
    assert demo.seconds_until_reset(after) == 23 * 3600
