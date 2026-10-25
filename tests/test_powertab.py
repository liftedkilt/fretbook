"""Tests for the Power Tab (.ptb) importer."""

from __future__ import annotations

from pathlib import Path

import pytest

from fretbook.importers.base import ImportError, ImportRequest, silent_progress
from fretbook.importers.powertab import PowerTabImporter, is_powertab


def test_is_powertab() -> None:
    assert is_powertab(b"ptab\x04\x00")
    assert not is_powertab(b"MThd\x00\x00")
    assert not is_powertab(b"ptab\x05\x00")


def test_powertab_can_handle() -> None:
    importer = PowerTabImporter()
    assert importer.can_handle(ImportRequest(owner_id="u", filename="song.ptb"))
    assert not importer.can_handle(ImportRequest(owner_id="u", filename="song.gp5"))


def test_powertab_import_needs_file() -> None:
    importer = PowerTabImporter()
    with pytest.raises(ImportError) as exc:
        importer.import_score(ImportRequest(owner_id="u", filename="x.ptb"), silent_progress)
    assert exc.value.key == "import.needsFile"


def test_powertab_invalid_file(tmp_path: Path) -> None:
    p = tmp_path / "bad.ptb"
    p.write_bytes(b"not a valid ptb file at all")
    req = ImportRequest(owner_id="u", filename="bad.ptb", file_path=p)
    with pytest.raises(ImportError) as exc:
        PowerTabImporter().import_score(req, silent_progress)
    assert exc.value.key == "powertab.parse"


def test_powertab_corpus_fixture_round_trip() -> None:
    path = Path("tests/fixtures/corpus/powertab/riff.ptb")
    req = ImportRequest(owner_id="u", filename=path.name, file_path=path)
    res = PowerTabImporter().import_score(req, silent_progress)
    assert res.title == "Corpus Riff"
    assert res.artist == "Fretbook Fixtures"
    assert res.document.bpm == 100.0
    assert len(res.document.tracks) == 1
    assert res.document.tracks[0].tuning_midi == [43, 38, 33, 28]
    assert len(res.document.bars) == 2


def test_powertab_helpers_and_edge_cases(tmp_path: Path) -> None:
    from fretbook.importers.powertab import (
        _infer_instrument,
        _mark_preferred,
        _merge_bars,
        _PTReader,
        _read_song_info,
    )
    from fretbook.score.model import Bar, Track, TrackBar

    # _infer_instrument
    assert _infer_instrument([64, 59, 55, 50, 45, 40], "Guitar", 25) == "guitar"
    assert _infer_instrument([43, 38, 33, 28], "Bass", 33) == "bass-guitar"

    # _mark_preferred
    tb = TrackBar(voices=[])
    t1 = Track(id="t1", name="Guitar", instrument="guitar", tuning_midi=[64, 59, 55, 50, 45, 40], bars=[tb])
    t2 = Track(id="t2", name="Bass", instrument="bass-guitar", tuning_midi=[43, 38, 33, 28], bars=[tb])
    _mark_preferred([t1, t2], prefer="guitar")
    assert t1.preferred is True
    _mark_preferred([t1, t2], prefer="bass")
    assert t2.preferred is True
    _mark_preferred([t1], prefer="unknown")
    assert t1.preferred is True

    # _merge_bars
    assert len(_merge_bars([])) == 1
    b1 = [Bar(tempo=120.0, section="Verse", repeat_start=True)]
    b2 = [Bar(repeat_end=2, alternate_endings=[1])]
    merged = _merge_bars([b1, b2])
    assert merged[0].tempo == 120.0
    assert merged[0].section == "Verse"
    assert merged[0].repeat_start is True
    assert merged[0].repeat_end == 2
    assert merged[0].alternate_endings == [1]

    # Classification 0 with release_type 1 and author fallback
    buf0 = (
        b"\x00"  # classification 0
        + b"\x00"  # flags
        + b"\x05Title"
        + b"\x00"  # empty artist
        + b"\x01"  # release_type 1
        + b"\x00"  # string
        + b"\x00"  # u8
        + b"\x00"  # u8 == 0 (has author)
        + b"\x06Author"
        + b"\x00"  # lyricist
        + (b"\x00" * 7)  # 7 strings
    )
    r0 = _PTReader(buf0)
    t0, a0 = _read_song_info(r0, "song.ptb")
    assert t0 == "Title"
    assert a0 == "Author"

    # Classification 0 with release_type 0
    buf_rt0 = (
        b"\x00"  # classification 0
        + b"\x00"  # flags
        + b"\x05Album"
        + b"\x06Artist"
        + b"\x00"  # release_type 0
        + b"\x00"  # u8
        + b"\x00"  # string
        + b"\x00\x00"  # u16
        + b"\x00"  # u8
        + b"\x01"  # u8 != 0 (no author)
        + (b"\x00" * 7)
    )
    t_rt0, a_rt0 = _read_song_info(_PTReader(buf_rt0), "song.ptb")
    assert t_rt0 == "Album" and a_rt0 == "Artist"

    # Classification 0 with release_type 2
    buf_rt2 = (
        b"\x00"  # classification 0
        + b"\x00"  # flags
        + b"\x05Audio"
        + b"\x06Artist"
        + b"\x02"  # release_type 2
        + b"\x00"  # string
        + b"\x00\x00\x00\x00\x00\x00"  # 3 u16s
        + b"\x01"
        + (b"\x00" * 7)
    )
    t_rt2, a_rt2 = _read_song_info(_PTReader(buf_rt2), "song.ptb")
    assert t_rt2 == "Audio" and a_rt2 == "Artist"

    # Classification 1 (lesson / exercise)
    buf1 = (
        b"\x01"  # classification 1
        + b"\x06Lesson"
        + b"\x00"  # artist empty
        + b"\x00\x00\x00"  # u16, u8
        + b"\x06Author"
        + b"\x00\x00"  # 2 strings
    )
    r1 = _PTReader(buf1)
    t1, a1 = _read_song_info(r1, "lesson.ptb")
    assert t1 == "Lesson"
    assert a1 == "Author"

    # Unsupported classification
    with pytest.raises(ImportError) as exc:
        _read_song_info(_PTReader(b"\x09"), "test.ptb")
    assert exc.value.key == "powertab.parse"


def test_powertab_read_note_effects() -> None:
    import struct

    from fretbook.importers.powertab import _PTReader, _read_note

    # Note with slide (100, d1=1 -> shift), bend (101, d1=4 -> 2.0 semitones), harmonic tap (102)
    syms = [
        100 | (1 << 8),  # slide shift
        101 | (4 << 8),  # bend 2.0
        102,  # tap
    ]
    # pos_byte: string 1, fret 17: (1 << 5) | 17
    pos_byte = (1 << 5) | 17
    # simple flags: tie (0x01) | dead (0x02) | hammer (0x08) | ghost (0x80)
    simple = 0x01 | 0x02 | 0x08 | 0x80
    buf = bytes([pos_byte]) + struct.pack("<H", simple) + bytes([len(syms)])
    for s in syms:
        buf += struct.pack("<I", s)

    note = _read_note(_PTReader(buf))
    assert note.string == 1
    assert note.fret == 17
    assert note.tie is True
    assert note.dead is True
    assert note.ghost is True
    assert note.hammer is True
    assert note.slide == "shift"
    assert note.bend == 2.0
    assert note.harmonic == "tap"

    # Note with artificial harmonic (104) and legato slide (100, d1=2)
    syms2 = [100 | (2 << 8), 104]
    buf2 = bytes([0]) + struct.pack("<H", 0) + bytes([len(syms2)])
    for s in syms2:
        buf2 += struct.pack("<I", s)
    note2 = _read_note(_PTReader(buf2))
    assert note2.slide == "legato"
    assert note2.harmonic == "artificial"
