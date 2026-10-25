"""Tests for the MuseScore (.mscx / .mscz) importer."""

from __future__ import annotations

import zipfile
from pathlib import Path

import pytest

from fretbook.importers.base import ImportError, ImportRequest, silent_progress
from fretbook.importers.musescore import MuseScoreImporter


def _run_mscx(xml: str, tmp_path: Path, filename: str = "test.mscx", prefer: str = "bass"):
    p = tmp_path / filename
    p.write_text(xml, encoding="utf-8")
    req = ImportRequest(owner_id="u", filename=filename, file_path=p, options={"prefer": prefer})
    return MuseScoreImporter().import_score(req, silent_progress)


def test_musescore_importer_can_handle(tmp_path: Path) -> None:
    importer = MuseScoreImporter()
    assert importer.can_handle(ImportRequest(owner_id="u", filename="song.mscx"))
    assert importer.can_handle(ImportRequest(owner_id="u", filename="song.mscz"))
    assert not importer.can_handle(ImportRequest(owner_id="u", filename="song.gp5"))


def test_musescore_import_needs_file() -> None:
    importer = MuseScoreImporter()
    with pytest.raises(ImportError) as exc:
        importer.import_score(ImportRequest(owner_id="u", filename="x.mscx"), silent_progress)
    assert exc.value.key == "import.needsFile"


def test_musescore_invalid_xml(tmp_path: Path) -> None:
    with pytest.raises(ImportError) as exc:
        _run_mscx("<museScore><unclosed>", tmp_path)
    assert exc.value.key == "musescore.parse"


def test_musescore_invalid_root(tmp_path: Path) -> None:
    with pytest.raises(ImportError) as exc:
        _run_mscx("<notMuseScore><Score/></notMuseScore>", tmp_path)
    assert exc.value.key == "musescore.notMuseScore"


def test_musescore_empty_score_no_notes(tmp_path: Path) -> None:
    xml = """<?xml version="1.0" encoding="UTF-8"?>
<museScore version="3.02">
  <Score>
    <Part><Staff id="1"/></Part>
    <Staff id="1"><Measure><voice/></Measure></Staff>
  </Score>
</museScore>"""
    with pytest.raises(ImportError) as exc:
        _run_mscx(xml, tmp_path)
    assert exc.value.key in ("musescore.noNotes", "musescore.noTracks")


def test_musescore_mscz_unpacking_and_size_limits(tmp_path: Path) -> None:
    valid_xml = Path("tests/fixtures/corpus/musescore/riff.mscx").read_bytes()
    p = tmp_path / "valid.mscz"
    with zipfile.ZipFile(p, "w") as zf:
        zf.writestr("score.mscx", valid_xml)
    req = ImportRequest(owner_id="u", filename="valid.mscz", file_path=p)
    res = MuseScoreImporter().import_score(req, silent_progress)
    assert res.title == "Corpus Riff"

    p2 = tmp_path / "empty.mscz"
    with zipfile.ZipFile(p2, "w") as zf:
        zf.writestr("readme.txt", "hello")
    req2 = ImportRequest(owner_id="u", filename="empty.mscz", file_path=p2)
    with pytest.raises(ImportError) as exc:
        MuseScoreImporter().import_score(req2, silent_progress)
    assert exc.value.key == "musescore.parse"


def test_musescore_pitch_only_assigned_frets(tmp_path: Path) -> None:
    xml = """<?xml version="1.0" encoding="UTF-8"?>
<museScore version="3.02">
  <Score>
    <metaTag name="workTitle">Pitched Melody</metaTag>
    <Part>
      <Staff id="1"/>
      <trackName>Bass Guitar</trackName>
      <Instrument>
        <Channel><program value="33"/></Channel>
      </Instrument>
    </Part>
    <Staff id="1">
      <Measure>
        <voice>
          <TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          <Chord><durationType>quarter</durationType><Note><pitch>28</pitch></Note></Chord>
          <Chord><durationType>quarter</durationType><Note><pitch>31</pitch></Note></Chord>
          <Chord><durationType>quarter</durationType><Note><pitch>33</pitch></Note></Chord>
          <Chord><durationType>quarter</durationType><Note><pitch>35</pitch></Note></Chord>
        </voice>
      </Measure>
    </Staff>
  </Score>
</museScore>"""
    res = _run_mscx(xml, tmp_path)
    assert res.title == "Pitched Melody"
    track = res.document.tracks[0]
    assert track.tuning_midi == [43, 38, 33, 28]
    notes = [b.notes[0] for b in track.bars[0].voices[0].beats]
    assert [n.fret for n in notes] == [0, 3, 0, 2]
    assert [n.string for n in notes] == [3, 3, 2, 2]


def test_musescore_techniques_and_decorations(tmp_path: Path) -> None:
    xml = """<?xml version="1.0" encoding="UTF-8"?>
<museScore version="3.02">
  <Score>
    <Part>
      <Staff id="1"/>
      <trackName>Lead Guitar</trackName>
      <Instrument>
        <StringData>
          <string>40</string><string>45</string><string>50</string>
          <string>55</string><string>59</string><string>64</string>
        </StringData>
      </Instrument>
    </Part>
    <Staff id="1">
      <Measure>
        <startRepeat/>
        <voice>
          <RehearsalMark><text>Verse</text></RehearsalMark>
          <Spanner type="Volta"><Volta><endings>1</endings></Volta></Spanner>
          <Chord>
            <durationType>eighth</durationType>
            <appoggiatura/>
            <Note><pitch>64</pitch><string>0</string><fret>0</fret></Note>
          </Chord>
          <Chord>
            <durationType>quarter</durationType>
            <Articulation><subtype>articStaccatoAbove</subtype></Articulation>
            <Articulation><subtype>guitarVibrato</subtype></Articulation>
            <Note>
              <pitch>64</pitch><string>0</string><fret>0</fret>
              <head>cross</head>
              <ghost>1</ghost>
              <Bend><point pitch="100"/></Bend>
            </Note>
          </Chord>
          <Chord>
            <durationType>quarter</durationType>
            <Note>
              <pitch>67</pitch><string>0</string><fret>3</fret>
              <harmonic>1</harmonic>
              <Tie/>
            </Note>
          </Chord>
          <Chord>
            <durationType>quarter</durationType>
            <Note>
              <pitch>67</pitch><string>0</string><fret>3</fret>
              <endSpanner/>
            </Note>
          </Chord>
        </voice>
      </Measure>
      <Measure>
        <endRepeat>2</endRepeat>
        <voice>
          <Chord>
            <durationType>whole</durationType>
            <Note><pitch>64</pitch><string>0</string><fret>0</fret></Note>
          </Chord>
        </voice>
      </Measure>
    </Staff>
  </Score>
</museScore>"""
    res = _run_mscx(xml, tmp_path)
    bars = res.document.bars
    assert bars[0].repeat_start is True
    assert bars[0].section == "Verse"
    assert bars[0].alternate_endings == [1]
    assert bars[1].repeat_end == 2

    beats = res.document.tracks[0].bars[0].voices[0].beats
    # Grace note
    assert beats[0].grace == "on_beat"
    # Note with techniques
    note = beats[1].notes[0]
    assert note.dead is True
    assert note.ghost is True
    assert note.vibrato is True
    assert note.staccato is True
    assert note.bend == 1.0
    # Tied note
    assert beats[3].notes[0].tie is True


def test_musescore_helpers_and_container(tmp_path: Path) -> None:
    import xml.etree.ElementTree as ET

    from fretbook.importers.musescore import _marker_marks, _parse_fraction

    assert _parse_fraction("1/4") == 0.25
    assert _parse_fraction("0.5") == 0.5
    assert _parse_fraction("invalid") is None
    assert _parse_fraction("1/0") is None

    elem = ET.fromstring("<Marker><label>segno</label></Marker>")
    assert _marker_marks(elem) == {"segno"}
    elem2 = ET.fromstring("<Marker><text>Coda</text></Marker>")
    assert _marker_marks(elem2) == {"coda"}
    elem3 = ET.fromstring("<Marker><jumpTo>Fine</jumpTo></Marker>")
    assert _marker_marks(elem3) == {"fine"}

    # MSCZ with container.xml
    container_xml = """<?xml version="1.0" encoding="UTF-8"?>
<container>
  <rootfiles>
    <rootfile full-path="Score.mscx"/>
  </rootfiles>
</container>"""
    score_xml = Path("tests/fixtures/corpus/musescore/riff.mscx").read_bytes()
    p = tmp_path / "container.mscz"
    with zipfile.ZipFile(p, "w") as zf:
        zf.writestr("META-INF/container.xml", container_xml)
        zf.writestr("Score.mscx", score_xml)
    req = ImportRequest(owner_id="u", filename="container.mscz", file_path=p)
    res = MuseScoreImporter().import_score(req, silent_progress)
    assert res.title == "Corpus Riff"
