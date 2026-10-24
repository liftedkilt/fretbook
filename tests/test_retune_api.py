"""The convert endpoint: preview, add as a new track, replace, and the ways it refuses."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fretbook.app import create_app
from fretbook.config import Settings


@pytest.fixture
def client(tmp_path: Path):
    with TestClient(create_app(Settings.for_tests(tmp_path))) as running:
        yield running


def _tab(client: TestClient, preset: str = "guitar-6") -> dict:
    """A one-bar tab with a low E, an A chord shape, and nothing else."""
    song = client.post("/api/songs", json={"title": "Riff", "preset": preset, "measures": 1}).json()
    document = song["document"]
    beats = [
        {"position": 0, "duration": 960, "notes": [{"string": 5, "fret": 3}]},
        {"position": 960, "duration": 960, "notes": [{"string": 4, "fret": 2}, {"string": 3, "fret": 2}]},
    ]
    document["tracks"][0]["bars"][0]["voices"][0]["beats"] = beats
    saved = client.put(
        f"/api/songs/{song['id']}",
        json={"title": "Riff", "artist": "", "revision": song["revision"], "document": document},
    )
    assert saved.status_code == 200, saved.text
    return saved.json()


def test_preview_returns_the_track_and_saves_nothing(client: TestClient) -> None:
    song = _tab(client)
    track_id = song["document"]["tracks"][0]["id"]
    response = client.post(f"/api/songs/{song['id']}/convert", json={"track_id": track_id, "semitones": 2})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["song"] is None
    assert body["report"]["notes"] == 3
    assert body["report"]["refretted"] == 3
    assert body["track"]["bars"][0]["voices"][0]["beats"][0]["notes"][0] == {
        **song["document"]["tracks"][0]["bars"][0]["voices"][0]["beats"][0]["notes"][0],
        "fret": 5,
    }
    assert client.get(f"/api/songs/{song['id']}").json()["revision"] == song["revision"]


def test_add_puts_a_new_track_after_the_source(client: TestClient) -> None:
    song = _tab(client)
    track_id = song["document"]["tracks"][0]["id"]
    response = client.post(
        f"/api/songs/{song['id']}/convert",
        json={
            "track_id": track_id,
            "mode": "add",
            "revision": song["revision"],
            "preset": "guitar-drop-d",
            "name": "Drop D",
        },
    )
    assert response.status_code == 200, response.text
    saved = response.json()["song"]
    assert saved["revision"] == song["revision"] + 1
    tracks = saved["document"]["tracks"]
    assert [track["name"] for track in tracks] == [song["document"]["tracks"][0]["name"], "Drop D"]
    assert tracks[1]["id"] != track_id
    assert tracks[1]["tuning_midi"][-1] == 38
    assert tracks[1]["preferred"] is False
    # The source is untouched.
    assert tracks[0] == song["document"]["tracks"][0]


def test_replace_overwrites_the_track_and_keeps_its_id(client: TestClient) -> None:
    song = _tab(client)
    track_id = song["document"]["tracks"][0]["id"]
    response = client.post(
        f"/api/songs/{song['id']}/convert",
        json={"track_id": track_id, "mode": "replace", "revision": song["revision"], "capo": 2},
    )
    assert response.status_code == 200, response.text
    tracks = response.json()["song"]["document"]["tracks"]
    assert len(tracks) == 1
    assert tracks[0]["id"] == track_id
    assert tracks[0]["capo"] == 2
    assert tracks[0]["bars"][0]["voices"][0]["beats"][0]["notes"][0]["fret"] == 1


def test_a_stale_revision_is_a_conflict(client: TestClient) -> None:
    song = _tab(client)
    response = client.post(
        f"/api/songs/{song['id']}/convert",
        json={
            "track_id": song["document"]["tracks"][0]["id"],
            "mode": "replace",
            "revision": song["revision"] - 1,
            "semitones": 1,
        },
    )
    assert response.status_code == 409


def test_saving_needs_a_revision(client: TestClient) -> None:
    song = _tab(client)
    response = client.post(
        f"/api/songs/{song['id']}/convert",
        json={"track_id": song["document"]["tracks"][0]["id"], "mode": "add"},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["key"] == "convert.needsRevision"


def test_refusals(client: TestClient) -> None:
    song = _tab(client)
    track_id = song["document"]["tracks"][0]["id"]
    url = f"/api/songs/{song['id']}/convert"
    cases = [
        ({"track_id": "nope"}, 404, "convert.noTrack"),
        ({"track_id": track_id, "preset": "kazoo"}, 400, "convert.badPreset"),
        ({"track_id": track_id, "tuning_midi": [200, 40]}, 400, "convert.badTuning"),
        ({"track_id": track_id, "keep": "shape", "preset": "bass-4"}, 400, "convert.invalid"),
    ]
    for body, status, key in cases:
        response = client.post(url, json=body)
        assert (response.status_code, response.json()["detail"]["key"]) == (status, key), body
    sheet = client.post("/api/songs", json={"content_kind": "chords", "title": "Sheet", "chordpro": "[G]Hi"}).json()
    response = client.post(f"/api/songs/{sheet['id']}/convert", json={"track_id": "x"})
    assert (response.status_code, response.json()["detail"]["key"]) == (400, "convert.notTab")
    assert client.post("/api/songs/missing/convert", json={"track_id": "x"}).status_code == 404
