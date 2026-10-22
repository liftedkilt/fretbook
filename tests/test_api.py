import json
import time
from dataclasses import replace
from pathlib import Path

from fastapi.testclient import TestClient

from fretbook.app import create_app
from fretbook.config import Settings

XML = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Bass</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <staff-details>
          <staff-tuning line="1"><tuning-step>G</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
          <staff-tuning line="2"><tuning-step>D</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
          <staff-tuning line="3"><tuning-step>A</tuning-step><tuning-octave>1</tuning-octave></staff-tuning>
          <staff-tuning line="4"><tuning-step>E</tuning-step><tuning-octave>1</tuning-octave></staff-tuning>
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


def test_library_edit_audio_and_pdf_stub(tmp_path: Path) -> None:
    app = create_app(Settings.for_tests(tmp_path))
    with TestClient(app) as client:
        health = client.get("/api/health")
        assert health.status_code == 200
        assert health.json()["name"] == "Fretbook"
        meta = client.get("/api/meta").json()
        assert meta["tagline"] == "Self-hosted tabs and sheet music for bass and guitar."
        assert meta["exporters"] == ["json"]
        assert meta["auth_mode"] == "single"
        assert any(item["id"] == "guitar-6" for item in meta["instruments"])

        created = client.post(
            "/api/songs",
            json={"title": "New", "artist": "Me", "preset": "bass-4", "bpm": 90, "measures": 2},
        )
        assert created.status_code == 201
        song = created.json()
        song_id = song["id"]
        assert song["document"]["tracks"][0]["tuning_midi"] == [43, 38, 33, 28]
        assert len(song["document"]["tracks"][0]["measures"]) == 2

        document = song["document"]
        beat = document["tracks"][0]["measures"][0]["voices"][0]["beats"][0]
        beat["rest"] = False
        beat["notes"] = [{"string": 0, "fret": 3, "dead": False, "tie": False, "extras": {}}]
        updated = client.put(
            f"/api/songs/{song_id}",
            json={"title": "New", "artist": "Me", "document": document},
        )
        assert updated.status_code == 200
        assert updated.json()["document"]["tracks"][0]["measures"][0]["voices"][0]["beats"][0]["notes"][0]["fret"] == 3

        synced = client.patch(f"/api/songs/{song_id}/sync", json={"bpm": 90, "anchors": {"0": 1.25}})
        assert synced.status_code == 200
        assert synced.json()["document"]["sync"]["anchors"]["0"] == 1.25

        listed = client.get("/api/songs").json()
        assert listed[0]["id"] == song_id
        assert "document" not in listed[0]

        audio = client.post(
            f"/api/songs/{song_id}/audio",
            files={"file": ("click.wav", WAV, "audio/wav")},
        )
        assert audio.status_code == 200
        assert audio.json()["has_audio"] is True
        fetched = client.get(f"/api/songs/{song_id}/audio")
        assert fetched.status_code == 200
        assert fetched.content[:4] == b"RIFF"

        exported = client.get(f"/api/songs/{song_id}/export.json")
        assert exported.json()["format"] == "fretbook-song"
        pdf = client.get(f"/api/songs/{song_id}/export.pdf")
        assert pdf.status_code == 501

        missing = client.get("/api/songs/missing")
        assert missing.status_code == 404

        removed = client.delete(f"/api/songs/{song_id}")
        assert removed.status_code == 204
        assert client.get(f"/api/songs/{song_id}").status_code == 404


def test_file_import_and_guitar_pro_refusal(tmp_path: Path) -> None:
    app = create_app(Settings.for_tests(tmp_path))
    with TestClient(app) as client:
        refused = client.post(
            "/api/imports/file",
            files={"file": ("song.gp5", b"not-a-real-gp", "application/octet-stream")},
        )
        assert refused.status_code == 400
        assert "alphaTab" in refused.json()["detail"]

        accepted = client.post(
            "/api/imports/file",
            files={"file": ("song.musicxml", XML.encode(), "application/xml")},
        )
        assert accepted.status_code == 202
        job_id = accepted.json()["job_id"]
        client.app.state.ctx.jobs.run_once()
        job = {"status": "queued"}
        for _ in range(30):
            job = client.get(f"/api/jobs/{job_id}").json()
            if job["status"] in {"done", "error"}:
                break
            time.sleep(0.1)
        assert job["status"] == "done", job
        assert "payload" not in job
        song = client.get(f"/api/songs/{job['result']['song_id']}").json()
        assert song["title"] == "song" or song["document"]["tracks"][0]["tuning_midi"][0] == 43

        bad = client.post("/api/imports", json={"url": "https://example.com/nope"})
        assert bad.status_code == 400


def test_browser_document_import(tmp_path: Path) -> None:
    app = create_app(Settings.for_tests(tmp_path))
    with TestClient(app) as client:
        blank = client.post("/api/songs", json={"title": "Seed", "preset": "guitar-7"}).json()
        payload = {
            "title": "From Guitar Pro",
            "artist": "Browser",
            "source_kind": "guitarpro",
            "document": blank["document"],
        }
        saved = client.post("/api/songs/import-document", json=payload)
        assert saved.status_code == 201
        body = saved.json()
        assert body["source_kind"] == "guitarpro"
        assert body["string_count"] == 7


def test_root_path_rewrites_base_href(tmp_path: Path) -> None:
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text('<html><head><base href="/" /></head></html>\n', encoding="utf-8")
    settings = replace(Settings.for_tests(tmp_path), root_path="/fretbook", static_dir=static)
    with TestClient(create_app(settings)) as client:
        page = client.get("/songs/abc")
        assert page.status_code == 200
        assert '<base href="/fretbook/">' in page.text


def test_english_catalog_covers_job_keys() -> None:
    catalog = json.loads(Path("web/src/locales/en.json").read_text(encoding="utf-8"))
    for key in (
        "fetchingTab",
        "fetchingSync",
        "tabReady",
        "readingFile",
        "youtubeUnavailable",
        "downloadingAudio",
        "convertingAudio",
        "ready",
    ):
        assert key in catalog["import"]
    assert catalog["app"]["title"] == "Fretbook"
    assert catalog["app"]["tagline"] == "Self-hosted tabs and sheet music for bass and guitar."
