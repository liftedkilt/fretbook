"""Write a :class:`ScoreDocument` as MusicXML (score-partwise 4.0).

The stored document stays Fretbook JSON, which is renderer-independent and
easy to validate and edit. This export is the portable copy: MuseScore,
Guitar Pro, and alphaTab all read it, string and fret included, so a library
is never locked into Fretbook. ``fretbook.importers.musicxml`` reads it back
(the round trip is tested), and Songsterr imports export through here too.

Each track becomes a part with one tablature staff. Pitches are computed from
the tuning, capo, and fret. Ticks map to MusicXML divisions directly
(``<divisions>960</divisions>``), so durations are exact.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET

from fretbook.score.model import TICKS_PER_QUARTER, Bar, Beat, Note, ScoreDocument, Track, TrackBar
from fretbook.score.techniques import tuplet_ratio

_STEPS = [
    ("C", 0),
    ("C", 1),
    ("D", 0),
    ("D", 1),
    ("E", 0),
    ("F", 0),
    ("F", 1),
    ("G", 0),
    ("G", 1),
    ("A", 0),
    ("A", 1),
    ("B", 0),
]
_TYPES = [
    (4 * TICKS_PER_QUARTER, "whole"),
    (2 * TICKS_PER_QUARTER, "half"),
    (TICKS_PER_QUARTER, "quarter"),
    (TICKS_PER_QUARTER // 2, "eighth"),
    (TICKS_PER_QUARTER // 4, "16th"),
    (TICKS_PER_QUARTER // 8, "32nd"),
    (TICKS_PER_QUARTER // 16, "64th"),
]


def _sub(parent: ET.Element, tag: str, text: str | int | float | None = None, **attrib: str) -> ET.Element:
    element = ET.SubElement(parent, tag, attrib)
    if text is not None:
        element.text = str(text)
    return element


def _pitch(parent: ET.Element, midi: int) -> None:
    step, alter = _STEPS[midi % 12]
    pitch = _sub(parent, "pitch")
    _sub(pitch, "step", step)
    if alter:
        _sub(pitch, "alter", alter)
    _sub(pitch, "octave", midi // 12 - 1)


def _type_and_dots(ticks: int, tuplet: int | None) -> tuple[str, int]:
    """Notated type and dot count for a duration, undoing a tuplet's scaling when there is one."""
    base = ticks
    if tuplet:
        actual, normal = tuplet_ratio(tuplet)
        base = round(ticks * actual / normal)
    for value, name in _TYPES:
        for dots, factor in ((0, 1.0), (1, 1.5), (2, 1.75)):
            if abs(base - value * factor) < 1:
                return name, dots
    for value, name in _TYPES:
        if base >= value:
            return name, 0
    return "64th", 0


def _note_element(
    measure: ET.Element,
    *,
    beat: Beat,
    note: Note | None,
    chord: bool,
    voice: int,
    track: Track,
) -> None:
    element = _sub(measure, "note")
    if beat.grace:
        _sub(element, "grace", **({"slash": "yes"} if beat.grace == "before_beat" else {}))
    if chord:
        _sub(element, "chord")
    if note is None:
        _sub(element, "rest")
    else:
        _pitch(element, track.tuning_midi[note.string] + track.capo + note.fret)
    if not beat.grace:
        _sub(element, "duration", beat.duration)
    if note is not None and note.tie:
        _sub(element, "tie", type="stop")
    _sub(element, "voice", voice)
    kind, dots = _type_and_dots(beat.duration, beat.tuplet)
    _sub(element, "type", kind)
    for _ in range(dots):
        _sub(element, "dot")
    if beat.tuplet:
        actual, normal = tuplet_ratio(beat.tuplet)
        modification = _sub(element, "time-modification")
        _sub(modification, "actual-notes", actual)
        _sub(modification, "normal-notes", normal)
    if note is None:
        return
    if note.dead:
        _sub(element, "notehead", "x")
    elif note.ghost:
        _sub(element, "notehead", "normal", parentheses="yes")
    notations = _sub(element, "notations")
    if note.tie:
        _sub(notations, "tied", type="stop")
    if note.slide in {"legato", "shift"}:
        _sub(notations, "slide" if note.slide == "legato" else "glissando", type="start", number="1")
    technical = _sub(notations, "technical")
    if note.hammer:
        _sub(technical, "hammer-on", "H", type="start", number="1")
    if note.harmonic:
        harmonic = _sub(technical, "harmonic")
        _sub(harmonic, "artificial" if note.harmonic == "artificial" else "natural")
    if note.bend:
        bend = _sub(technical, "bend")
        _sub(bend, "bend-alter", note.bend)
    _sub(technical, "string", note.string + 1)
    _sub(technical, "fret", note.fret)
    if note.vibrato:
        ornaments = _sub(notations, "ornaments")
        _sub(ornaments, "wavy-line", type="start")
    if note.staccato:
        articulations = _sub(notations, "articulations")
        _sub(articulations, "staccato")


def _attributes(measure: ET.Element, bar: Bar, track: Track, *, first: bool, previous: Bar | None) -> None:
    if not first and previous is not None and previous.signature == bar.signature:
        return
    attributes = _sub(measure, "attributes")
    if first:
        _sub(attributes, "divisions", TICKS_PER_QUARTER)
    time = _sub(attributes, "time")
    _sub(time, "beats", bar.signature[0])
    _sub(time, "beat-type", bar.signature[1])
    if not first:
        return
    clef = _sub(attributes, "clef")
    _sub(clef, "sign", "TAB")
    _sub(clef, "line", 5)
    details = _sub(attributes, "staff-details")
    _sub(details, "staff-lines", len(track.tuning_midi))
    # Staff line 1 is the bottom line, the lowest string; tuning_midi is highest first.
    for line, midi in enumerate(reversed(track.tuning_midi), start=1):
        staff_tuning = _sub(details, "staff-tuning", line=str(line))
        step, alter = _STEPS[midi % 12]
        _sub(staff_tuning, "tuning-step", step)
        if alter:
            _sub(staff_tuning, "tuning-alter", alter)
        _sub(staff_tuning, "tuning-octave", midi // 12 - 1)
    if track.capo:
        _sub(details, "capo", track.capo)


def _bar_marks(measure: ET.Element, bar: Bar, *, tempo: float | None) -> None:
    if bar.repeat_start or bar.alternate_endings:
        barline = _sub(measure, "barline", location="left")
        if bar.alternate_endings:
            _sub(barline, "ending", number=",".join(str(item) for item in bar.alternate_endings), type="start")
        if bar.repeat_start:
            _sub(barline, "repeat", direction="forward")
    if bar.section:
        direction = _sub(measure, "direction", placement="above")
        _sub(_sub(direction, "direction-type"), "rehearsal", bar.section)
    if tempo is not None:
        direction = _sub(measure, "direction", placement="above")
        metronome = _sub(_sub(direction, "direction-type"), "metronome")
        _sub(metronome, "beat-unit", "quarter")
        _sub(metronome, "per-minute", round(tempo, 2))
        _sub(direction, "sound", tempo=str(round(tempo, 2)))


def _bar_end(measure: ET.Element, bar: Bar) -> None:
    if bar.repeat_end:
        barline = _sub(measure, "barline", location="right")
        _sub(barline, "repeat", direction="backward", times=str(bar.repeat_end))


def _voice_notes(measure: ET.Element, track_bar: TrackBar, bar: Bar, track: Track) -> None:
    length = bar.length_ticks
    voices = [voice for voice in track_bar.voices if voice.beats]
    cursor = 0
    if not voices:
        rest = _sub(measure, "note")
        _sub(rest, "rest", measure="yes")
        _sub(rest, "duration", length)
        _sub(rest, "voice", 1)
        return
    for number, voice in enumerate(voices, start=1):
        if number > 1:
            backup = _sub(measure, "backup")
            _sub(backup, "duration", cursor)
        cursor = 0
        for beat in sorted(voice.beats, key=lambda item: (item.position, item.grace is None)):
            if beat.grace is None and beat.position > cursor:
                forward = _sub(measure, "forward")
                _sub(forward, "duration", beat.position - cursor)
                _sub(forward, "voice", number)
                cursor = beat.position
            notes: list[Note | None] = [*sorted(beat.notes, key=lambda item: item.string)] or [None]
            for position, note in enumerate(notes):
                _note_element(measure, beat=beat, note=note, chord=position > 0, voice=number, track=track)
            if beat.grace is None:
                cursor += beat.duration
        if cursor < length and number == 1:
            forward = _sub(measure, "forward")
            _sub(forward, "duration", length - cursor)
            _sub(forward, "voice", number)
            cursor = length


def to_musicxml(document: ScoreDocument, *, title: str, artist: str) -> bytes:
    root = ET.Element("score-partwise", version="4.0")
    work = _sub(root, "work")
    _sub(work, "work-title", title)
    identification = _sub(root, "identification")
    if artist:
        _sub(identification, "creator", artist, type="artist")
    encoding = _sub(identification, "encoding")
    _sub(encoding, "software", "Fretbook")
    part_list = _sub(root, "part-list")
    for index, track in enumerate(document.tracks, start=1):
        score_part = _sub(part_list, "score-part", id=f"P{index}")
        _sub(score_part, "part-name", track.name)
    for index, track in enumerate(document.tracks, start=1):
        part = _sub(root, "part", id=f"P{index}")
        previous: Bar | None = None
        for bar_index, (bar, track_bar) in enumerate(zip(document.bars, track.bars, strict=True)):
            measure = _sub(part, "measure", number=str(bar_index + 1))
            _attributes(measure, bar, track, first=bar_index == 0, previous=previous)
            tempo = document.bpm if bar_index == 0 else bar.tempo
            _bar_marks(measure, bar, tempo=tempo if index == 1 else None)
            _voice_notes(measure, track_bar, bar, track)
            _bar_end(measure, bar)
            previous = bar
    ET.indent(root)
    body = ET.tostring(root, encoding="unicode")
    header = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" '
        '"http://www.musicxml.org/dtds/partwise.dtd">\n'
    )
    return (header + body + "\n").encode("utf-8")
