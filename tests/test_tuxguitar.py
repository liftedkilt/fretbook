"""Tests for the TuxGuitar (.tg) importer."""

from __future__ import annotations

import zipfile
from pathlib import Path

import pytest

from fretbook.importers.base import ImportError, ImportRequest, silent_progress
from fretbook.importers.tuxguitar import TuxGuitarImporter, is_tuxguitar_v1


def test_is_tuxguitar_v1() -> None:
    prefix = "TuxGuitar File Format - 1.5".encode("utf-16-be")
    head = bytes([len("TuxGuitar File Format - 1.5")]) + prefix
    assert is_tuxguitar_v1(head)
    assert not is_tuxguitar_v1(b"random bytes not tg")


def test_tuxguitar_can_handle() -> None:
    importer = TuxGuitarImporter()
    assert importer.can_handle(ImportRequest(owner_id="u", filename="song.tg"))
    assert not importer.can_handle(ImportRequest(owner_id="u", filename="song.gp5"))


def test_tuxguitar_import_needs_file() -> None:
    importer = TuxGuitarImporter()
    with pytest.raises(ImportError) as exc:
        importer.import_score(ImportRequest(owner_id="u", filename="x.tg"), silent_progress)
    assert exc.value.key == "import.needsFile"


def test_tuxguitar_corpus_fixture_round_trip() -> None:
    path = Path("tests/fixtures/corpus/tuxguitar/riff.tg")
    req = ImportRequest(owner_id="u", filename=path.name, file_path=path)
    res = TuxGuitarImporter().import_score(req, silent_progress)
    assert res.title == "Corpus Riff"
    assert res.artist == "Fretbook Fixtures"
    assert res.document.bpm == 100.0
    assert len(res.document.tracks) == 1
    assert res.document.tracks[0].tuning_midi == [43, 38, 33, 28]


def test_tuxguitar_zip_missing_content(tmp_path: Path) -> None:
    p = tmp_path / "bad.tg"
    with zipfile.ZipFile(p, "w") as zf:
        zf.writestr("version.txt", "2.0")
    req = ImportRequest(owner_id="u", filename="bad.tg", file_path=p)
    with pytest.raises(ImportError) as exc:
        TuxGuitarImporter().import_score(req, silent_progress)
    assert exc.value.key == "tuxguitar.parse"


def test_tuxguitar_effects_and_structures(tmp_path: Path) -> None:
    xml = b"""<?xml version="1.0" encoding="UTF-8"?>
<TuxGuitarFile version="2.0">
  <TGSong>
    <name>Effects Test</name>
    <artist>Artist</artist>
    <TGChannel>
      <channelId>1</channelId>
      <name>Guitar</name>
      <program>25</program>
    </TGChannel>
    <TGMeasureHeader>
      <tempo>120</tempo>
      <repeat open="true"/>
      <marker>Intro</marker>
    </TGMeasureHeader>
    <TGMeasureHeader>
      <repeat close="1" alternative="1"/>
    </TGMeasureHeader>
    <TGTrack>
      <name>Guitar</name>
      <channelId>1</channelId>
      <strings>
        <TGString>64</TGString><TGString>59</TGString><TGString>55</TGString>
        <TGString>50</TGString><TGString>45</TGString><TGString>40</TGString>
      </strings>
      <TGMeasure>
        <TGBeat>
          <TGVoice empty="false">
            <duration value="4"/>
            <TGNote value="5" string="1">
              <effect>
                <vibrato/>
                <deadNote/>
                <hammer/>
                <slide/>
                <palmMute/>
                <staccato/>
                <letRing/>
                <harmonic type="1"/>
                <bend>
                  <point value="2"/>
                </bend>
              </effect>
            </TGNote>
          </TGVoice>
        </TGBeat>
      </TGMeasure>
      <TGMeasure>
        <TGBeat>
          <TGVoice empty="false">
            <duration value="4"/>
            <TGNote value="7" string="1"/>
          </TGVoice>
        </TGBeat>
      </TGMeasure>
    </TGTrack>
  </TGSong>
</TuxGuitarFile>
"""
    p = tmp_path / "fx.tg"
    with zipfile.ZipFile(p, "w") as zf:
        zf.writestr("content.xml", xml)
    req = ImportRequest(owner_id="u", filename="fx.tg", file_path=p)
    res = TuxGuitarImporter().import_score(req, silent_progress)
    assert res.title == "Effects Test"
    bars = res.document.bars
    assert bars[0].repeat_start is True
    assert bars[0].section == "Intro"
    assert bars[1].repeat_end == 2
    assert bars[1].alternate_endings == [1]

    note = res.document.tracks[0].bars[0].voices[0].beats[0].notes[0]
    assert note.fret == 5
    assert note.string == 0
    assert note.vibrato is True
    assert note.dead is True
    assert note.hammer is True
    assert note.slide == "shift"
    assert note.palm_mute is True
    assert note.staccato is True
    assert note.let_ring is True
    assert note.harmonic == "natural"
    assert note.bend == 1.0


def test_tuxguitar_binary_format(tmp_path: Path) -> None:
    import struct

    def _s(text: str) -> bytes:
        return bytes([len(text)]) + text.encode("utf-16-be")

    def _is(text: str) -> bytes:
        return struct.pack(">i", len(text)) + text.encode("utf-16-be")

    # 1. Test TG 1.2 binary
    buf = bytearray()
    buf += _s("TuxGuitar File Format - 1.2")
    buf += _s("Binary Song")
    buf += _s("Binary Artist")
    buf += _s("Binary Album")
    buf += _s("Binary Author")
    buf += struct.pack(">h", 1)  # 1 measure
    # measure header: TIME_SIG (0x01) | TEMPO (0x02) | REPEAT_OPEN (0x04)
    buf += bytes([0x01 | 0x02 | 0x04])
    buf += bytes([3])  # num = 3
    buf += bytes([0, 4])  # den dur header=0, val=4
    buf += struct.pack(">h", 110)  # tempo = 110
    buf += bytes([1])  # 1 track
    buf += bytes([0])  # track header
    buf += _s("Bass Track")
    buf += bytes([33, 0, 0, 0, 0, 0, 0])  # v1.2 inline channel program=33
    buf += bytes([0])  # measure header
    # beat: HAS_NEXT (0x01) | HAS_VOICE_0 (0x10) | HAS_VOICE_CHANGES_0 (0x20)
    buf += bytes([0x01 | 0x10 | 0x20])
    buf += bytes([0x02 | 0x01])  # NEXT_DURATION | HAS_NOTES
    buf += bytes([0, 4])  # duration: 4
    # note: HAS_NEXT (0x01) | EFFECT (0x04)
    buf += bytes([0x01 | 0x04])
    buf += bytes([5, 1])  # fret 5, string 1
    # effect header: 3 bytes: 0x00, 0x01, 0x41 (BEND | VIBRATO | SLIDE)
    buf += bytes([0x00, 0x01, 0x41])
    buf += bytes([1, 0, 4])  # 1 bend pt, pos 0, val 4
    # note 2: no HAS_NEXT
    buf += bytes([0x00, 7, 1])
    # end of beats in measure: no HAS_NEXT
    buf += bytes([0x00])
    # strings: count=4, tuning=[43, 38, 33, 28]
    buf += bytes([4, 43, 38, 33, 28])
    buf += bytes([0, 0, 0, 0])  # offset 0, r, g, b

    p = tmp_path / "song12.tg"
    p.write_bytes(buf)
    req = ImportRequest(owner_id="u", filename="song12.tg", file_path=p)
    res = TuxGuitarImporter().import_score(req, silent_progress)
    assert res.title == "Binary Song"
    assert res.artist == "Binary Artist"
    assert res.document.bpm == 110.0
    assert len(res.document.tracks) == 1

    # 2. Test TG 1.5 binary
    buf15 = bytearray()
    buf15 += _s("TuxGuitar File Format - 1.5")
    buf15 += _s("Song 15")
    buf15 += _s("")  # empty artist
    buf15 += _s("Album 15")
    buf15 += _s("Author 15")  # artist should fall back to author
    buf15 += _s("2026")
    buf15 += _s("Copyright")
    buf15 += _s("Writer")
    buf15 += _s("Transcriber")
    buf15 += _is("Comments")
    buf15 += bytes([1])  # 1 channel
    buf15 += struct.pack(">h", 1) + bytes([0, 33, 0, 0, 0, 0, 0, 0]) + _s("Bass") + struct.pack(">h", 0)
    buf15 += struct.pack(">h", 1)  # 1 measure
    buf15 += bytes([0])  # measure header
    buf15 += bytes([1])  # 1 track
    buf15 += bytes([0])
    buf15 += _s("Bass 15")
    buf15 += struct.pack(">h", 1)  # channel_id = 1
    buf15 += bytes([0])  # measure header
    # beat with note
    buf15 += bytes([0x01 | 0x10 | 0x20])
    buf15 += bytes([0x02 | 0x01])
    buf15 += bytes([0, 4])
    buf15 += bytes([0x00, 3, 1])  # fret 3, string 1
    buf15 += bytes([0x00])  # end beats
    buf15 += bytes([4, 43, 38, 33, 28, 0, 0, 0, 0])

    p15 = tmp_path / "song15.tg"
    p15.write_bytes(buf15)
    req15 = ImportRequest(owner_id="u", filename="song15.tg", file_path=p15)
    res15 = TuxGuitarImporter().import_score(req15, silent_progress)
    assert res15.title == "Song 15"
    assert res15.artist == "Author 15"


def test_tuxguitar_error_handling(tmp_path: Path) -> None:
    # Corrupt binary file
    p = tmp_path / "corrupt.tg"
    p.write_bytes(b"\x06TG-1.2\x00\x00")
    req = ImportRequest(owner_id="u", filename="corrupt.tg", file_path=p)
    with pytest.raises(ImportError) as exc:
        TuxGuitarImporter().import_score(req, silent_progress)
    assert exc.value.key == "tuxguitar.parse"

    # Unsupported version
    p2 = tmp_path / "unsupported.tg"

    def _s(text: str) -> bytes:
        return bytes([len(text)]) + text.encode("utf-16-be")

    p2.write_bytes(_s("TuxGuitar File Format - 0.9") + b"\x00" * 20)
    req2 = ImportRequest(owner_id="u", filename="unsupported.tg", file_path=p2)
    with pytest.raises(ImportError) as exc:
        TuxGuitarImporter().import_score(req2, silent_progress)
    assert exc.value.key == "tuxguitar.unsupportedVersion"
