from pathlib import Path

from fretbook.importers.base import ImportRequest, silent_progress
from fretbook.importers.musicxml import MusicXmlImporter

BASS = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <work><work-title>Fixture</work-title></work>
  <identification><creator type="composer">Ada</creator></identification>
  <part-list><score-part id="P1"><part-name>Bass</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>2</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staff-details>
          <staff-tuning line="1"><tuning-step>G</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
          <staff-tuning line="2"><tuning-step>D</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
          <staff-tuning line="3"><tuning-step>A</tuning-step><tuning-octave>1</tuning-octave></staff-tuning>
          <staff-tuning line="4"><tuning-step>E</tuning-step><tuning-octave>1</tuning-octave></staff-tuning>
        </staff-details>
      </attributes>
      <sound tempo="100"/>
      <note>
        <pitch><step>G</step><octave>2</octave></pitch>
        <duration>2</duration>
        <notations><technical><string>1</string><fret>5</fret></technical></notations>
      </note>
      <note>
        <chord/>
        <pitch><step>D</step><octave>2</octave></pitch>
        <duration>2</duration>
        <notations><technical><string>2</string><fret>3</fret></technical></notations>
      </note>
      <note><rest/><duration>2</duration></note>
      <note>
        <pitch><step>A</step><octave>1</octave></pitch>
        <duration>4</duration>
        <notations><technical><string>3</string><fret>0</fret></technical></notations>
      </note>
    </measure>
  </part>
</score-partwise>
"""

GUITAR = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staff-details>
          <staff-tuning line="1"><tuning-step>E</tuning-step><tuning-octave>4</tuning-octave></staff-tuning>
          <staff-tuning line="2"><tuning-step>B</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
          <staff-tuning line="3"><tuning-step>G</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
          <staff-tuning line="4"><tuning-step>D</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
          <staff-tuning line="5"><tuning-step>A</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
          <staff-tuning line="6"><tuning-step>E</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
        </staff-details>
      </attributes>
      <note>
        <pitch><step>E</step><octave>2</octave></pitch>
        <duration>4</duration>
        <notations><technical><string>6</string><fret>0</fret></technical></notations>
      </note>
    </measure>
  </part>
</score-partwise>
"""


def _import(tmp_path: Path, name: str, xml: str):
    path = tmp_path / name
    path.write_text(xml, encoding="utf-8")
    return MusicXmlImporter().import_score(
        ImportRequest(owner_id="local", filename=name, file_path=path),
        silent_progress,
    )


def test_bass_chord_then_rest(tmp_path: Path) -> None:
    result = _import(tmp_path, "bass.musicxml", BASS)
    track = result.document.tracks[0]
    assert result.title == "Fixture"
    assert result.artist == "Ada"
    assert track.instrument == "bass-guitar"
    assert track.tuning_midi == [43, 38, 33, 28]
    beats = track.measures[0].voices[0].beats
    assert [(beat.position, beat.duration, beat.rest, [(n.string, n.fret) for n in beat.notes]) for beat in beats] == [
        (0.0, 1.0, False, [(0, 5), (1, 3)]),
        (1.0, 1.0, True, []),
        (2.0, 2.0, False, [(2, 0)]),
    ]
    assert result.document.bpm == 100


def test_six_string_guitar(tmp_path: Path) -> None:
    result = _import(tmp_path, "guitar.xml", GUITAR)
    track = result.document.tracks[0]
    assert track.instrument == "guitar"
    assert track.tuning_midi == [64, 59, 55, 50, 45, 40]
    note = track.measures[0].voices[0].beats[0].notes[0]
    assert (note.string, note.fret) == (5, 0)
