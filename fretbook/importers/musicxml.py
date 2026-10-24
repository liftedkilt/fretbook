"""MusicXML tablature importer.

Only string/fret notes become notes, so a fingering is never invented. Parts
without tablature (vocals, piano) are skipped. Conventions that are easy to
get backwards:

* ``<staff-tuning line="1">`` is the bottom staff line, the *lowest* string.
  Fretbook stores the highest string first, so the tuning is reversed.
* ``<technical><string>1</string>`` is the *highest* string, the same as
  Fretbook's index 0.
* ``<backup>`` and ``<forward>`` move the time cursor; a second voice or a
  second staff (Guitar Pro exports write standard notation and tab as two
  staves of one part) comes after a ``<backup>``. Only the tab staff is kept.
* Grace notes have no ``<duration>`` and take no time.
"""

from __future__ import annotations

import io
import re
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fretbook.importers.base import ImportError, ImportRequest, ImportResult, Progress
from fretbook.score.instruments import PRESETS
from fretbook.score.model import TICKS_PER_QUARTER, Bar, Beat, Note, ScoreDocument, Track, TrackBar, Voice

_STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_TYPE_TICKS = {
    "breve": 8 * TICKS_PER_QUARTER,
    "whole": 4 * TICKS_PER_QUARTER,
    "half": 2 * TICKS_PER_QUARTER,
    "quarter": TICKS_PER_QUARTER,
    "eighth": TICKS_PER_QUARTER // 2,
    "16th": TICKS_PER_QUARTER // 4,
    "32nd": TICKS_PER_QUARTER // 8,
    "64th": TICKS_PER_QUARTER // 16,
}


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _child(element: ET.Element | None, name: str) -> ET.Element | None:
    if element is None:
        return None
    for child in element:
        if _local(child.tag) == name:
            return child
    return None


def _children(element: ET.Element, name: str) -> list[ET.Element]:
    return [child for child in element if _local(child.tag) == name]


def _text(element: ET.Element | None) -> str:
    if element is None or element.text is None:
        return ""
    return element.text.strip()


def _int(element: ET.Element | None, default: int = 0) -> int:
    try:
        return int(float(_text(element)))
    except ValueError:
        return default


def _midi(step: str, alter: int, octave: int) -> int:
    return (octave + 1) * 12 + _STEP[step.upper()] + alter


@dataclass
class _Event:
    start: int
    duration: int
    notes: list[Note] = field(default_factory=list)
    grace: str | None = None
    tuplet: int | None = None


@dataclass
class _Part:
    name: str
    tuning: list[int]
    capo: int
    bars: list[Bar]
    track_bars: list[TrackBar]
    opening_tempo: float | None
    has_tab: bool


MAX_MXL_BYTES = 50 * 1024 * 1024
"""Largest score a compressed ``.mxl`` may unpack to. Guards against zip bombs."""


MAX_CONTAINER_BYTES = 1024 * 1024
"""Largest ``META-INF/container.xml`` read; a longer one is cut off and fails to parse."""


def _open_score(path: Path) -> Path | io.BytesIO:
    """The score XML of ``path``: the file itself, or the root file inside a compressed ``.mxl``."""
    with path.open("rb") as handle:
        if handle.read(4) != b"PK\x03\x04":
            return path
    try:
        with zipfile.ZipFile(path) as archive:
            with archive.open("META-INF/container.xml") as handle:
                container = ET.fromstring(handle.read(MAX_CONTAINER_BYTES + 1)[:MAX_CONTAINER_BYTES])
            roots = [
                element.get("full-path")
                for element in container.iter()
                if _local(element.tag) == "rootfile" and element.get("full-path")
            ]
            if not roots:
                raise ImportError("this .mxl has no score inside", "musicxml.parse")
            info = archive.getinfo(str(roots[0]))
            if info.file_size > MAX_MXL_BYTES:
                raise ImportError("this .mxl unpacks to more than 50 MB", "musicxml.tooLarge")
            return io.BytesIO(archive.read(info))
    except (zipfile.BadZipFile, KeyError, ET.ParseError) as exc:
        raise ImportError("MusicXML file could not be parsed", "musicxml.parse") from exc


def _timewise_to_partwise(root: ET.Element) -> ET.Element:
    """Regroup a ``score-timewise`` document (measures holding parts) as ``score-partwise``."""
    partwise = ET.Element(root.tag.replace("score-timewise", "score-partwise"), root.attrib)
    parts: dict[str, ET.Element] = {}
    for child in root:
        if _local(child.tag) != "measure":
            partwise.append(child)
            continue
        for part in _children(child, "part"):
            part_id = part.attrib.get("id", "")
            if part_id not in parts:
                parts[part_id] = ET.Element(part.tag, {"id": part_id})
            measure = ET.SubElement(parts[part_id], child.tag, child.attrib)
            measure.extend(list(part))
    partwise.extend(parts.values())
    return partwise


class MusicXmlImporter:
    kind = "musicxml"

    def can_handle(self, request: ImportRequest) -> bool:
        name = (request.filename or "").lower()
        return name.endswith((".musicxml", ".xml", ".mxl"))

    def import_score(self, request: ImportRequest, progress: Progress) -> ImportResult:
        if request.file_path is None:
            raise ImportError("MusicXML import needs a file", "import.needsFile")
        progress("Reading MusicXML", "import.readingFile")
        try:
            root = ET.parse(_open_score(request.file_path)).getroot()
        except ET.ParseError as exc:
            raise ImportError("MusicXML file could not be parsed", "musicxml.parse") from exc
        if _local(root.tag) == "score-timewise":
            root = _timewise_to_partwise(root)
        if _local(root.tag) != "score-partwise":
            raise ImportError("expected a MusicXML score-partwise document", "musicxml.notMusicXml")
        title, artist = _credits(root)
        names = _part_names(root)
        parts = [_read_part(part, names, index) for index, part in enumerate(_children(root, "part"))]
        tab_parts = [part for part in parts if part.has_tab]
        if not tab_parts:
            raise ImportError("this MusicXML file has no tablature string/fret data", "musicxml.noTab")
        bars = tab_parts[0].bars
        bpm = tab_parts[0].opening_tempo or 120.0
        prefer = str(request.options.get("prefer") or "")
        preferred = _preferred_index(tab_parts, prefer)
        tracks = [
            Track(
                id=f"trk_xml_{index}",
                name=part.name,
                instrument="bass-guitar" if len(part.tuning) <= 5 else "guitar",
                capo=part.capo,
                tuning_midi=part.tuning,
                preferred=index == preferred,
                bars=(part.track_bars + [TrackBar() for _ in bars])[: len(bars)],
            )
            for index, part in enumerate(tab_parts)
        ]
        slug = Path(request.filename or request.file_path.name).stem
        slug = "".join(ch.lower() if ch.isalnum() else "-" for ch in slug).strip("-") or "song"
        progress("Tab ready", "import.tabReady")
        return ImportResult(
            title=title or slug,
            artist=artist,
            slug=slug[:60],
            document=ScoreDocument(bpm=bpm, bars=bars, tracks=tracks),
            source_kind="musicxml",
            source_ref={"filename": request.filename or request.file_path.name},
        )


def _preferred_index(parts: list[_Part], prefer: str) -> int:
    if prefer:
        for index, part in enumerate(parts):
            if (len(part.tuning) <= 5) == (prefer == "bass"):
                return index
    return 0


def _credits(root: ET.Element) -> tuple[str, str]:
    work = _child(root, "work")
    title = _text(_child(work, "work-title")) or _text(_child(root, "movement-title"))
    artist = ""
    identification = _child(root, "identification")
    if identification is not None:
        creators = _children(identification, "creator")
        for creator in creators:
            if creator.attrib.get("type") in {"composer", "artist"} and _text(creator):
                artist = _text(creator)
                break
        if not artist and creators:
            artist = _text(creators[0])
    return title, artist


def _part_names(root: ET.Element) -> dict[str, str]:
    part_list = _child(root, "part-list")
    if part_list is None:
        return {}
    return {
        score_part.attrib.get("id", ""): _text(_child(score_part, "part-name"))
        for score_part in _children(part_list, "score-part")
    }


def _guess_tuning(strings: int) -> list[int]:
    for preset in PRESETS:
        if len(preset.tuning_midi) == strings:
            return list(preset.tuning_midi)
    return [64 - 5 * index for index in range(strings)]


def _read_part(part: ET.Element, names: dict[str, str], index: int) -> _Part:
    divisions = 1
    signature = (4, 4)
    tuning_by_line: dict[int, int] = {}
    capo = 0
    tab_staff: str | None = None
    opening_tempo: float | None = None
    bars: list[Bar] = []
    track_bars: list[TrackBar] = []
    has_tab = False
    highest_string = 0
    marks: defaultdict[int, set[str]] = defaultdict(set)

    for measure_index, measure in enumerate(_children(part, "measure")):
        bar_fields: dict[str, Any] = {}
        tempo: float | None = None
        cursor = 0
        last_start = 0
        voices: dict[str, dict[int, _Event]] = defaultdict(dict)
        for element in measure:
            tag = _local(element.tag)
            if tag == "attributes":
                divisions = max(1, _int(_child(element, "divisions"), divisions))
                time = _child(element, "time")
                if time is not None and _text(_child(time, "beats")) and _text(_child(time, "beat-type")):
                    beats_text = _text(_child(time, "beats")).split("+")[0]
                    signature = (int(beats_text), _int(_child(time, "beat-type"), 4))
                for details in _children(element, "staff-details"):
                    lines = _children(details, "staff-tuning")
                    if lines:
                        tab_staff = details.attrib.get("number", "1")
                        for line in lines:
                            step = _text(_child(line, "tuning-step"))
                            if step:
                                tuning_by_line[int(line.attrib.get("line", "1"))] = _midi(
                                    step, _int(_child(line, "tuning-alter")), _int(_child(line, "tuning-octave"))
                                )
                    capo = _int(_child(details, "capo"), capo)
            elif tag == "backup":
                cursor = max(0, cursor - _ticks(element, divisions))
            elif tag == "forward":
                cursor += _ticks(element, divisions)
            elif tag == "direction":
                marks[measure_index] |= _direction_marks(element)
                rehearsal = element.find(".//{*}rehearsal")
                if rehearsal is None:
                    rehearsal = element.find(".//rehearsal")
                if rehearsal is not None and _text(rehearsal):
                    bar_fields["section"] = _text(rehearsal)
                tempo = tempo or _sound_tempo(element)
            elif tag == "sound":
                marks[measure_index] |= _sound_marks(element)
                tempo = tempo or _sound_tempo(element)
            elif tag == "barline":
                repeat = _child(element, "repeat")
                if repeat is not None:
                    if repeat.attrib.get("direction") == "forward":
                        bar_fields["repeat_start"] = True
                    elif repeat.attrib.get("direction") == "backward":
                        bar_fields["repeat_end"] = int(repeat.attrib.get("times", "2"))
                ending = _child(element, "ending")
                if ending is not None and ending.attrib.get("type") == "start":
                    numbers = [
                        int(item) for item in ending.attrib.get("number", "").replace(" ", "").split(",") if item
                    ]
                    bar_fields["alternate_endings"] = numbers
            elif tag == "note":
                chord = _child(element, "chord") is not None
                grace = _child(element, "grace") is not None
                ticks = 0 if grace else _ticks(element, divisions)
                start = last_start if chord else cursor
                if not chord:
                    last_start = start
                    cursor += ticks
                staff = _text(_child(element, "staff")) or "1"
                if tab_staff is not None and staff != tab_staff:
                    continue
                voice_id = _text(_child(element, "voice")) or "1"
                note = _note(element)
                if note is not None:
                    has_tab = True
                    highest_string = max(highest_string, note.string + 1)
                key = start * 2 + (1 if not grace else 0)
                event = voices[voice_id].get(key)
                if event is None:
                    duration = ticks or _TYPE_TICKS.get(_text(_child(element, "type")), TICKS_PER_QUARTER // 4)
                    event = _Event(
                        start=start,
                        duration=duration,
                        grace=_grace_kind(element) if grace else None,
                        tuplet=_tuplet(element),
                    )
                    voices[voice_id][key] = event
                if note is not None:
                    event.notes.append(note)
        if tempo is not None:
            if measure_index == 0:
                opening_tempo = tempo
            else:
                bar_fields["tempo"] = tempo
        bars.append(Bar(signature=signature, **bar_fields))
        track_bars.append(
            TrackBar(
                voices=[
                    Voice(
                        beats=[
                            Beat(
                                position=event.start,
                                duration=max(1, event.duration),
                                notes=sorted(event.notes, key=lambda item: item.string),
                                grace=event.grace,  # type: ignore[arg-type]
                                tuplet=event.tuplet,
                            )
                            for _key, event in sorted(events.items())
                        ]
                    )
                    for _voice, events in sorted(voices.items())
                ]
                or [Voice()]
            )
        )

    for bar, directions in zip(bars, _directions([marks[index] for index in range(len(bars))]), strict=True):
        bar.directions = directions  # type: ignore[assignment]
    if tuning_by_line:
        tuning = [tuning_by_line[line] for line in sorted(tuning_by_line, reverse=True)]
    else:
        tuning = _guess_tuning(max(highest_string, 1))
    if len(tuning) < highest_string:
        tuning = _guess_tuning(highest_string)
    name = names.get(part.attrib.get("id", "")) or f"Track {index + 1}"
    return _Part(
        name=name,
        tuning=tuning,
        capo=capo,
        bars=bars or [Bar()],
        track_bars=track_bars or [TrackBar()],
        opening_tempo=opening_tempo,
        has_tab=has_tab,
    )


def _ticks(element: ET.Element, divisions: int) -> int:
    return round(_int(_child(element, "duration")) * TICKS_PER_QUARTER / divisions)


def _sound_tempo(element: ET.Element) -> float | None:
    sound = element if _local(element.tag) == "sound" else _child(element, "sound")
    if sound is None or not sound.attrib.get("tempo"):
        return None
    try:
        tempo = float(sound.attrib["tempo"])
    except ValueError:
        return None
    return tempo if 0 < tempo < 400 else None


_SEGNO_IDS = {"segnosegno", "segno2", "doublesegno"}
_CODA_IDS = {"doublecoda", "coda2"}


def _target_id(value: str) -> str:
    return value.lower().replace("_", "").replace(" ", "").replace("-", "")


def _sound_marks(sound: ET.Element) -> set[str]:
    """Navigation marks from a ``<sound>`` element's ``segno``, ``coda``, ``dalsegno``, ``dacapo``, ``fine``..."""
    marks: set[str] = set()
    attrib = sound.attrib
    if "segno" in attrib:
        marks.add("segno_segno" if _target_id(attrib["segno"]) in _SEGNO_IDS else "segno")
    if "coda" in attrib:
        marks.add("double_coda" if _target_id(attrib["coda"]) in _CODA_IDS else "coda")
    if "dalsegno" in attrib:
        marks.add("dss" if _target_id(attrib["dalsegno"]) in _SEGNO_IDS else "ds")
    if attrib.get("dacapo") == "yes":
        marks.add("dc")
    if "fine" in attrib:
        marks.add("fine")
    if "tocoda" in attrib:
        marks.add("to_double_coda" if _target_id(attrib["tocoda"]) in _CODA_IDS else "to_coda")
    return marks


def _words_marks(text: str) -> set[str]:
    """Navigation marks from direction text such as ``D.C. al Fine`` or ``To Coda``."""
    words = " ".join(text.lower().replace(".", " ").split())
    marks: set[str] = set()
    if "d s s" in words or "dal segno segno" in words:
        marks.add("dss")
    elif re.search(r"\bd s\b", words) or "dal segno" in words:
        marks.add("ds")
    if re.search(r"\bd c\b", words) or "da capo" in words:
        marks.add("dc")
    if "to coda" in words:
        marks.add("to_coda")
    if "to double coda" in words:
        marks.add("to_double_coda")
    if words == "fine":
        marks.add("fine")
    if "al double coda" in words:
        marks.add("al_double_coda")
    elif "al coda" in words:
        marks.add("al_coda")
    if "al fine" in words:
        marks.add("al_fine")
    return marks


def _direction_marks(direction: ET.Element) -> set[str]:
    marks: set[str] = set()
    for kind in _children(direction, "direction-type"):
        for item in kind:
            tag = _local(item.tag)
            if tag == "segno":
                marks.add("segno")
            elif tag == "coda":
                marks.add("coda")
            elif tag == "words":
                marks |= _words_marks(_text(item))
    sound = _child(direction, "sound")
    if sound is not None:
        marks |= _sound_marks(sound)
    return marks


def _directions(marks: list[set[str]]) -> list[list[str]]:
    """Fretbook bar directions from each measure's marks.

    MusicXML says *that* a bar jumps; whether it is ``al Coda`` or ``al Fine`` comes from the words
    on that bar, or else from which targets the part has.
    """
    everything = set().union(*marks) if marks else set()
    if "al_double_coda" in everything or "to_double_coda" in everything:
        fallback = "al_double_coda"
    elif "al_coda" in everything or "to_coda" in everything:
        fallback = "al_coda"
    elif "al_fine" in everything or "fine" in everything:
        fallback = "al_fine"
    else:
        fallback = ""
    result: list[list[str]] = []
    for own in marks:
        found: list[str] = []
        for mark, target in (
            ("segno", "segno"),
            ("segno_segno", "segno_segno"),
            ("coda", "coda"),
            ("double_coda", "double_coda"),
            ("fine", "fine"),
        ):
            if mark in own:
                found.append(target)
        if "to_coda" in own:
            found.append("da_coda")
        if "to_double_coda" in own:
            found.append("da_double_coda")
        suffix = next((item for item in ("al_double_coda", "al_coda", "al_fine") if item in own), fallback)
        for mark, base in (("dc", "da_capo"), ("ds", "dal_segno"), ("dss", "dal_segno_segno")):
            if mark in own:
                found.append(f"{base}_{suffix}" if suffix else base)
        result.append(found)
    return result


def _grace_kind(element: ET.Element) -> str:
    grace = _child(element, "grace")
    if grace is not None and grace.attrib.get("slash") == "yes":
        return "before_beat"
    return "on_beat"


def _tuplet(element: ET.Element) -> int | None:
    modification = _child(element, "time-modification")
    actual = _int(_child(modification, "actual-notes"))
    return actual if 2 <= actual <= 16 else None


def _note(element: ET.Element) -> Note | None:
    if _child(element, "rest") is not None:
        return None
    notations = _child(element, "notations")
    technical = _child(notations, "technical")
    string_text = _text(_child(technical, "string"))
    fret_text = _text(_child(technical, "fret"))
    if not string_text or not fret_text:
        return None
    notehead = _child(element, "notehead")
    harmonic = _child(technical, "harmonic")
    bend_alter = _child(_child(technical, "bend"), "bend-alter")
    ornaments = _child(notations, "ornaments")
    articulations = _child(notations, "articulations")
    ties = [tie.attrib.get("type") for tie in _children(element, "tie")]
    slide: str | None = None
    if _child(notations, "slide") is not None:
        slide = "legato"
    elif _child(notations, "glissando") is not None:
        slide = "shift"
    bend: float | None = None
    if bend_alter is not None:
        try:
            value = abs(float(_text(bend_alter)))
            bend = min(value, 4.0) if value > 0 else None
        except ValueError:
            bend = None
    return Note(
        string=max(0, int(string_text) - 1),
        fret=max(0, min(99, int(fret_text))),
        dead=_text(notehead) == "x",
        ghost=notehead is not None and notehead.attrib.get("parentheses") == "yes",
        tie="stop" in ties,
        hammer=any(
            item is not None and item.attrib.get("type", "start") == "start"
            for item in (_child(technical, "hammer-on"), _child(technical, "pull-off"))
        ),
        slide=slide,  # type: ignore[arg-type]
        vibrato=ornaments is not None
        and (_child(ornaments, "wavy-line") is not None or _child(ornaments, "vibrato") is not None),
        harmonic=("artificial" if _child(harmonic, "artificial") is not None else "natural")
        if harmonic is not None
        else None,
        bend=bend,
        staccato=_child(articulations, "staccato") is not None,
    )
