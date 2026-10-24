"""Sheet music (PDF or image) to a tab draft: the Audiveris runner, the pitch-to-fret step and the worker job.

The MusicXML below is written for the tests (a short melody and a held bass note); no engine is needed because
a fake ``Audiveris`` launcher writes it, as the real one writes its export.
"""

import stat
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fretbook.app import create_app
from fretbook.config import Settings
from fretbook.importers import omr
from fretbook.importers.base import ImportError, ImportRequest
from fretbook.importers.registry import resolve_importer
from fretbook.jobs.runner import JobRunner
from fretbook.storage.media import MediaStore
from fretbook.storage.repository import SongRepository

PDF = b"%PDF-1.4 fake"


def _xml(*, clef: str = "<sign>G</sign><line>2</line>", notes: str | None = None, title: str = "Scale tune") -> str:
    if notes is None:
        # E4 (tied across the bar line), G4, then a chord of C4 + E4 and a half rest.
        notes = """
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><tie type="start"/></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
    </measure>
    <measure number="2">
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><tie type="stop"/></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><rest/><duration>1</duration><type>quarter</type></note>"""
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <work><work-title>{title}</work-title></work>
  <part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
        <clef>{clef}</clef></attributes>{notes}
    </measure>
  </part>
</score-partwise>
"""


def _recognizer(text: str):
    def recognize(source: Path, out_dir: Path, progress) -> Path:
        progress("Reading", "import.omrReading")
        target = out_dir / "scan.musicxml"
        target.write_text(text, encoding="utf-8")
        return target

    return recognize


def _import(text: str, *, prefer: str = "", name: str = "Scale Tune.pdf", tmp_path: Path):
    source = tmp_path / name
    source.write_bytes(PDF)
    request = ImportRequest(owner_id="u", filename=name, file_path=source, options={"prefer": prefer})
    return omr.OmrImporter(_recognizer(text)).import_score(request, lambda *_: None)


def _notes(result):
    track = result.document.tracks[0]
    return [[(n.string, n.fret, n.tie) for n in beat.notes] for bar in track.bars for beat in bar.voices[0].beats]


def test_a_recognised_score_becomes_a_fingered_draft(tmp_path: Path) -> None:
    result = _import(_xml(), tmp_path=tmp_path)
    assert result.title == "Scale tune"
    assert result.source_kind == "omr"
    assert result.source_ref["needs_review"] is True
    assert result.content_kind == "tab"
    track = result.document.tracks[0]
    assert track.tuning_midi == [64, 59, 55, 50, 45, 40]
    assert [bar.signature for bar in result.document.bars] == [(4, 4), (4, 4)]
    placed = _notes(result)
    # Written E4 sounds an octave lower on guitar (E3): D string, fret 2.
    first = placed[0][0]
    assert track.tuning_midi[first[0]] + first[1] == 52
    # The tied note keeps the position of the note it continues.
    assert placed[2][0][:2] == first[:2]
    assert placed[2][0][2] is True
    # The chord lands on two different strings; the rest stays an empty beat.
    assert len(placed[3]) == 2 and placed[3][0][0] != placed[3][1][0]
    assert placed[4] == []
    assert [notice.key for notice in result.warnings] == ["omr.review"]


def test_the_octave_follows_the_clef(tmp_path: Path) -> None:
    plain = _import(_xml(), tmp_path=tmp_path)
    eight_vb = _import(
        _xml(clef="<sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change>"), tmp_path=tmp_path
    )
    a, b = _notes(plain)[0][0], _notes(eight_vb)[0][0]
    tuning = plain.document.tracks[0].tuning_midi
    assert tuning[b[0]] + b[1] == tuning[a[0]] + a[1] + 12


def test_bass_is_fingered_on_a_bass(tmp_path: Path) -> None:
    notes = "<note><pitch><step>E</step><octave>2</octave></pitch><duration>4</duration><type>whole</type></note>"
    result = _import(_xml(clef="<sign>F</sign><line>4</line>", notes=notes), prefer="bass", tmp_path=tmp_path)
    track = result.document.tracks[0]
    assert track.instrument == "bass-guitar"
    # F clef E2 written, sounds E1 (28): the open low string.
    assert _notes(result)[0] == [(3, 0, False)]
    assert track.tuning_midi[3] == 28


def test_pitches_the_instrument_cannot_reach_are_reported(tmp_path: Path) -> None:
    notes = "<note><pitch><step>C</step><octave>9</octave></pitch><duration>4</duration><type>whole</type></note>"
    result = _import(_xml(notes=notes), tmp_path=tmp_path)
    assert "midi.shifted" in [notice.key for notice in result.warnings]


def test_nothing_recognised_is_an_error(tmp_path: Path) -> None:
    rests = "<note><rest/><duration>4</duration><type>whole</type></note>"
    with pytest.raises(ImportError) as caught:
        _import(_xml(notes=rests), tmp_path=tmp_path)
    assert caught.value.key == "omr.noMusic"


def test_pdf_and_images_resolve_to_the_omr_importer(tmp_path: Path) -> None:
    for name, content in (("a.pdf", PDF), ("a.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 8)):
        path = tmp_path / name
        path.write_bytes(content)
        request = ImportRequest(owner_id="u", filename=name, file_path=path)
        assert resolve_importer(request).kind == "omr"


def _fake_engine(tmp_path: Path, text: str, *, fail: bool = False) -> Path:
    xml = tmp_path / "engine-output.musicxml"
    xml.write_text(text, encoding="utf-8")
    script = tmp_path / "audiveris"
    # Audiveris' own flags: -batch -export -output <dir> <file>
    body = "exit 3" if fail else f'cp "{xml}" "$4/export.musicxml"'
    script.write_text(f"#!/bin/sh\n{body}\n")
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    return script


def test_the_runner_calls_audiveris_and_reads_its_export(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(omr.ENGINE_ENV, str(_fake_engine(tmp_path, _xml())))
    assert omr.available()
    source = tmp_path / "scan.pdf"
    source.write_bytes(PDF)
    result = omr.OmrImporter().import_score(
        ImportRequest(owner_id="u", filename="scan.pdf", file_path=source), lambda *_: None
    )
    assert result.title == "Scale tune"


def test_a_failing_engine_or_a_missing_one_gives_catalog_keys(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    source = tmp_path / "scan.pdf"
    source.write_bytes(PDF)
    request = ImportRequest(owner_id="u", filename="scan.pdf", file_path=source)
    monkeypatch.setenv(omr.ENGINE_ENV, str(_fake_engine(tmp_path, "", fail=True)))
    with pytest.raises(ImportError) as caught:
        omr.OmrImporter().import_score(request, lambda *_: None)
    assert caught.value.key == "omr.noMusic"
    monkeypatch.setenv(omr.ENGINE_ENV, str(tmp_path / "missing"))
    assert not omr.available()
    with pytest.raises(ImportError) as caught:
        omr.OmrImporter().import_score(request, lambda *_: None)
    assert caught.value.key == "omr.unavailable"


def test_the_worker_job_saves_the_draft(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(omr.ENGINE_ENV, str(_fake_engine(tmp_path, _xml())))
    with TestClient(create_app(Settings.for_tests(tmp_path / "data"))) as client:
        ctx = client.app.state.ctx
        worker = JobRunner(ctx.settings, worker_id="w1")
        from fretbook.jobs.handlers import register_handlers

        register_handlers(worker, SongRepository(ctx.settings), MediaStore(ctx.settings))
        worker.heartbeat(["import.omr"], host="test", pid=1)
        queued = client.post("/api/imports/auto", files={"file": ("Scale Tune.pdf", PDF, "application/pdf")})
        assert queued.status_code == 202
        assert queued.json()["detected"] == "omr"
        # The web process leaves it to the worker.
        assert ctx.jobs.run_once() is False
        assert worker.run_once(["import.omr"]) is True
        job = client.get(f"/api/jobs/{queued.json()['job_id']}").json()
        assert job["status"] == "done", job
        song = client.get(f"/api/songs/{job['result']['song_id']}").json()
        assert song["title"] == "Scale tune"
        assert song["document"]["tracks"][0]["bars"][0]["voices"][0]["beats"][0]["notes"]
        assert any(w["key"] == "omr.review" for w in job["result"]["warnings"]), job["result"]
