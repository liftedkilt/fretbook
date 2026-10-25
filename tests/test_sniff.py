import io
import zipfile
from pathlib import Path

import pytest

from fretbook.importers import sniff

CORPUS = Path(__file__).parent / "fixtures" / "corpus"


def _zip(*names: str) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name in names:
            archive.writestr(name, "x")
    return buffer.getvalue()


@pytest.mark.parametrize(
    ("path", "kind"),
    [
        ("gp/riff.gp3", sniff.GUITAR_PRO),
        ("gp/riff.gp4", sniff.GUITAR_PRO),
        ("gp/riff.gp5", sniff.GUITAR_PRO),
        ("gp/riff.gp", sniff.GUITAR_PRO),
        ("midi/riff.mid", sniff.MIDI),
        ("musicxml/riff.mxl", sniff.MXL),
        ("musicxml/riff.partwise.musicxml", sniff.MUSICXML),
        ("musicxml/riff.timewise.musicxml", sniff.MUSICXML),
        ("chordpro/basic.cho", sniff.CHORDPRO),
        ("asciitab/standard-guitar.tab", sniff.ASCII_TAB),
        ("musescore/riff.mscx", sniff.MUSESCORE),
        ("musescore/riff.mscz", sniff.MUSESCORE),
        ("abc/riff.abc", sniff.ABC),
        ("tuxguitar/riff.tg", sniff.TUXGUITAR),
        ("powertab/riff.ptb", sniff.POWER_TAB),
    ],
)
def test_corpus_files_are_recognised_by_content(path: str, kind: str) -> None:
    file = CORPUS / path
    # A misleading name must not matter.
    assert sniff.sniff_path(file, "download.bin").kind == kind
    assert sniff.sniff_path(file, "song.txt").kind == kind


def test_extension_does_not_make_the_wrong_thing_right() -> None:
    assert sniff.sniff_bytes(b"just some words", "tab.gp5").kind is None
    assert sniff.sniff_bytes(b"<html><body>hi</body></html>", "score.musicxml").kind is None


def test_guitar_pro_container_magic() -> None:
    assert sniff.sniff_bytes(b"BCFZ" + b"\x00" * 20, "x").kind == sniff.GUITAR_PRO
    assert sniff.sniff_bytes(b"BCFS" + b"\x00" * 20, "x").kind == sniff.GUITAR_PRO
    assert sniff.sniff_bytes(_zip("Content/score.gpif", "Content/BinaryStylesheet")).kind == sniff.GUITAR_PRO


def test_zip_kinds_are_told_apart_by_member_names() -> None:
    assert sniff.sniff_bytes(_zip("META-INF/container.xml", "score.xml")).kind == sniff.MXL
    assert sniff.sniff_bytes(_zip("META-INF/container.xml", "score.mscx")).kind == sniff.MUSESCORE
    assert sniff.sniff_bytes(_zip("content.xml", "version.txt")).kind == sniff.TUXGUITAR
    assert sniff.sniff_bytes(_zip("manifest.json", "songs/a/song.json")).kind == sniff.FRETBOOK_ARCHIVE
    assert sniff.sniff_bytes(_zip("readme.txt")).kind is None
    assert sniff.sniff_bytes(b"PK\x03\x04 not really a zip").kind is None


def test_binary_media() -> None:
    assert sniff.sniff_bytes(b"%PDF-1.7\n...").kind == sniff.PDF
    assert sniff.sniff_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 8).kind == sniff.IMAGE
    assert sniff.sniff_bytes(b"\xff\xd8\xff\xe0" + b"\x00" * 8).kind == sniff.IMAGE
    assert sniff.sniff_bytes(b"RIFF\x00\x00\x00\x00WEBPVP8 ").kind == sniff.IMAGE


@pytest.mark.parametrize(
    ("head", "suffix"),
    [
        (b"ID3\x04\x00" + b"\x00" * 16, ".mp3"),
        (b"\xff\xfb\x90\x00" + b"\x00" * 16, ".mp3"),
        (b"RIFF\x24\x00\x00\x00WAVEfmt ", ".wav"),
        (b"OggS\x00\x02" + b"\x00" * 16, ".ogg"),
        (b"fLaC\x00\x00\x00\x22", ".flac"),
        (b"\x00\x00\x00\x20ftypM4A \x00\x00", ".m4a"),
        (b"\x1a\x45\xdf\xa3\x01\x00", ".webm"),
    ],
)
def test_audio_content_picks_the_suffix(head: bytes, suffix: str) -> None:
    found = sniff.sniff_bytes(head, "whatever.dat")
    assert (found.kind, found.audio_suffix) == (sniff.AUDIO, suffix)


def test_text_kinds() -> None:
    assert sniff.sniff_text('{"title": "x", "document": {}}') == sniff.FRETBOOK_JSON
    assert sniff.sniff_text('{"bars": [], "tracks": []}') == sniff.FRETBOOK_JSON
    assert sniff.sniff_text('{"unrelated": 1}') is None
    assert sniff.sniff_text("{title: Hello}\n[G]Hello [C]there\n") == sniff.CHORDPRO
    assert sniff.sniff_text("G        C\nHello my friend\n") == sniff.CHORDS_OVER_LYRICS
    assert sniff.sniff_text("e|-0---3---|\nB|---------|\nG|---------|\nD|---------|\n") == sniff.ASCII_TAB
    assert sniff.sniff_text('<museScore version="3.02"><Score/></museScore>') == sniff.MUSESCORE
    assert sniff.sniff_text("X:1\nT:Test\nM:4/4\nK:C\nC D E F|\n") == sniff.ABC


@pytest.mark.parametrize(
    "text",
    [
        "",
        "   \n",
        "Hello world, this is a plain sentence about nothing.",
        "Shopping list\n- eggs\n- milk\n",
        "A man a plan",
    ],
)
def test_prose_is_not_a_chord_sheet(text: str) -> None:
    assert sniff.sniff_text(text) is None


def test_non_text_binary_is_unknown() -> None:
    assert sniff.sniff_bytes(b"\x00\x01\x02\x03\x04" * 50, "x.bin").kind is None
