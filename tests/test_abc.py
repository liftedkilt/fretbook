"""Tests for the ABC music notation (.abc) importer."""

from __future__ import annotations

from pathlib import Path

import pytest

from fretbook.importers.abc import AbcImporter, looks_like_abc
from fretbook.importers.base import ImportError, ImportRequest, silent_progress


def _run_abc(text: str, tmp_path: Path, filename: str = "test.abc", prefer: str = "bass"):
    p = tmp_path / filename
    p.write_text(text, encoding="utf-8")
    req = ImportRequest(owner_id="u", filename=filename, file_path=p, options={"prefer": prefer})
    return AbcImporter().import_score(req, silent_progress)


def test_looks_like_abc() -> None:
    assert looks_like_abc("X:1\nT:Hello\nM:4/4\nK:C\nC D E F|\n")
    assert looks_like_abc("% comment\nT:Only Title\nK:G\nG A B c|\n")
    assert not looks_like_abc("Just some lyrics and words\nNothing musical")
    assert not looks_like_abc("{title: A Chord Sheet}\n[G]Hello [C]World\n")
    assert not looks_like_abc("K:invalid")
    assert not looks_like_abc("K:C\nC D E F\n")
    assert not looks_like_abc("Z:1\nK:C\n")
    assert looks_like_abc("X:1\nK:C\nC D\nW:lyrics\nE F\nG A\nB c\n")
    assert not looks_like_abc("X:1\nK:C\n")


def test_abc_multitune_and_body_fields(tmp_path: Path) -> None:
    abc = """X:1
T:Tune 1
C:Artist 1
M:4/4
L:1/4
Q:100
V:1 name="Lead"
V:2 name="Bass" clef=bass octave=-1
K:C bass
V:1
c d e f |
M:3/4
L:1/8
Q:120
P:Bridge
K:G
g a b c' |
V:2
C, D, E, F, |
G, A, B, C |

X:2
T:Tune 2
A:Author 2
M:4/4
L:1/4
K:C
C D E F |
"""
    res = _run_abc(abc, tmp_path)
    assert res.title == "Tune 1"
    assert len(res.document.tracks) == 2
    assert res.document.tracks[0].name == "Lead"
    assert res.document.tracks[1].name == "Bass"


def test_abc_can_handle(tmp_path: Path) -> None:
    importer = AbcImporter()
    assert importer.can_handle(ImportRequest(owner_id="u", filename="test.abc"))
    assert not importer.can_handle(ImportRequest(owner_id="u", filename="test.gp5"))


def test_abc_needs_file() -> None:
    importer = AbcImporter()
    with pytest.raises(ImportError) as exc:
        importer.import_score(ImportRequest(owner_id="u", filename="test.abc"), silent_progress)
    assert exc.value.key == "import.needsFile"


def test_abc_empty_input(tmp_path: Path) -> None:
    with pytest.raises(ImportError) as exc:
        _run_abc("   \n\n  ", tmp_path)
    assert exc.value.key in ("abc.empty", "abc.noNotes")


def test_abc_no_playable_notes(tmp_path: Path) -> None:
    with pytest.raises(ImportError) as exc:
        _run_abc("X:1\nT:Empty\nK:C\n| | |\n", tmp_path)
    assert exc.value.key in ("abc.noNotes", "abc.parse")


def test_abc_key_signatures_and_accidentals(tmp_path: Path) -> None:
    # G major has F#, D minor has Bb
    abc = """X:1
T:Keys
M:4/4
L:1/4
K:G
G A B c | d e f g |
K:Dm
D E F G | A B c d |
"""
    res = _run_abc(abc, tmp_path)
    assert res.title == "Keys"
    assert len(res.document.bars) >= 4


def test_abc_chords_tuplets_broken_rhythms_and_repeats(tmp_path: Path) -> None:
    abc = """X:1
T:Techniques
C:Composer
M:4/4
L:1/8
Q:1/4=120
K:C
|: [CEG]2 (3DEF A>B c-c :| [1 d4 :|[2 e4 ||
"""
    res = _run_abc(abc, tmp_path)
    assert res.title == "Techniques"
    assert res.artist == "Composer"
    assert res.document.bpm == 120.0
    bars = res.document.bars
    assert bars[0].repeat_start is True
    assert bars[0].repeat_end == 2
    assert bars[1].alternate_endings == [1]
    assert bars[2].alternate_endings == [2]

    # Verify tied note
    beats = res.document.tracks[0].bars[0].voices[0].beats
    # Tied beat should have tie=True
    tied_note = [b for b in beats if any(n.tie for n in b.notes)]
    assert len(tied_note) > 0


def test_abc_multi_voice(tmp_path: Path) -> None:
    abc = """X:1
T:Polyphony
M:4/4
L:1/4
K:C
V:1 name="Guitar"
c d e f | g4 |
V:2 name="Bass" clef=bass
C, D, E, F, | G,4 |
"""
    res = _run_abc(abc, tmp_path)
    assert len(res.document.tracks) == 2
    assert res.document.tracks[0].name == "Guitar"
    assert res.document.tracks[1].name == "Bass"


def test_abc_helpers_coverage() -> None:
    from fretbook.importers.abc import (
        _default_unit_ticks,
        _key_accidentals,
        _parse_duration_multiplier,
        _parse_meter,
        _parse_tempo,
        _parse_unit_ticks,
        _parse_voice_header,
    )

    # Durations
    assert _parse_duration_multiplier("") == (1, 1)
    assert _parse_duration_multiplier("4") == (4, 1)
    assert _parse_duration_multiplier("/") == (1, 2)
    assert _parse_duration_multiplier("//") == (1, 4)
    assert _parse_duration_multiplier("/8") == (1, 8)
    assert _parse_duration_multiplier("3/") == (3, 2)
    assert _parse_duration_multiplier("3//") == (3, 4)
    assert _parse_duration_multiplier("3/8") == (3, 8)

    # Meters
    assert _parse_meter("C") == (4, 4)
    assert _parse_meter("C|") == (2, 2)
    assert _parse_meter("none") == (4, 4)
    assert _parse_meter("3/4") == (3, 4)
    assert _parse_meter("(2+3)/8") == (5, 8)
    assert _parse_meter("invalid") == (4, 4)

    # Default unit ticks
    assert _default_unit_ticks((3, 4)) == 480
    assert _default_unit_ticks((2, 4)) == 240

    # Tempos
    assert _parse_tempo("1/4=120") == 120.0
    assert _parse_tempo("3/8=90") == 135.0
    assert _parse_tempo('"Allegro" 130') == 130.0
    assert _parse_tempo("140") == 140.0
    assert _parse_tempo("0") is None

    # Unit ticks
    assert _parse_unit_ticks("1/8", 480) == 480
    assert _parse_unit_ticks("1/4", 480) == 960
    assert _parse_unit_ticks("invalid", 480) == 480

    # Keys
    acc_c, oct_c, bass_c = _key_accidentals("C")
    assert all(v == 0 for v in acc_c.values()) and oct_c == 0 and not bass_c

    acc_dor, _, _ = _key_accidentals("Ddor")
    assert all(v == 0 for v in acc_dor.values())

    acc_hp, _, _ = _key_accidentals("HP")
    assert acc_hp["F"] == 1 and acc_hp["C"] == 1

    acc_exp, oct_exp, bass_exp = _key_accidentals("G bass octave=1 ^c =f")
    assert bass_exp is True
    assert oct_exp == 1
    assert acc_exp["C"] == 1

    acc_none, _, _ = _key_accidentals("none")
    assert all(v == 0 for v in acc_none.values())

    # Voice header parsing
    vid, vname, is_bass, oct_shift = _parse_voice_header('1 name="Bass Guitar" subname="B" clef=bass octave=-1')
    assert vid == "1"
    assert vname == "Bass Guitar"
    assert is_bass is True
    assert oct_shift == -1


def test_abc_decorations_grace_rests_and_inlines(tmp_path: Path) -> None:
    abc = """X:1
T:Kitchen Sink
C:Composer
N:Notes
R:Reel
B:Book
S:Source
D:Disco
O:Origin
A:Area
H:History
M:4/4
L:1/8
Q:120
K:G bass
w: lyrics line ignored
W: end lyrics
s: staff words
[P:Intro] !segno! !staccato! {/G,,}A,,>B,, [M:3/4] [L:1/4] [Q:140] [K:C clef=bass] z2 Z1 X2 |
!coda! !fine! !vibrato! !slide! (A,, B,,) (2C,,D,, (4E,,F,,G,,A,, :|
"""
    res = _run_abc(abc, tmp_path)
    assert res.title == "Kitchen Sink"
    assert len(res.document.bars) >= 2
