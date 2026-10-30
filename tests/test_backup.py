"""Library export and restore, and the ``backup`` command."""

import io
import json
import sqlite3
import time
import zipfile
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fretbook.app import create_app
from fretbook.backup.snapshot import PREFIX, take_snapshot
from fretbook.config import Settings
from fretbook.main import main

WAV = (
    b"RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00"
    b"\x44\xac\x00\x00\x88X\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00"
)
SHEET = "{title: Hello}\n[G]Hello [C]friend\n"


_OPEN: list[TestClient] = []


def _client(tmp_path: Path, name: str = "a", **changes) -> TestClient:
    """A started app (migrated, job thread running); closed by the ``_close_clients`` fixture."""
    client = TestClient(create_app(replace(Settings.for_tests(tmp_path / name), **changes)))
    client.__enter__()
    _OPEN.append(client)
    return client


@pytest.fixture(autouse=True)
def _close_clients():
    yield
    while _OPEN:
        _OPEN.pop().__exit__(None, None, None)


def _seed(client: TestClient) -> dict[str, dict]:
    tab = client.post("/api/songs", json={"title": "Riff", "artist": "Me", "measures": 2}).json()
    chords = client.post("/api/songs", json={"content_kind": "chords", "title": "Hello", "chordpro": SHEET}).json()
    upload = client.post(f"/api/songs/{tab['id']}/audio", files={"file": ("take.wav", WAV, "audio/wav")})
    assert upload.status_code == 200
    return {"tab": tab, "chords": chords}


def _restore(client: TestClient, archive: bytes, mode: str = "skip") -> dict:
    response = client.post("/api/library/import", files={"file": ("lib.zip", archive)}, data={"mode": mode})
    assert response.status_code == 202, response.text
    job_id = response.json()["job_id"]
    client.app.state.ctx.jobs.run_once()
    for _ in range(50):
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in {"done", "error"}:
            return job
        time.sleep(0.1)
    raise AssertionError("restore did not finish")


def _zip(members: dict[str, bytes | str], manifest: dict | None = None) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in members.items():
            archive.writestr(name, data)
        if manifest is not None:
            archive.writestr("manifest.json", json.dumps(manifest))
    return buffer.getvalue()


def test_round_trip_into_a_fresh_library(tmp_path: Path) -> None:
    source = _client(tmp_path, "src")
    songs = _seed(source)
    response = source.get("/api/library/export")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert "fretbook-library-" in response.headers["content-disposition"]
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["format"] == "fretbook-library"
        assert manifest["scope"] == "user"
        assert manifest["schema_version"] >= 2
        assert {song["title"] for song in manifest["songs"]} == {"Riff", "Hello"}
        assert f"songs/{songs['chords']['id']}/song.cho" in archive.namelist()
        assert f"songs/{songs['tab']['id']}/song.json" in archive.namelist()
    # The temporary archive does not pile up in the inbox.
    assert list(source.app.state.ctx.settings.inbox_dir.glob("export-*")) == []

    target = _client(tmp_path, "dst")
    job = _restore(target, response.content)
    assert job["status"] == "done", job
    assert (job["result"]["imported"], job["result"]["skipped"], job["result"]["failed"]) == (2, 0, 0)

    restored = {song["title"]: song for song in target.get("/api/songs").json()["items"]}
    tab = target.get(f"/api/songs/{restored['Riff']['id']}").json()
    assert tab["document"] == songs["tab"]["document"]
    assert tab["artist"] == "Me"
    assert tab["id"] == songs["tab"]["id"]  # a free id is kept
    assert target.get(f"/api/songs/{restored['Hello']['id']}").json()["chordpro"] == songs["chords"]["chordpro"]
    audio = target.get(f"/api/songs/{tab['id']}/audio")
    assert audio.status_code == 200 and audio.content == WAV
    assert audio.headers["content-type"] == "audio/wav"
    assert list(target.app.state.ctx.settings.inbox_dir.glob("*")) == []


def test_existing_songs_are_skipped_or_kept_as_copies(tmp_path: Path) -> None:
    client = _client(tmp_path)
    _seed(client)
    archive = client.get("/api/library/export").content

    skipped = _restore(client, archive, "skip")["result"]
    assert (skipped["imported"], skipped["skipped"], skipped["copied"]) == (0, 2, 0)
    assert len(client.get("/api/songs").json()["items"]) == 2

    copied = _restore(client, archive, "copy")["result"]
    assert (copied["imported"], copied["skipped"], copied["copied"]) == (0, 0, 2)
    songs = client.get("/api/songs").json()["items"]
    assert len(songs) == 4
    assert len({song["id"] for song in songs}) == 4
    assert len({song["slug"] for song in songs}) == 4


def test_same_title_artist_and_source_counts_as_the_same_song(tmp_path: Path) -> None:
    source = _client(tmp_path, "src")
    _seed(source)
    archive = source.get("/api/library/export").content
    target = _client(tmp_path, "dst")
    target.post("/api/songs", json={"title": "riff", "artist": "ME", "measures": 1})
    result = _restore(target, archive)["result"]
    assert (result["imported"], result["skipped"]) == (1, 1)


def test_rejects_files_that_are_not_archives(tmp_path: Path) -> None:
    client = _client(tmp_path)
    for data, key in [
        (b"not a zip", "backup.notArchive"),
        (_zip({"readme.txt": "hi"}), "backup.noManifest"),
        (_zip({}, {"format": "something-else", "format_version": 1, "songs": []}), "backup.notArchive"),
        (_zip({}, {"format": "fretbook-library", "format_version": 99, "songs": []}), "backup.newerFormat"),
        (_zip({"manifest.json": "{"}), "backup.badManifest"),
    ]:
        response = client.post("/api/library/import", files={"file": ("x.zip", data)})
        assert response.status_code == 400, key
        assert response.json()["detail"]["key"] == key
    assert list(client.app.state.ctx.settings.inbox_dir.glob("*")) == []
    assert client.get("/api/songs").json()["items"] == []


@pytest.mark.parametrize("name", ["../evil.json", "/etc/passwd", "songs/..\\x", "songs/a/../../b", "C:evil"])
def test_rejects_path_traversal(tmp_path: Path, name: str) -> None:
    client = _client(tmp_path)
    archive = _zip({name: "x"}, {"format": "fretbook-library", "format_version": 1, "songs": []})
    response = client.post("/api/library/import", files={"file": ("x.zip", archive)})
    assert response.status_code == 400
    assert response.json()["detail"]["key"] == "backup.unsafePath"


def test_rejects_zip_bombs(tmp_path: Path) -> None:
    client = _client(tmp_path)
    manifest = {"format": "fretbook-library", "format_version": 1, "songs": []}
    # Dense ratio: far more than the compressed size could hold in a real library.
    bomb = _zip({"songs/a/media/x.bin": b"\0" * (64 * 1024 * 1024)}, manifest)
    assert len(bomb) < 1024 * 1024
    response = client.post("/api/library/import", files={"file": ("x.zip", bomb)})
    assert response.status_code == 400
    assert response.json()["detail"]["key"] == "backup.suspicious"

    capped = _client(tmp_path, "capped", max_restore_unpacked_bytes=100)
    response = capped.post("/api/library/import", files={"file": ("x.zip", _zip({"a.txt": "x" * 200}, manifest))})
    assert response.json()["detail"]["key"] == "backup.tooLarge"

    tiny = _client(tmp_path, "tiny", max_restore_bytes=100)
    response = tiny.post("/api/library/import", files={"file": ("x.zip", bomb)})
    assert response.status_code in {400, 413}


def test_a_bad_song_is_reported_and_the_rest_restore(tmp_path: Path) -> None:
    source = _client(tmp_path, "src")
    songs = _seed(source)
    exported = io.BytesIO(source.get("/api/library/export").content)
    broken = io.BytesIO()
    with zipfile.ZipFile(exported) as old, zipfile.ZipFile(broken, "w") as new:
        for item in old.infolist():
            data = old.read(item.filename)
            if item.filename == f"songs/{songs['tab']['id']}/song.json":
                data = json.dumps({"document": {"bars": "nope"}}).encode()
            new.writestr(item.filename, data)
    target = _client(tmp_path, "dst")
    job = _restore(target, broken.getvalue())
    assert job["status"] == "done"
    assert (job["result"]["imported"], job["result"]["failed"]) == (1, 1)
    assert job["result"]["warnings"][0]["key"] == "backup.songFailed"
    assert [song["title"] for song in target.get("/api/songs").json()["items"]] == ["Hello"]


def test_audio_type_comes_from_the_extension_not_the_archive(tmp_path: Path) -> None:
    song_id = "a" * 8
    manifest = {
        "format": "fretbook-library",
        "format_version": 1,
        "songs": [
            {
                "id": song_id,
                "title": "T",
                "content_kind": "chords",
                "source_kind": "manual",
                "file": f"songs/{song_id}/song.cho",
                "media": [
                    {
                        "kind": "audio",
                        "filename": "a.wav",
                        "content_type": "text/html",
                        "path": f"songs/{song_id}/media/a.wav",
                    },
                    {"kind": "audio", "filename": "x.html", "path": f"songs/{song_id}/media/x.html"},
                    {"kind": "evil/../x", "filename": "x.wav", "path": f"songs/{song_id}/media/a.wav"},
                ],
            }
        ],
    }
    archive = _zip(
        {
            f"songs/{song_id}/song.cho": SHEET,
            f"songs/{song_id}/media/a.wav": WAV,
            f"songs/{song_id}/media/x.html": "<b>",
        },
        manifest,
    )
    client = _client(tmp_path)
    job = _restore(client, archive)
    assert job["status"] == "done"
    assert len(job["result"]["warnings"]) == 2
    audio = client.get(f"/api/songs/{song_id}/audio")
    assert audio.headers["content-type"] == "audio/wav"
    media_dir = client.app.state.ctx.settings.media_dir
    assert [path.parent.name for path in media_dir.rglob("*") if path.is_file()] == [song_id]


def test_snapshot_is_a_consistent_copy(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    client = _client(tmp_path)
    songs = _seed(client)
    settings = client.app.state.ctx.settings
    dest = tmp_path / "backups"
    snapshot = take_snapshot(settings, dest)
    assert snapshot.parent == dest and snapshot.name.startswith(PREFIX)
    conn = sqlite3.connect(snapshot / "fretbook.sqlite")
    try:
        assert conn.execute("SELECT count(*) FROM songs").fetchone()[0] == 2
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    finally:
        conn.close()
    copied = [path for path in (snapshot / "media").rglob("*") if path.is_file()]
    assert [path.read_bytes() for path in copied] == [WAV]
    assert songs["tab"]["id"] in str(copied[0])
    assert json.loads((snapshot / "manifest.json").read_text())["format"] == "fretbook-snapshot"
    assert [path.name for path in dest.iterdir()] == [snapshot.name]


def test_snapshot_keep_prunes_only_old_snapshots(tmp_path: Path) -> None:
    client = _client(tmp_path)
    settings = client.app.state.ctx.settings
    dest = tmp_path / "backups"
    dest.mkdir()
    for stamp in ("20200101T000000Z", "20200102T000000Z", "20200103T000000Z"):
        (dest / f"{PREFIX}{stamp}").mkdir()
    (dest / "notes").mkdir()
    (dest / "keep.txt").write_text("x")
    newest = take_snapshot(settings, dest, keep=2)
    names = sorted(path.name for path in dest.iterdir())
    assert names == sorted(["keep.txt", "notes", f"{PREFIX}20200103T000000Z", newest.name])


def test_snapshot_refuses_the_media_folder_and_a_missing_database(tmp_path: Path) -> None:
    from fretbook.backup.snapshot import SnapshotError

    settings = Settings.for_tests(tmp_path / "empty")
    with pytest.raises(SnapshotError):
        take_snapshot(settings, tmp_path / "out")
    client = _client(tmp_path, "real")
    with pytest.raises(SnapshotError):
        take_snapshot(client.app.state.ctx.settings, client.app.state.ctx.settings.media_dir / "inside")


def test_backup_command(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    client = _client(tmp_path)
    _seed(client)
    monkeypatch.setenv("FRETBOOK_DATA_DIR", str(tmp_path / "a"))
    monkeypatch.delenv("FRETBOOK_DATABASE", raising=False)
    dest = tmp_path / "cron"
    with pytest.raises(SystemExit) as done:
        main(["backup", str(dest), "--keep", "1"])
    assert done.value.code == 0
    printed = Path(capsys.readouterr().out.strip())
    assert printed.parent == dest and (printed / "fretbook.sqlite").is_file()
    monkeypatch.setenv("FRETBOOK_DATA_DIR", str(tmp_path / "nothing"))
    with pytest.raises(SystemExit) as failed:
        main(["backup", str(dest)])
    assert failed.value.code == 1
    with pytest.raises(SystemExit):
        main(["backup", str(dest), "--keep", "0"])


def _twins(client: TestClient) -> None:
    for text in ("[G]version 1", "[G]version 2"):
        made = client.post("/api/songs", json={"title": "Twin", "content_kind": "chords", "chordpro": text})
        assert made.status_code in (200, 201), made.text


def test_songs_sharing_a_title_in_one_archive_all_restore(tmp_path: Path) -> None:
    source = _client(tmp_path, "src")
    _twins(source)
    archive = source.get("/api/library/export").content
    target = _client(tmp_path, "dst")
    result = _restore(target, archive)["result"]
    assert (result["imported"], result["skipped"], result["copied"], result["failed"]) == (2, 0, 0, 0)
    items = target.get("/api/songs").json()["items"]
    assert len(items) == 2
    bodies = {target.get(f"/api/songs/{song['id']}").json()["chordpro"] for song in items}
    assert len(bodies) == 2


def test_skip_mode_still_skips_a_preexisting_duplicate_of_same_title_songs(tmp_path: Path) -> None:
    source = _client(tmp_path, "src")
    _twins(source)
    archive = source.get("/api/library/export").content
    target = _client(tmp_path, "dst")
    target.post("/api/songs", json={"title": "Twin", "content_kind": "chords", "chordpro": "[C]mine"})
    result = _restore(target, archive)["result"]
    # Both archived songs match the one that was already there, and neither is added.
    assert (result["imported"], result["skipped"]) == (0, 2)
    assert len(target.get("/api/songs").json()["items"]) == 1
