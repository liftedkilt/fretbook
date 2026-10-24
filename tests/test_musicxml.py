"""MusicXML import fixtures, written the way MuseScore and Guitar Pro export them."""

import io
import re
import zipfile
from pathlib import Path

import pytest

from fretbook.export.musicxml import to_musicxml
from fretbook.importers import musicxml
from fretbook.importers.base import ImportError, ImportRequest, silent_progress
from fretbook.importers.musicxml import MusicXmlImporter
from fretbook.score.model import Bar, Beat, Note, ScoreDocument, Track, TrackBar, Voice

# Staff line 1 is the bottom line: the lowest string.
BASS_TUNING = """
<staff-details>
  <staff-lines>4</staff-lines>
  <staff-tuning line="1"><tuning-step>E</tuning-step><tuning-octave>1</tuning-octave></staff-tuning>
  <staff-tuning line="2"><tuning-step>A</tuning-step><tuning-octave>1</tuning-octave></staff-tuning>
  <staff-tuning line="3"><tuning-step>D</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
  <staff-tuning line="4"><tuning-step>G</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
</staff-details>
"""

BASS = f"""<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Fixture</work-title></work>
  <identification><creator type="composer">Ada</creator></identification>
  <part-list><score-part id="P1"><part-name>Bass</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>2</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        {BASS_TUNING}
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

# Two voices separated by <backup>, a grace note, a triplet, repeats, and a section.
VOICES = f"""<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Bass</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <barline location="left"><repeat direction="forward"/></barline>
      <attributes><divisions>3</divisions><time><beats>4</beats><beat-type>4</beat-type></time>{BASS_TUNING}</attributes>
      <direction><direction-type><rehearsal>Verse</rehearsal></direction-type></direction>
      <note><grace slash="yes"/><pitch><step>E</step><octave>1</octave></pitch><voice>1</voice><type>eighth</type>
        <notations><technical><string>4</string><fret>0</fret></technical></notations></note>
      <note><pitch><step>G</step><octave>1</octave></pitch><duration>12</duration><voice>1</voice>
        <notations><technical>
          <hammer-on type="start">H</hammer-on><string>4</string><fret>3</fret>
        </technical></notations>
      </note>
      <backup><duration>12</duration></backup>
      <note><pitch><step>G</step><octave>2</octave></pitch><duration>1</duration><voice>2</voice>
        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>
        <notations><technical><string>1</string><fret>0</fret></technical></notations></note>
      <note><pitch><step>G</step><octave>2</octave></pitch><duration>1</duration><voice>2</voice>
        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>
        <notations><technical><string>1</string><fret>0</fret></technical></notations></note>
      <note><pitch><step>G</step><octave>2</octave></pitch><duration>1</duration><voice>2</voice>
        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>
        <notations><technical><string>1</string><fret>0</fret></technical></notations></note>
      <forward><duration>9</duration><voice>2</voice></forward>
      <barline location="right"><repeat direction="backward" times="3"/></barline>
    </measure>
  </part>
</score-partwise>
"""

# Guitar Pro writes one part with a notation staff and a tab staff; the notes appear on both.
TWO_STAVES = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <staff-details number="2">
          <staff-lines>6</staff-lines>
          <staff-tuning line="1"><tuning-step>D</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
          <staff-tuning line="2"><tuning-step>A</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
          <staff-tuning line="3"><tuning-step>D</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
          <staff-tuning line="4"><tuning-step>G</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
          <staff-tuning line="5"><tuning-step>B</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
          <staff-tuning line="6"><tuning-step>E</tuning-step><tuning-octave>4</tuning-octave></staff-tuning>
        </staff-details>
      </attributes>
      <note><pitch><step>D</step><octave>2</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff>
        <notations><technical><string>6</string><fret>0</fret></technical></notations></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>D</step><octave>2</octave></pitch><duration>4</duration><voice>5</voice><staff>2</staff>
        <notations><technical><string>6</string><fret>0</fret></technical></notations></note>
    </measure>
  </part>
</score-partwise>
"""


def _import(tmp_path: Path, name: str, xml: str | bytes):
    path = tmp_path / name
    path.write_bytes(xml if isinstance(xml, bytes) else xml.encode())
    return MusicXmlImporter().import_score(
        ImportRequest(owner_id="local", filename=name, file_path=path),
        silent_progress,
    )


def _beats(result, bar: int = 0, voice: int = 0):
    return result.document.tracks[0].bars[bar].voices[voice].beats


def test_bass_tuning_is_stored_highest_first(tmp_path: Path) -> None:
    result = _import(tmp_path, "bass.musicxml", BASS)
    track = result.document.tracks[0]
    assert result.title == "Fixture"
    assert result.artist == "Ada"
    assert track.instrument == "bass-guitar"
    assert track.tuning_midi == [43, 38, 33, 28]
    assert [(beat.position, beat.duration, [(n.string, n.fret) for n in beat.notes]) for beat in _beats(result)] == [
        (0, 960, [(0, 5), (1, 3)]),
        (960, 960, []),
        (1920, 1920, [(2, 0)]),
    ]
    assert result.document.bpm == 100


def test_backup_makes_a_second_voice(tmp_path: Path) -> None:
    result = _import(tmp_path, "voices.xml", VOICES)
    bar = result.document.tracks[0].bars[0]
    assert len(bar.voices) == 2
    grace, held = bar.voices[0].beats
    # The grace note takes no time; the next note still starts at 0.
    assert (grace.position, grace.grace, grace.duration) == (0, "before_beat", 480)
    assert (held.position, held.duration, held.notes[0].hammer) == (0, 3840, True)
    triplets = bar.voices[1].beats
    assert [(beat.position, beat.duration, beat.tuplet) for beat in triplets] == [
        (0, 320, 3),
        (320, 320, 3),
        (640, 320, 3),
    ]
    song_bar = result.document.bars[0]
    assert (song_bar.repeat_start, song_bar.repeat_end, song_bar.section) == (True, 3, "Verse")


def test_only_the_tab_staff_is_read(tmp_path: Path) -> None:
    result = _import(tmp_path, "gp-export.xml", TWO_STAVES)
    track = result.document.tracks[0]
    assert track.tuning_midi == [64, 59, 55, 50, 45, 38]
    beats = _beats(result)
    assert len(result.document.tracks[0].bars[0].voices) == 1
    assert [(beat.position, [(n.string, n.fret) for n in beat.notes]) for beat in beats] == [(0, [(5, 0)])]


def test_rejects_scores_without_tab(tmp_path: Path) -> None:
    plain = BASS.replace("<technical>", "<!--").replace("</technical>", "-->")
    with pytest.raises(ImportError):
        _import(tmp_path, "plain.xml", plain)


def test_export_round_trips(tmp_path: Path) -> None:
    document = ScoreDocument(
        bpm=96,
        bars=[Bar(section="Intro", repeat_start=True), Bar(signature=(3, 4), tempo=80, repeat_end=2)],
        tracks=[
            Track(
                id="bass",
                name="Bass",
                instrument="bass-guitar",
                tuning_midi=[43, 38, 33, 28],
                preferred=True,
                bars=[
                    TrackBar(
                        voices=[
                            Voice(
                                beats=[
                                    Beat(position=0, duration=480, grace="on_beat", notes=[Note(string=3, fret=1)]),
                                    Beat(position=0, duration=1440, notes=[Note(string=3, fret=3, hammer=True)]),
                                    Beat(position=1440, duration=320, tuplet=3, notes=[Note(string=2, fret=5)]),
                                    Beat(position=1760, duration=320, tuplet=3, notes=[Note(string=2, fret=7)]),
                                    Beat(
                                        position=2080, duration=320, tuplet=3, notes=[Note(string=0, fret=2, dead=True)]
                                    ),
                                ]
                            )
                        ]
                    ),
                    TrackBar(voices=[Voice(beats=[Beat(position=960, duration=1920, notes=[Note(string=1, fret=0)])])]),
                ],
            ),
            Track(
                id="gtr",
                name="Guitar",
                instrument="guitar",
                capo=2,
                tuning_midi=[64, 59, 55, 50, 45, 40],
                bars=[TrackBar(), TrackBar(voices=[Voice(beats=[Beat(position=0, duration=2880)])])],
            ),
        ],
    )
    xml = to_musicxml(document, title="Round Trip", artist="Ada")
    assert b'<staff-tuning line="1">' in xml
    back = _import(tmp_path, "round.musicxml", xml)
    assert back.title == "Round Trip" and back.artist == "Ada"
    again = back.document
    assert again.bpm == 96
    assert [bar.signature for bar in again.bars] == [(4, 4), (3, 4)]
    assert again.bars[1].tempo == 80
    assert (again.bars[0].section, again.bars[0].repeat_start, again.bars[1].repeat_end) == ("Intro", True, 2)
    bass = again.tracks[0]
    assert bass.tuning_midi == [43, 38, 33, 28]
    original = [
        (
            beat.position,
            beat.duration,
            beat.grace,
            beat.tuplet,
            [(n.string, n.fret, n.hammer, n.dead) for n in beat.notes],
        )
        for beat in document.tracks[0].bars[0].voices[0].beats
    ]
    copied = [
        (
            beat.position,
            beat.duration,
            beat.grace,
            beat.tuplet,
            [(n.string, n.fret, n.hammer, n.dead) for n in beat.notes],
        )
        for beat in bass.bars[0].voices[0].beats
    ]
    assert copied == original
    second = [beat for beat in bass.bars[1].voices[0].beats if beat.notes]
    assert [(beat.position, beat.duration) for beat in second] == [(960, 1920)]
    # A part with only rests has no tab data and is skipped.
    assert len(again.tracks) == 1


def test_musicxml_repeats_voltas_and_directions_round_trip(tmp_path: Path) -> None:
    doc = ScoreDocument(
        bpm=120,
        bars=[
            Bar(signature=(4, 4), directions=["segno"]),
            Bar(signature=(4, 4), repeat_start=True),
            Bar(signature=(4, 4), alternate_endings=[1], repeat_end=2),
            Bar(signature=(4, 4), alternate_endings=[2], directions=["da_coda"]),
            Bar(signature=(4, 4), directions=["dal_segno_al_coda"]),
            Bar(signature=(4, 4), directions=["coda", "fine"]),
        ],
        tracks=[
            Track(
                id="t1",
                name="Bass",
                instrument="bass-guitar",
                tuning_midi=[43, 38, 33, 28],
                bars=[
                    TrackBar(voices=[Voice(beats=[Beat(position=0, duration=3840, notes=[Note(string=0, fret=2)])])])
                    for _ in range(6)
                ],
            )
        ],
    )
    xml = to_musicxml(doc, title="Directions Riff", artist="Ada")
    back = _import(tmp_path, "directions.musicxml", xml).document
    assert len(back.bars) == 6
    assert back.bars[0].directions == ["segno"]
    assert back.bars[1].repeat_start is True
    assert back.bars[2].alternate_endings == [1] and back.bars[2].repeat_end == 2
    assert back.bars[3].alternate_endings == [2] and back.bars[3].directions == ["da_coda"]
    assert back.bars[4].directions == ["dal_segno_al_coda"]
    assert sorted(back.bars[5].directions) == ["coda", "fine"]


def _timewise(partwise: str) -> str:
    """The same score regrouped as measures holding parts, built from BASS's single part."""
    head, rest = partwise.split('<part id="P1">', 1)
    body = rest.rsplit("</part>", 1)[0]
    measures = re.findall(r'<measure number="(\d+)">(.*?)</measure>', body, re.S)
    wrapped = "".join(f'<measure number="{n}"><part id="P1">{m}</part></measure>' for n, m in measures)
    return head.replace("score-partwise", "score-timewise") + wrapped + "</score-timewise>"


def test_timewise_imports_like_partwise(tmp_path: Path) -> None:
    partwise = _import(tmp_path, "a.xml", BASS)
    timewise = _import(tmp_path, "b.xml", _timewise(BASS))
    assert timewise.document == partwise.document
    assert timewise.title == partwise.title == "Fixture"


def test_timewise_keeps_every_part_in_order(tmp_path: Path) -> None:
    xml = """<score-timewise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>One</part-name></score-part>
    <score-part id="P2"><part-name>Two</part-name></score-part>
  </part-list>
  <measure number="1">
    <part id="P1"><attributes><divisions>1</divisions></attributes>{note}</part>
    <part id="P2"><attributes><divisions>1</divisions></attributes>{note}</part>
  </measure>
</score-timewise>""".format(
        note="<note><pitch><step>E</step><octave>2</octave></pitch><duration>4</duration><notations><technical><string>6</string><fret>0</fret></technical></notations></note>"
    )
    result = _import(tmp_path, "two.xml", xml)
    assert [track.name for track in result.document.tracks] == ["One", "Two"]


def _mxl(files: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return buffer.getvalue()


CONTAINER = b'<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>'


def test_compressed_mxl_imports_like_plain_xml(tmp_path: Path) -> None:
    plain = _import(tmp_path, "a.xml", BASS)
    packed = _import(tmp_path, "b.mxl", _mxl({"META-INF/container.xml": CONTAINER, "score.xml": BASS.encode()}))
    assert packed.document == plain.document


def test_compressed_mxl_with_timewise_root(tmp_path: Path) -> None:
    packed = _import(
        tmp_path, "c.mxl", _mxl({"META-INF/container.xml": CONTAINER, "score.xml": _timewise(BASS).encode()})
    )
    assert packed.document == _import(tmp_path, "a.xml", BASS).document


def test_mxl_that_unpacks_too_large_is_refused(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(musicxml, "MAX_MXL_BYTES", 100)
    with pytest.raises(ImportError) as caught:
        _import(tmp_path, "bomb.mxl", _mxl({"META-INF/container.xml": CONTAINER, "score.xml": BASS.encode()}))
    assert caught.value.key == "musicxml.tooLarge"


@pytest.mark.parametrize(
    "files",
    [
        {"score.xml": b"<x/>"},
        {"META-INF/container.xml": b"<container/>"},
        {"META-INF/container.xml": CONTAINER},
    ],
)
def test_broken_mxl_is_a_parse_error(tmp_path: Path, files: dict[str, bytes]) -> None:
    with pytest.raises(ImportError) as caught:
        _import(tmp_path, "broken.mxl", _mxl(files))
    assert caught.value.key == "musicxml.parse"
