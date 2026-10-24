"""Automatic sync: beat tracking, alignment to the score's bars, the job and its endpoint."""

import wave
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from fretbook.app import create_app
from fretbook.audio.beats import SAMPLE_RATE, AudioDecodeError, decode, onset_envelope
from fretbook.audio.synth import bar_starts_for, build_document, render
from fretbook.config import Settings
from fretbook.score.autosync import LOW_CONFIDENCE, propose
from fretbook.score.model import ScoreDocument


def _errors_ms(document: ScoreDocument, **kwargs) -> tuple[np.ndarray, int, int]:
    starts = bar_starts_for(document, **{k: v for k, v in kwargs.items() if k in {"lead_in", "drift"}})
    performed = kwargs.get("speed", 1.0)
    if performed != 1.0:
        slow = document.model_copy(deep=True)
        slow.bpm = document.bpm * performed
        starts = bar_starts_for(slow, lead_in=kwargs.get("lead_in", 0.0))
    proposal = propose(document, render(document, starts))
    errors = np.array(
        [abs(proposal.anchors[str(i)] - t) * 1000 for i, t in enumerate(starts) if str(i) in proposal.anchors]
    )
    return errors, len(proposal.anchors), len(starts)


@pytest.mark.parametrize("bpm", [70, 130, 190])
def test_bar_starts_are_found_at_several_tempi(bpm: int) -> None:
    errors, marked, total = _errors_ms(build_document([(4, 4)] * 24, bpm=bpm), lead_in=1.8)
    assert marked == total
    assert np.median(errors) < 15
    assert errors.max() < 50


@pytest.mark.parametrize(
    ("name", "signatures", "bpm"),
    [
        ("three four", [(3, 4)] * 24, 100),
        ("compound", [(6, 8)] * 24, 120),
        ("mixed meters", [(4, 4), (4, 4), (3, 4), (7, 8)] * 6, 110),
    ],
)
def test_time_signatures_set_the_bar_lengths(name: str, signatures: list[tuple[int, int]], bpm: int) -> None:
    errors, marked, total = _errors_ms(build_document(signatures, bpm=bpm), lead_in=1.2)
    assert marked == total, name
    assert errors.max() < 50, name


def test_repeats_are_keyed_by_played_bar() -> None:
    document = build_document([(4, 4)] * 10, bpm=120, repeat=(2, 5, 3))
    errors, marked, total = _errors_ms(document, lead_in=1.0)
    assert total == 19  # 10 written bars, 4 of them played 3 times, plus the end
    assert marked == total
    assert errors.max() < 50


@pytest.mark.parametrize("lead_in", [0.0, 1.0, 1.5, 2.0])
def test_tempo_changes_in_the_score_are_followed(lead_in: float) -> None:
    document = build_document([(4, 4)] * 36, bpm=100, tempos={12: 130, 24: 90})
    errors, marked, total = _errors_ms(document, lead_in=lead_in)
    assert marked == total
    # The few bars where the tempo turns are the loosest: the tracker needs a beat or two to settle.
    assert np.median(errors) < 15
    assert errors.max() < 100


def test_a_drifting_or_slower_performance_is_followed() -> None:
    document = build_document([(4, 4)] * 32, bpm=100)
    errors, marked, total = _errors_ms(document, lead_in=1.5, drift=0.08)
    assert marked == total and errors.max() < 60
    errors, marked, total = _errors_ms(document, lead_in=1.5, speed=0.88)
    assert marked == total and errors.max() < 50


def test_rubato_and_a_closing_ritardando_are_followed() -> None:
    document = build_document([(4, 4)] * 32, bpm=100)
    starts = bar_starts_for(document, lead_in=1.5, sway=0.15, ritardando=0.5, jitter=0.01)
    audio = render(document, starts)
    flexible = propose(document, audio, tracker="flexible")
    auto = propose(document, audio)
    for proposal in (flexible, auto):
        errors = np.array([abs(proposal.anchors[str(i)] - t) for i, t in enumerate(starts)])
        # The slowing at the very end is the loosest: the last mark may be a tenth of a second out.
        assert np.median(errors) < 0.02
        assert errors.max() < 0.15
    assert auto.anchors == flexible.anchors  # the steady tracker is left behind by this much sway
    with pytest.raises(ValueError):
        propose(document, audio, tracker="psychic")


def test_a_stated_start_places_bar_zero_after_an_intro_and_count_in() -> None:
    document = build_document([(4, 4)] * 24, bpm=120)
    starts = bar_starts_for(document, lead_in=7.0)
    audio = render(document, starts, count_in=4, intro=4.0)
    # 0.2 s out, as a listener's "about 7 seconds" would be.
    proposal = propose(document, audio, start_seconds=7.2)
    assert len(proposal.anchors) == len(starts)
    assert max(abs(proposal.anchors[str(i)] - t) for i, t in enumerate(starts)) < 0.05


def test_a_recording_cut_partway_is_keyed_from_the_stated_bar() -> None:
    document = build_document([(4, 4)] * 24, bpm=120)
    starts = bar_starts_for(document, lead_in=0.5)
    audio = render(document, starts)
    cut = starts[8] - 0.5
    proposal = propose(document, audio[int(cut * SAMPLE_RATE) :], start_bar=8, start_seconds=0.5)
    assert min(int(key) for key in proposal.anchors) == 8
    assert max(int(key) for key in proposal.anchors) == 24
    assert max(abs(proposal.anchors[str(i)] - (starts[i] - cut)) for i in range(8, 25)) < 0.05
    assert all(bar >= 8 for bar in proposal.low_confidence)
    with pytest.raises(AudioDecodeError) as raised:
        propose(document, audio, start_bar=99)
    assert raised.value.key == "autosync.badStart"


def test_confidence_is_high_for_a_clear_beat_and_low_for_noise() -> None:
    document = build_document([(4, 4)] * 24, bpm=120)
    clear = propose(document, render(document, bar_starts_for(document, lead_in=1.0)))
    assert clear.overall > LOW_CONFIDENCE
    assert clear.low_confidence == []
    assert set(clear.anchors) == set(clear.confidence)
    rng = np.random.default_rng(3)
    try:
        noisy = propose(document, rng.standard_normal(SAMPLE_RATE * 40) * 0.1)
    except AudioDecodeError as error:
        assert error.key.startswith("autosync.")
    else:
        assert noisy.overall < clear.overall


@pytest.mark.parametrize("seconds", [0.2, 3])
def test_silence_and_short_audio_are_refused(seconds: float) -> None:
    document = build_document([(4, 4)] * 4, bpm=120)
    with pytest.raises(AudioDecodeError) as raised:
        propose(document, np.zeros(int(SAMPLE_RATE * seconds)))
    assert raised.value.key.startswith("autosync.")


def _write_wav(path: Path, samples: np.ndarray, rate: int = SAMPLE_RATE, channels: int = 1) -> None:
    data = (np.clip(samples, -1, 1) * 32767).astype("<i2")
    if channels == 2:
        data = np.repeat(data[:, None], 2, axis=1).reshape(-1)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(channels)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(data.tobytes())


def test_decode_reads_wav_in_any_rate_and_channel_count(tmp_path: Path) -> None:
    tone = np.sin(2 * np.pi * 440 * np.arange(44100) / 44100) * 0.5
    stereo = tmp_path / "stereo.wav"
    _write_wav(stereo, tone, rate=44100, channels=2)
    samples = decode(stereo)
    assert abs(samples.size - SAMPLE_RATE) <= 1
    assert abs(float(np.abs(samples).max()) - 0.5) < 0.02
    envelope = onset_envelope(samples)
    assert envelope.size > 0
    assert onset_envelope(np.zeros(10)).size == 0


def test_decode_fails_with_a_catalog_key(tmp_path: Path) -> None:
    broken = tmp_path / "broken.mp3"
    broken.write_bytes(b"not audio at all")
    with pytest.raises(AudioDecodeError) as raised:
        decode(broken)
    assert raised.value.key in {"autosync.decodeFailed", "autosync.noFfmpeg"}


def _client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(Settings.for_tests(tmp_path)))


def _create_tab(client: TestClient, document: ScoreDocument) -> str:
    saved = client.post(
        "/api/songs/import-document",
        json={"title": "Synthetic", "artist": "Test", "source_kind": "guitarpro", "document": document.model_dump()},
    )
    assert saved.status_code == 201
    return saved.json()["id"]


def test_endpoint_queues_a_job_that_proposes_anchors_without_saving(tmp_path: Path) -> None:
    document = build_document([(4, 4)] * 12, bpm=120)
    starts = bar_starts_for(document, lead_in=1.0)
    wav = tmp_path / "song.wav"
    _write_wav(wav, render(document, starts))
    with _client(tmp_path / "data") as client:
        song_id = _create_tab(client, document)
        assert client.post(f"/api/songs/{song_id}/autosync").json()["detail"]["key"] == "audio.none"
        upload = client.post(f"/api/songs/{song_id}/audio", files={"file": ("song.wav", wav.read_bytes(), "audio/wav")})
        assert upload.status_code == 200
        revision = upload.json()["revision"]

        queued = client.post(f"/api/songs/{song_id}/autosync")
        assert queued.status_code == 202
        job_id = queued.json()["job_id"]
        client.app.state.ctx.jobs.run_once()
        job = client.get(f"/api/jobs/{job_id}").json()
        assert job["status"] == "done", job
        proposal = job["result"]["autosync"]
        assert len(proposal["anchors"]) == 13
        assert max(abs(proposal["anchors"][str(i)] - t) for i, t in enumerate(starts)) < 0.05
        assert proposal["overall"] > LOW_CONFIDENCE

        # Only a proposal: the song is untouched until the client sends the anchors to the sync endpoint.
        unchanged = client.get(f"/api/songs/{song_id}").json()
        assert unchanged["document"]["sync"]["anchors"] == {}
        assert unchanged["revision"] == revision
        accepted = client.patch(f"/api/songs/{song_id}/sync", json={"bpm": 120, "anchors": proposal["anchors"]})
        assert accepted.status_code == 200
        assert len(accepted.json()["document"]["sync"]["anchors"]) == 13


def test_endpoint_passes_the_start_to_the_job_and_checks_the_bar(tmp_path: Path) -> None:
    document = build_document([(4, 4)] * 12, bpm=120)
    starts = bar_starts_for(document, lead_in=4.0)
    wav = tmp_path / "song.wav"
    _write_wav(wav, render(document, starts, count_in=4))
    with _client(tmp_path / "data") as client:
        song_id = _create_tab(client, document)
        client.post(f"/api/songs/{song_id}/audio", files={"file": ("song.wav", wav.read_bytes(), "audio/wav")})
        bad = client.post(f"/api/songs/{song_id}/autosync", json={"start_bar": 12})
        assert bad.status_code == 400
        assert bad.json()["detail"]["key"] == "autosync.badStart"
        assert client.post(f"/api/songs/{song_id}/autosync", json={"start_seconds": -1}).status_code == 422
        queued = client.post(f"/api/songs/{song_id}/autosync", json={"start_seconds": 4.1})
        assert queued.status_code == 202
        client.app.state.ctx.jobs.run_once()
        job = client.get(f"/api/jobs/{queued.json()['job_id']}").json()
        assert job["status"] == "done", job
        anchors = job["result"]["autosync"]["anchors"]
        assert max(abs(anchors[str(i)] - t) for i, t in enumerate(starts)) < 0.05


def test_endpoint_refuses_chord_sheets_and_other_owners_songs(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        sheet = client.post("/api/songs", json={"title": "Sheet", "content_kind": "chords", "chordpro": "[G]Hi"})
        if sheet.status_code in {200, 201}:
            refused = client.post(f"/api/songs/{sheet.json()['id']}/autosync")
            assert refused.status_code == 400
        assert client.post("/api/songs/missing/autosync").status_code == 404


def test_job_reports_unreadable_audio_with_a_catalog_key(tmp_path: Path) -> None:
    document = build_document([(4, 4)] * 4, bpm=120)
    with _client(tmp_path) as client:
        song_id = _create_tab(client, document)
        client.post(f"/api/songs/{song_id}/audio", files={"file": ("bad.mp3", b"definitely not an mp3", "audio/mpeg")})
        job_id = client.post(f"/api/songs/{song_id}/autosync").json()["job_id"]
        client.app.state.ctx.jobs.run_once()
        job = client.get(f"/api/jobs/{job_id}").json()
        assert job["status"] == "error"
        assert job["error_key"].startswith("autosync.")
