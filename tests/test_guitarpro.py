"""Guitar Pro on the server: Node + alphaTab, compared with the browser's snapshots.

Needs the converter: ``cd web && npm run build:gp-cli``. Locally the tests that run it are skipped
without it; in CI (``CI`` is set) a missing converter fails them.
"""

import json
import subprocess
from pathlib import Path

import pytest
from tests.test_import_corpus import require_converter
from tests.test_universal_import import _auto, _client, _done, _wait

from fretbook.importers import guitarpro
from fretbook.importers.base import ImportError, ImportRequest, silent_progress
from fretbook.importers.guitarpro import GuitarProImporter
from fretbook.importers.registry import resolve_importer

CORPUS = Path(__file__).parent / "fixtures" / "corpus"
FILES = ["riff.gp3", "riff.gp4", "riff.gp5", "riff.gp"]


def _import(path: Path, **options):
    request = ImportRequest(owner_id="t", filename=path.name, file_path=path, options=options)
    return resolve_importer(request).import_score(request, silent_progress)


def _web(name: str) -> dict:
    return json.loads((CORPUS / "golden-web" / f"gp__{name}.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("name", FILES)
def test_server_import_matches_the_browser(name: str) -> None:
    require_converter()
    web = _web(name)
    result = _import(CORPUS / "gp" / name, prefer="bass")
    assert result.document is not None
    assert result.document.model_dump(mode="json") == web["document"]
    assert (result.title, result.artist) == (web["title"], web["artist"])
    assert result.source_kind == "guitarpro"
    assert result.source_ref == {"filename": name}


def test_importer_claims_guitar_pro_names_only() -> None:
    importer = GuitarProImporter()
    assert importer.can_handle(ImportRequest(owner_id="t", filename="Song.GP5"))
    assert importer.can_handle(ImportRequest(owner_id="t", filename="song.gpx"))
    assert not importer.can_handle(ImportRequest(owner_id="t", filename="song.xml"))
    assert not importer.can_handle(ImportRequest(owner_id="t"))


def test_unreadable_file_is_an_import_error(tmp_path: Path) -> None:
    require_converter()
    bad = tmp_path / "bad.gp5"
    bad.write_bytes(b"\x18FICHIER GUITAR PRO v5.00" + b"\x00" * 20)
    with pytest.raises(ImportError) as caught:
        _import(bad)
    assert caught.value.key == "import.guitarProUnreadable"


def test_missing_converter_is_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FRETBOOK_NODE", "no-such-node-binary")
    assert not guitarpro.available()
    with pytest.raises(ImportError) as caught:
        _import(CORPUS / "gp" / "riff.gp5")
    assert caught.value.key == "import.guitarProUnavailable"
    with pytest.raises(ImportError) as no_file:
        GuitarProImporter().import_score(ImportRequest(owner_id="t"), silent_progress)
    assert no_file.value.key == "import.needsFile"


def _fake_converter(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    converter = tmp_path / "converter.mjs"
    converter.write_text("")
    monkeypatch.setenv("FRETBOOK_GP_CONVERTER", str(converter))
    monkeypatch.setattr(guitarpro, "node_path", lambda: "node")


def test_converter_failures_become_import_errors(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_converter(tmp_path, monkeypatch)
    source = CORPUS / "gp" / "riff.gp5"

    def key_for(output: bytes | Exception) -> str:
        def fake(*_args, **_kwargs):
            if isinstance(output, Exception):
                raise output
            return subprocess.CompletedProcess([], 0, stdout=output)

        monkeypatch.setattr(guitarpro.subprocess, "run", fake)
        with pytest.raises(ImportError) as caught:
            _import(source)
        return caught.value.key

    assert key_for(subprocess.TimeoutExpired("node", 1)) == "import.guitarProUnreadable"
    assert key_for(OSError("exec failed")) == "import.guitarProUnavailable"
    assert key_for(b"not json") == "import.guitarProUnreadable"
    assert key_for(b"[1]") == "import.guitarProUnreadable"
    assert key_for(b'{"error": {"key": "import.guitarProNoFretted", "message": "none"}}') == "import.guitarProNoFretted"
    assert key_for(b'{"error": {"key": "something.else", "message": "x"}}') == "import.guitarProUnreadable"
    assert key_for(b'{"title": "T", "document": {"bars": "nope"}}') == "import.guitarProUnreadable"
    monkeypatch.setattr(guitarpro, "MAX_OUTPUT_BYTES", 3)
    assert key_for(b'{"title": "T"}') == "import.guitarProUnreadable"


def test_title_falls_back_to_the_file_name(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_converter(tmp_path, monkeypatch)
    output = json.dumps({"title": "", "artist": "", "document": _web("riff.gp5")["document"]}).encode()
    monkeypatch.setattr(
        guitarpro.subprocess, "run", lambda *_a, **_k: subprocess.CompletedProcess([], 0, stdout=output)
    )
    result = _import(CORPUS / "gp" / "riff.gp5")
    assert (result.title, result.slug) == ("riff", "riff")


def test_upload_through_the_api_saves_a_song(tmp_path: Path) -> None:
    require_converter()
    web = _web("riff.gp5")
    data = (CORPUS / "gp" / "riff.gp5").read_bytes()
    with _client(tmp_path) as client:
        for route in ("/api/imports/file", "/api/imports/auto"):
            response = client.post(route, files={"file": ("riff.gp5", data, "application/octet-stream")})
            assert response.status_code == 202, response.text
            job = _wait(client, response.json()["job_id"])
            assert job["status"] == "done", job
            song = client.get(f"/api/songs/{job['result']['song_id']}").json()
            assert song["title"] == "Corpus Riff"
            assert song["document"]["tracks"][0]["tuning_midi"] == web["document"]["tracks"][0]["tuning_midi"]
        assert _done(client, _auto(client, files={"file": ("riff.gp5", data)}))["source_kind"] == "guitarpro"


def test_upload_without_the_converter_fails_the_job(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FRETBOOK_NODE", "no-such-node-binary")
    data = (CORPUS / "gp" / "riff.gp5").read_bytes()
    with _client(tmp_path) as client:
        response = client.post("/api/imports/file", files={"file": ("riff.gp5", data)})
        job = _wait(client, response.json()["job_id"])
        assert job["status"] == "error"
        assert job["error_key"] == "import.guitarProUnavailable"
