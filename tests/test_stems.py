"""Stem separation: the worker job, the stem endpoints and what happens to stems when the audio changes."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fretbook.app import create_app
from fretbook.audio import stems as engine
from fretbook.config import Settings
from fretbook.jobs.runner import JobRunner
from fretbook.jobs.stems import KIND, register_stems
from fretbook.storage.media import MediaStore
from fretbook.storage.repository import SongRepository


def _fake_separator(source: Path, model: str, out_dir: Path, progress) -> dict[str, Path]:
    progress("Separating", "stems.separating")
    names = engine.STEM_NAMES if model == "htdemucs_6s" else ("bass", "drums", "vocals", "other")
    out_dir.mkdir(parents=True, exist_ok=True)
    found = {}
    for name in names:
        path = out_dir / f"{name}.mp3"
        path.write_bytes(f"{model}:{name}".encode())
        found[name] = path
    return found


def _worker(client: TestClient, separator=_fake_separator) -> JobRunner:
    ctx = client.app.state.ctx
    runner = JobRunner(ctx.settings, worker_id="w1")
    register_stems(runner, SongRepository(ctx.settings), MediaStore(ctx.settings), separator)
    runner.heartbeat([KIND], host="test", pid=1)
    return runner


def _song_with_audio(client: TestClient) -> str:
    song_id = client.post(
        "/api/songs", json={"title": "Own tune", "content_kind": "chords", "chordpro": "[G]Hi"}
    ).json()["id"]
    upload = client.post(f"/api/songs/{song_id}/audio", files={"file": ("tune.mp3", b"ID3 not really", "audio/mpeg")})
    assert upload.status_code == 200
    return song_id


@pytest.fixture
def client(tmp_path: Path):
    with TestClient(create_app(Settings.for_tests(tmp_path))) as client:
        yield client


def test_stems_are_refused_without_audio_or_a_worker(client: TestClient) -> None:
    bare = client.post("/api/songs", json={"title": "Silent", "content_kind": "chords", "chordpro": "[C]x"}).json()[
        "id"
    ]
    assert client.post(f"/api/songs/{bare}/stems").json()["detail"]["key"] == "audio.none"
    song_id = _song_with_audio(client)
    refused = client.post(f"/api/songs/{song_id}/stems")
    assert refused.status_code == 409
    assert refused.json()["detail"]["key"] == "stems.noWorker"
    assert client.get(f"/api/songs/{song_id}/stems").json() == {"stems": [], "available": False}
    assert client.post("/api/songs/missing/stems").status_code == 404


def test_the_worker_job_stores_stems_that_the_api_serves(client: TestClient) -> None:
    song_id = _song_with_audio(client)
    worker = _worker(client)
    assert client.get(f"/api/songs/{song_id}/stems").json()["available"] is True
    queued = client.post(f"/api/songs/{song_id}/stems")
    assert queued.status_code == 202
    # The web process never runs it; the worker does.
    assert client.app.state.ctx.jobs.run_once() is False
    assert worker.run_once([KIND]) is True
    job = client.get(f"/api/jobs/{queued.json()['job_id']}").json()
    assert job["status"] == "done"
    assert job["result"]["model"] == "htdemucs_6s"
    listing = client.get(f"/api/songs/{song_id}/stems").json()
    assert [stem["name"] for stem in listing["stems"]] == ["bass", "drums", "guitar", "other", "piano", "vocals"]
    bass = next(stem for stem in listing["stems"] if stem["name"] == "bass")
    served = client.get("/" + bass["url"])
    assert served.status_code == 200
    assert served.content == b"htdemucs_6s:bass"
    assert served.headers["content-type"] == "audio/mpeg"
    # The stems are not the song's recording.
    assert client.get(f"/api/songs/{song_id}/audio").content == b"ID3 not really"


def test_a_new_run_replaces_the_stems_and_the_four_stem_model_has_no_guitar(client: TestClient) -> None:
    song_id = _song_with_audio(client)
    worker = _worker(client)
    for model in ("htdemucs_6s", "htdemucs"):
        client.post(f"/api/songs/{song_id}/stems", json={"model": model})
        assert worker.run_once([KIND]) is True
    names = [stem["name"] for stem in client.get(f"/api/songs/{song_id}/stems").json()["stems"]]
    # A run adds or replaces what it makes; the guitar from the six-stem run stays until the stems are removed.
    assert names == ["bass", "drums", "guitar", "other", "piano", "vocals"]
    bass = client.get(f"/api/songs/{song_id}/stems/bass")
    assert bass.content == b"htdemucs:bass"
    assert client.post(f"/api/songs/{song_id}/stems", json={"model": "nope"}).status_code == 422


def test_replacing_the_audio_or_deleting_removes_the_stems(client: TestClient) -> None:
    song_id = _song_with_audio(client)
    worker = _worker(client)
    client.post(f"/api/songs/{song_id}/stems")
    worker.run_once([KIND])
    media = client.app.state.ctx.media
    stem_files = [media.path_for(row) for row in media.stems_for("local", song_id)]
    assert len(stem_files) == 6 and all(path.is_file() for path in stem_files)
    client.post(f"/api/songs/{song_id}/audio", files={"file": ("new.mp3", b"ID3 new", "audio/mpeg")})
    assert client.get(f"/api/songs/{song_id}/stems").json()["stems"] == []
    assert not any(path.exists() for path in stem_files)

    client.post(f"/api/songs/{song_id}/stems")
    worker.run_once([KIND])
    assert client.delete(f"/api/songs/{song_id}/stems").status_code == 204
    assert client.get(f"/api/songs/{song_id}/stems").json()["stems"] == []
    assert client.get(f"/api/songs/{song_id}/stems/bass").json()["detail"]["key"] == "stems.none"
    assert client.get(f"/api/songs/{song_id}/stems/guitar.exe").status_code == 404


def test_a_failing_separation_reports_a_catalog_key(client: TestClient) -> None:
    def broken(source, model, out_dir, progress):
        raise engine.StemsError("Demucs is not installed in this worker", "stems.unavailable")

    song_id = _song_with_audio(client)
    worker = _worker(client, broken)
    job_id = client.post(f"/api/songs/{song_id}/stems").json()["job_id"]
    worker.run_once([KIND])
    job = client.get(f"/api/jobs/{job_id}").json()
    assert job["status"] == "error"
    assert job["error_key"] == "stems.unavailable"


def test_stems_stay_out_of_library_backups(client: TestClient, tmp_path: Path) -> None:
    import io
    import zipfile

    song_id = _song_with_audio(client)
    worker = _worker(client)
    client.post(f"/api/songs/{song_id}/stems")
    worker.run_once([KIND])
    export = client.get("/api/library/export")
    assert export.status_code == 200
    with zipfile.ZipFile(io.BytesIO(export.content)) as archive:
        manifest = archive.read("manifest.json").decode()
    assert '"audio"' in manifest
    assert "stem-" not in manifest


def test_separate_checks_the_model_and_that_demucs_is_installed(tmp_path: Path, monkeypatch) -> None:
    with pytest.raises(engine.StemsError) as bad:
        engine.separate(tmp_path / "a.mp3", "mystery", tmp_path, lambda *_: None)
    assert bad.value.key == "stems.badModel"
    monkeypatch.setattr(engine, "available", lambda: False)
    with pytest.raises(engine.StemsError) as missing:
        engine.separate(tmp_path / "a.mp3", "htdemucs", tmp_path, lambda *_: None)
    assert missing.value.key == "stems.unavailable"


def test_encode_mp3_keeps_the_wav_when_encoding_fails(tmp_path: Path) -> None:
    wav = tmp_path / "bass.wav"
    wav.write_bytes(b"not a wav")
    assert engine.encode_mp3(wav, "/bin/false") == wav
    assert wav.is_file()
