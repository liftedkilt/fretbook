"""Golden tests: every file in ``tests/fixtures/corpus`` goes through the importer registry.

The outcome (a normalized score document, a chord sheet, or the error key) is compared with a
committed snapshot in ``corpus/golden``. After an intended change, review the diff and regenerate:

    pytest tests/test_import_corpus.py --update-golden

Guitar Pro files have no server importer (alphaTab reads them in the browser; see
``web/src/lib/alphatab/importScore.test.ts``), so here they pin that the server does not claim them.
"""

import json
import shutil
from pathlib import Path

import pytest

from fretbook.export.musicxml import to_musicxml
from fretbook.importers.base import ImportError, ImportRequest, ImportResult, silent_progress
from fretbook.importers.registry import resolve_importer

CORPUS = Path(__file__).parent / "fixtures" / "corpus"
GOLDEN = CORPUS / "golden"
SNAPSHOT_DIRS = {GOLDEN, CORPUS / "golden-web"}
SKIP = {".py", ".md"}
FILES = sorted(
    p for p in CORPUS.rglob("*") if p.is_file() and p.suffix not in SKIP and not SNAPSHOT_DIRS & set(p.parents)
)


def snapshot_name(path: Path) -> str:
    return "__".join(path.relative_to(CORPUS).parts) + ".json"


def run_import(path: Path, tmp_path: Path) -> ImportResult:
    # Copy so the importer sees only a filename and bytes, as an upload does.
    uploads = tmp_path / "uploads"
    uploads.mkdir(exist_ok=True)
    upload = uploads / path.name
    shutil.copyfile(path, upload)
    request = ImportRequest(owner_id="corpus", filename=path.name, file_path=upload)
    return resolve_importer(request).import_score(request, silent_progress)


def normalize(path: Path, tmp_path: Path) -> dict:
    try:
        result = run_import(path, tmp_path)
    except ImportError as exc:
        return {"error": {"key": exc.key, "params": exc.params}}
    return {
        "title": result.title,
        "artist": result.artist,
        "slug": result.slug,
        "source_kind": result.source_kind,
        "source_ref": result.source_ref,
        "content_kind": result.content_kind,
        "document": result.document.model_dump(mode="json") if result.document else None,
        "chordpro": result.chordpro,
        "warnings": [warning.as_dict() for warning in result.warnings],
    }


def test_corpus_is_complete() -> None:
    kinds = {p.parent.name for p in FILES}
    assert {"musicxml", "gp", "chordpro", "ugtext", "asciitab", "midi", "json"} <= kinds
    assert {p.suffix for p in FILES} >= {".musicxml", ".mxl", ".gp3", ".gp4", ".gp5", ".gp", ".cho", ".mid", ".json"}


@pytest.mark.parametrize("path", FILES, ids=lambda p: str(p.relative_to(CORPUS)))
def test_golden(path: Path, tmp_path: Path, request: pytest.FixtureRequest) -> None:
    actual = json.dumps(normalize(path, tmp_path), indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    snapshot = GOLDEN / snapshot_name(path)
    if request.config.getoption("--update-golden"):
        GOLDEN.mkdir(exist_ok=True)
        snapshot.write_text(actual, encoding="utf-8")
        return
    assert snapshot.exists(), f"missing snapshot {snapshot.name}; run pytest --update-golden"
    assert actual == snapshot.read_text(encoding="utf-8")


def test_no_orphan_snapshots() -> None:
    expected = {snapshot_name(p) for p in FILES}
    assert {p.name for p in GOLDEN.glob("*.json")} == expected


def notes_of(result: ImportResult) -> list:
    """Everything a player reads, per track: tuning, bar signature, and every beat's notes."""
    document = result.document
    assert document is not None
    return [
        [(bar.signature, bar.repeat_start, bar.repeat_end) for bar in document.bars],
        [
            (
                track.tuning_midi,
                [
                    [
                        [(beat.position, beat.duration, [(n.string, n.fret) for n in beat.notes]) for beat in v.beats]
                        for v in tb.voices
                    ]
                    for tb in track.bars
                ],
            )
            for track in document.tracks
        ],
    ]


@pytest.mark.parametrize("name", ["riff.partwise.musicxml", "guitar.techniques.musicxml"])
def test_musicxml_round_trip(name: str, tmp_path: Path) -> None:
    first = run_import(CORPUS / "musicxml" / name, tmp_path)
    assert first.document is not None
    exported = tmp_path / "again.musicxml"
    exported.write_bytes(to_musicxml(first.document, title=first.title, artist=first.artist))
    second = run_import(exported, tmp_path)
    assert notes_of(second) == notes_of(first)
    assert (second.title, second.artist) == (first.title, first.artist)


def test_riff_has_the_same_notes_in_musicxml_and_json(tmp_path: Path) -> None:
    xml = run_import(CORPUS / "musicxml" / "riff.partwise.musicxml", tmp_path)
    js = run_import(CORPUS / "json" / "riff.tab.json", tmp_path)
    assert notes_of(js) == notes_of(xml)
