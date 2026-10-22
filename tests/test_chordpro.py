from pathlib import Path

from fretbook.chords.chordpro import from_chords_over_lyrics, is_chord_line, looks_like_chordpro, metadata, normalize
from fretbook.importers.base import ImportRequest, silent_progress
from fretbook.importers.chordpro import ChordProImporter

SHEET = """[Verse 1]
Em7        G
Today is gonna be the day
         Dsus4              A7sus4
That they're gonna throw it back to you

[Chorus]
C    D    Em  x2
"""


def test_chord_lines() -> None:
    assert is_chord_line("Em7        G")
    assert is_chord_line("  C#m7b5   F/A  Bbmaj7 | x2")
    assert not is_chord_line("Today is gonna be the day")
    assert not is_chord_line("A day in the life")
    assert not is_chord_line("")


def test_chords_over_lyrics_become_inline_chords() -> None:
    text = from_chords_over_lyrics(SHEET, title="Wonderwall", artist="Oasis")
    lines = text.splitlines()
    assert lines[0] == "{title: Wonderwall}"
    assert lines[1] == "{artist: Oasis}"
    assert lines[2] == "{comment: Verse 1}"
    # Each chord lands on the lyric character under its column.
    assert lines[3] == "[Em7]Today is go[G]nna be the day"
    assert lines[4] == "That they[Dsus4]'re gonna throw it [A7sus4]back to you"
    assert "{comment: Chorus}" in lines
    assert "[C] [D] [Em] x2" in lines


def test_chordpro_is_kept_as_is() -> None:
    source = "{title: Song}\n[G]Hello [C]world\n"
    assert looks_like_chordpro(source)
    assert normalize(source) == source
    assert not looks_like_chordpro(SHEET)
    assert metadata("{t: Song}\n{st: Someone}\n{key: G}\n") == {
        "title": "Song",
        "subtitle": "Someone",
        "key": "G",
        "artist": "Someone",
    }


def test_chord_sheet_file_import(tmp_path: Path) -> None:
    path = tmp_path / "wonderwall.txt"
    path.write_text(SHEET, encoding="utf-8")
    result = ChordProImporter().import_score(
        ImportRequest(owner_id="local", filename=path.name, file_path=path), silent_progress
    )
    assert result.content_kind == "chords"
    assert result.title == "wonderwall"
    assert result.chordpro is not None and "[Em7]Today" in result.chordpro
