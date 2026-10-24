"""Attaching a YouTube link's audio to an existing song (a fake downloader stands in for yt-dlp)."""

import time
from dataclasses import replace
from pathlib import Path

from fastapi.testclient import TestClient

from fretbook.app import create_app
from fretbook.audio.ytdlp import AudioDownloadError
from fretbook.config import Settings

LINK = "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5"


def _client(tmp_path: Path, **changes) -> TestClient:
    return TestClient(create_app(replace(Settings.for_tests(tmp_path), **changes)))


def _song(client: TestClient) -> str:
    return client.post("/api/songs", json={"title": "Own tune", "content_kind": "chords", "chordpro": "[G]Hi"}).json()[
        "id"
    ]


def _wait(client: TestClient, job_id: str) -> dict:
    for _ in range(200):
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in {"done", "error"}:
            return job
        time.sleep(0.05)
    raise AssertionError("job did not finish")


def test_the_download_replaces_the_songs_audio(tmp_path: Path, monkeypatch) -> None:
    calls: list[str] = []

    def fake_download(video_id, dest, progress, **_kwargs):
        calls.append(video_id)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"ID3new")

    monkeypatch.setattr("fretbook.jobs.youtube_audio.download_audio", fake_download)
    with _client(tmp_path, download_audio=True) as client:
        song_id = _song(client)
        client.post(f"/api/songs/{song_id}/audio", files={"file": ("old.mp3", b"ID3old", "audio/mpeg")})
        queued = client.post(f"/api/songs/{song_id}/audio/youtube", json={"url": LINK})
        assert queued.status_code == 202
        job = _wait(client, queued.json()["job_id"])
        assert job["status"] == "done", job
        assert job["result"]["video_id"] == "dQw4w9WgXcQ"
        assert calls == ["dQw4w9WgXcQ"]
        assert client.get(f"/api/songs/{song_id}").json()["has_audio"] is True
        assert client.get(f"/api/songs/{song_id}/audio").content == b"ID3new"


def test_a_failed_download_keeps_the_old_audio_and_reports_the_key(tmp_path: Path, monkeypatch) -> None:
    def failing(video_id, dest, progress, **_kwargs):
        raise AudioDownloadError("private", "audio.unavailable")

    monkeypatch.setattr("fretbook.jobs.youtube_audio.download_audio", failing)
    with _client(tmp_path, download_audio=True) as client:
        song_id = _song(client)
        client.post(f"/api/songs/{song_id}/audio", files={"file": ("old.mp3", b"ID3old", "audio/mpeg")})
        job = _wait(client, client.post(f"/api/songs/{song_id}/audio/youtube", json={"url": LINK}).json()["job_id"])
        assert job["status"] == "error"
        assert job["error_key"] == "audio.unavailable"
        assert client.get(f"/api/songs/{song_id}/audio").content == b"ID3old"


def test_bad_requests_are_refused_up_front(tmp_path: Path) -> None:
    with _client(tmp_path, download_audio=True) as client:
        song_id = _song(client)
        bad = client.post(f"/api/songs/{song_id}/audio/youtube", json={"url": "https://example.com/watch?v=x"})
        assert bad.status_code == 400
        assert bad.json()["detail"]["key"] == "audio.notYoutube"
        assert client.post("/api/songs/missing/audio/youtube", json={"url": LINK}).status_code == 404


def test_downloads_turned_off_is_a_translated_error(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        song_id = _song(client)
        refused = client.post(f"/api/songs/{song_id}/audio/youtube", json={"url": LINK})
        assert refused.status_code == 400
        assert refused.json()["detail"]["key"] == "import.audioDisabled"
