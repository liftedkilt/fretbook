"""Tests for bulk import and duplicate detection."""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from fretbook.app import create_app
from fretbook.config import Settings

XML = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Bulk Song</work-title></work>
  <identification><creator type="composer">Bulk Artist</creator></identification>
  <part-list><score-part id="P1"><part-name>Bass</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <staff-details>
          <staff-tuning line="1"><tuning-step>E</tuning-step><tuning-octave>1</tuning-octave></staff-tuning>
          <staff-tuning line="2"><tuning-step>A</tuning-step><tuning-octave>1</tuning-octave></staff-tuning>
          <staff-tuning line="3"><tuning-step>D</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
          <staff-tuning line="4"><tuning-step>G</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
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

CHO = """{title: Chord Song}
{artist: Chord Artist}
[Am]Hello [C]world
"""


def _client(tmp_path: Path) -> TestClient:
    settings = Settings(
        host="127.0.0.1",
        port=8137,
        data_dir=tmp_path,
        database_path=tmp_path / "fretbook.sqlite",
        legacy_songs_dir=None,
        auth_mode="single",
        root_path="",
        download_audio=False,
        forwarded_allow_ips="127.0.0.1",
        max_upload_bytes=10 * 1024 * 1024,
        audio_timeout_seconds=30,
        static_dir=None,
        oidc_issuer="",
        oidc_client_id="",
        oidc_client_secret="",
        oidc_redirect_uri="",
        session_secret="secret",
    )
    app = create_app(settings)
    return TestClient(app)


def test_bulk_import_multiple_files(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        response = client.post(
            "/api/imports/bulk",
            files=[
                ("files", ("song1.xml", XML.encode(), "application/xml")),
                ("files", ("song2.cho", CHO.encode(), "text/plain")),
            ],
            data={"tags": "batch1, test"},
        )
        assert response.status_code == 202
        body = response.json()
        assert body["total_files"] == 2
        assert len(body["jobs"]) == 2

        # Process queued jobs
        while client.app.state.ctx.jobs.run_once():
            pass

        songs = client.get("/api/songs").json()
        assert songs["total"] == 2
        titles = {s["title"] for s in songs["items"]}
        assert "Bulk Song" in titles
        assert "Chord Song" in titles
        for s in songs["items"]:
            detail = client.get(f"/api/songs/{s['id']}").json()
            assert "batch1" in detail["tags"]
            assert "test" in detail["tags"]


def test_bulk_import_zip_archive_with_default_tags(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("sub/song1.xml", XML)
            zf.writestr("song2.cho", CHO)
        zip_bytes = buf.getvalue()

        response = client.post(
            "/api/imports/bulk",
            files=[("files", ("Rock_Pack.zip", zip_bytes, "application/zip"))],
        )
        assert response.status_code == 202
        body = response.json()
        assert body["total_files"] == 2

        while client.app.state.ctx.jobs.run_once():
            pass

        songs = client.get("/api/songs").json()
        assert songs["total"] == 2

        # Verify tag was assigned from zip stem both in source_ref and via tags feature
        song_detail = client.get(f"/api/songs/{songs['items'][0]['id']}").json()
        assert song_detail["source_ref"].get("tags") == ["Rock_Pack"]
        assert "Rock_Pack" in song_detail["tags"]


def test_duplicate_skip_option(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        # Import the first time
        resp1 = client.post(
            "/api/imports/bulk",
            files=[("files", ("song.xml", XML.encode(), "application/xml"))],
            data={"duplicates": "skip"},
        )
        assert resp1.status_code == 202
        while client.app.state.ctx.jobs.run_once():
            pass

        assert client.get("/api/songs").json()["total"] == 1

        # Import identical file second time with duplicates=skip
        resp2 = client.post(
            "/api/imports/bulk",
            files=[("files", ("song_duplicate.xml", XML.encode(), "application/xml"))],
            data={"duplicates": "skip"},
        )
        assert resp2.status_code == 202
        job_id = resp2.json()["jobs"][0]["job_id"]

        while client.app.state.ctx.jobs.run_once():
            pass

        # Job should finish with skipped status
        job = client.get(f"/api/jobs/{job_id}").json()
        assert job["status"] == "done"
        assert job["result"].get("skipped") is True

        # Total songs remained 1
        assert client.get("/api/songs").json()["total"] == 1


def test_duplicate_keep_both_option(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        resp1 = client.post(
            "/api/imports/bulk",
            files=[("files", ("song.xml", XML.encode(), "application/xml"))],
        )
        assert resp1.status_code == 202
        while client.app.state.ctx.jobs.run_once():
            pass
        assert client.get("/api/songs").json()["total"] == 1

        # Import identical file with duplicates=keep_both
        resp2 = client.post(
            "/api/imports/bulk",
            files=[("files", ("song_copy.xml", XML.encode(), "application/xml"))],
            data={"duplicates": "keep_both"},
        )
        assert resp2.status_code == 202
        while client.app.state.ctx.jobs.run_once():
            pass

        # Total songs is now 2
        assert client.get("/api/songs").json()["total"] == 2


def test_duplicate_replace_option(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        resp1 = client.post(
            "/api/imports/bulk",
            files=[("files", ("song.xml", XML.encode(), "application/xml"))],
        )
        assert resp1.status_code == 202
        while client.app.state.ctx.jobs.run_once():
            pass

        original_song = client.get("/api/songs").json()["items"][0]
        original_id = original_song["id"]

        # Now import a chordpro with the exact same title & artist, with duplicates=replace
        new_cho = "{title: Bulk Song}\n{artist: Bulk Artist}\n[G]New version\n"
        resp2 = client.post(
            "/api/imports/bulk",
            files=[("files", ("updated.cho", new_cho.encode(), "text/plain"))],
            data={"duplicates": "replace"},
        )
        assert resp2.status_code == 202
        while client.app.state.ctx.jobs.run_once():
            pass

        songs = client.get("/api/songs").json()
        assert songs["total"] == 1
        updated_song = client.get(f"/api/songs/{original_id}").json()
        assert updated_song["content_kind"] == "chords"
        assert "[G]New version" in updated_song["chordpro"]


def test_zip_safety_path_traversal_rejected(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr(zipfile.ZipInfo("../../evil.txt"), "bad")

        resp = client.post(
            "/api/imports/bulk",
            files=[("files", ("evil.zip", buf.getvalue(), "application/zip"))],
        )
        assert resp.status_code == 400
        assert resp.json()["detail"]["key"] == "import.zipPathTraversal"


def test_zip_safety_zip_bomb_rejected(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("bomb.txt", b"\x00" * (2 * 1024 * 1024))

        resp = client.post(
            "/api/imports/bulk",
            files=[("files", ("bomb.zip", buf.getvalue(), "application/zip"))],
        )
        assert resp.status_code == 400
        assert resp.json()["detail"]["key"] == "import.zipBomb"
