"""Audio transcription: the engine pieces, the worker job (with a fake transcriber) and the endpoints."""

import wave
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from fretbook.app import create_app
from fretbook.audio import transcription as engine
from fretbook.audio.synth import build_document, render_notes
from fretbook.config import Settings
from fretbook.jobs.runner import JobRunner
from fretbook.jobs.transcribe import KIND, register_transcribe
from fretbook.score.model import ScoreDocument
from fretbook.storage.media import MediaStore
from fretbook.storage.repository import SongRepository

RIFF = [(0.5 + i * 0.5, 0.95 + i * 0.5, pitch) for i, pitch in enumerate((40, 43, 45, 47, 52, 55, 57, 59))]


def _write_wav(path: Path, audio: np.ndarray, rate: int = 22050) -> None:
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())


def test_note_f_measure_matches_pitch_and_onset() -> None:
    reference = [(0.0, 0.5, 40), (1.0, 1.5, 43)]
    assert engine.note_f_measure(reference, reference) == (1.0, 1.0, 1.0)
    precision, recall, f_measure = engine.note_f_measure(reference, [(0.02, 0.4, 40), (1.0, 1.5, 44), (2.0, 2.5, 40)])
    assert (precision, recall) == (pytest.approx(1 / 3), pytest.approx(1 / 2))
    assert f_measure == pytest.approx(0.4)
    assert engine.note_f_measure(reference, [(0.2, 0.5, 40)]) == (0.0, 0.0, 0.0)
    assert engine.note_f_measure([], []) == (0.0, 0.0, 0.0)


def test_a_quieter_octave_that_starts_with_a_note_is_a_harmonic() -> None:
    low = engine.NoteEvent(1.0, 1.5, 40, 0.8)
    faint = engine.NoteEvent(1.0, 1.5, 40, 0.3)
    octave = engine.NoteEvent(1.01, 1.2, 52, 0.4)
    later = engine.NoteEvent(2.0, 2.5, 52, 0.4)
    louder = engine.NoteEvent(1.0, 1.5, 64, 0.95)
    assert engine.suppress_harmonics([low, octave, later]) == [low, later]
    assert engine.suppress_harmonics([faint, louder]) == [faint, louder]


def test_times_map_onto_the_beat_grid() -> None:
    beats = np.array([1.0, 1.5, 2.0, 2.5])
    assert engine._time_to_tick(1.25, beats, 0.5) == engine.TICKS_PER_QUARTER // 2
    assert engine._time_to_tick(2.5, beats, 0.5) == 3 * engine.TICKS_PER_QUARTER
    assert engine._time_to_tick(3.0, beats, 0.5) == 4 * engine.TICKS_PER_QUARTER
    assert engine._time_to_tick(0.5, beats, 0.5) == 0
    assert engine._time_to_tick(2.0, np.array([]), 0.5) == 4 * engine.TICKS_PER_QUARTER


needs_model = pytest.mark.skipif(not engine.available(), reason="onnxruntime is not installed")


@needs_model
def test_synthetic_audio_is_transcribed_into_a_fingered_tab_with_sync_marks(tmp_path: Path) -> None:
    audio = tmp_path / "riff.wav"
    _write_wav(audio, render_notes(RIFF, bpm=120))
    steps: list[str] = []
    document, _ = engine.transcribe(audio, progress=lambda message, key: steps.append(key))
    assert steps[-1] == "transcribe.complete"
    track = document.tracks[0]
    sounding = [beat for bar in track.bars for voice in bar.voices for beat in voice.beats if beat.notes]
    assert len(sounding) >= len(RIFF) - 1
    assert document.sync.keyed_by == "played"
    assert len(document.sync.anchors) == len(document.bars)
    marks = [document.sync.anchors[str(i)] for i in range(len(document.bars))]
    assert marks == sorted(marks)


@needs_model
def test_note_accuracy_on_a_synthetic_riff() -> None:
    estimated = [(e.start_sec, e.end_sec, e.pitch) for e in engine.predict_notes(render_notes(RIFF, bpm=120))]
    _, recall, f_measure = engine.note_f_measure(RIFF, estimated)
    assert recall >= 0.85
    assert f_measure > 0.7


def test_bad_grids_and_silence_are_refused(tmp_path: Path) -> None:
    quiet = tmp_path / "quiet.wav"
    _write_wav(quiet, np.zeros(22050 // 4))
    with pytest.raises(engine.TranscriptionError) as grid:
        engine.transcribe(quiet, grid=3)
    assert grid.value.key == "transcribe.badGrid"
    if engine.available():
        with pytest.raises(engine.TranscriptionError) as short:
            engine.transcribe(quiet)
        assert short.value.key == "transcribe.tooShort"
        silence = tmp_path / "silence.wav"
        _write_wav(silence, np.zeros(22050 * 3))
        with pytest.raises(engine.TranscriptionError) as empty:
            engine.transcribe(silence)
        assert empty.value.key == "transcribe.noNotes"


def _fake_transcriber(source: Path, stem: str, preset: str | None, grid: int, progress) -> tuple[ScoreDocument, list]:
    progress("Transcribing notes", "transcribe.modelInference")
    document = build_document([(4, 4)] * 4, bpm=100)
    document.sync.anchors = {str(i): 1.0 + i * 2.4 for i in range(4)}
    document.sync.keyed_by = "played"
    return document, []


@pytest.fixture
def client(tmp_path: Path):
    with TestClient(create_app(Settings.for_tests(tmp_path))) as client:
        yield client


def _worker(client: TestClient, transcriber=_fake_transcriber) -> JobRunner:
    ctx = client.app.state.ctx
    runner = JobRunner(ctx.settings, worker_id="w1")
    register_transcribe(runner, SongRepository(ctx.settings), MediaStore(ctx.settings), transcriber)
    runner.heartbeat([KIND], host="test", pid=1)
    return runner


def _song_with_audio(client: TestClient) -> str:
    song_id = client.post(
        "/api/songs", json={"title": "Own tune", "content_kind": "chords", "chordpro": "[G]Hi"}
    ).json()["id"]
    upload = client.post(f"/api/songs/{song_id}/audio", files={"file": ("tune.mp3", b"ID3 not really", "audio/mpeg")})
    assert upload.status_code == 200
    return song_id


def test_transcription_is_refused_without_audio_or_a_worker(client: TestClient) -> None:
    bare = client.post("/api/songs", json={"title": "Silent", "content_kind": "chords", "chordpro": "[C]x"}).json()[
        "id"
    ]
    assert client.post(f"/api/songs/{bare}/transcribe").json()["detail"]["key"] == "audio.none"
    song_id = _song_with_audio(client)
    refused = client.post(f"/api/songs/{song_id}/transcribe")
    assert refused.status_code == 409
    assert refused.json()["detail"]["key"] == "transcribe.noWorker"
    assert client.get(f"/api/songs/{song_id}/transcribe").json() == {"available": False}
    assert client.post("/api/songs/missing/transcribe").status_code == 404
    upload = client.post("/api/imports/transcribe", files={"file": ("a.mp3", b"x", "audio/mpeg")})
    assert upload.status_code == 409
    odd = client.post("/api/imports/transcribe", files={"file": ("a.mp3", b"x", "audio/mpeg")}, data={"grid": "3"})
    assert odd.json()["detail"]["key"] == "transcribe.badGrid"


def test_the_worker_adds_a_draft_track_to_a_song_with_audio(client: TestClient) -> None:
    song_id = _song_with_audio(client)
    worker = _worker(client)
    assert client.get(f"/api/songs/{song_id}/transcribe").json() == {"available": True}
    queued = client.post(f"/api/songs/{song_id}/transcribe", json={"stem": "bass", "grid": 8})
    assert queued.status_code == 202
    assert client.app.state.ctx.jobs.run_once() is False  # the web process never runs it
    assert worker.run_once([KIND]) is True
    job = client.get(f"/api/jobs/{queued.json()['job_id']}").json()
    assert job["status"] == "done", job
    assert job["result"]["song_id"] == song_id
    assert job["result"]["anchors"] == 4
    song = client.get(f"/api/songs/{song_id}").json()
    assert song["source_ref"]["transcribed"] is True
    assert song["source_ref"]["needs_review"] is True


def test_an_uploaded_recording_becomes_a_new_song_with_its_audio(client: TestClient) -> None:
    worker = _worker(client)
    queued = client.post(
        "/api/imports/transcribe",
        files={"file": ("my-riff.mp3", b"ID3 not really", "audio/mpeg")},
        data={"stem": "mix", "grid": "16", "artist": "Me"},
    )
    assert queued.status_code == 202
    assert worker.run_once([KIND]) is True
    job = client.get(f"/api/jobs/{queued.json()['job_id']}").json()
    assert job["status"] == "done", job
    created = client.get(f"/api/songs/{job['result']['song_id']}").json()
    assert (created["title"], created["artist"]) == ("My Riff", "Me")
    assert created["source_kind"] == "transcription"
    assert client.get(f"/api/songs/{created['id']}/audio").status_code == 200


def test_a_failed_transcription_reports_its_error_key(client: TestClient) -> None:
    def failing(source, stem, preset, grid, progress):
        raise engine.TranscriptionError("no notes", "transcribe.noNotes")

    song_id = _song_with_audio(client)
    worker = _worker(client, failing)
    queued = client.post(f"/api/songs/{song_id}/transcribe")
    worker.run_once([KIND])
    job = client.get(f"/api/jobs/{queued.json()['job_id']}").json()
    assert (job["status"], job["error_key"]) == ("error", "transcribe.noNotes")
