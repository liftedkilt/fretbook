"""A small MusicXML tablature importer.

Only string/fret notes are accepted. Standard notation without ``<technical>``
is rejected so we do not invent a fingering. Guitar Pro files are not parsed
here; alphaTab reads those in the browser.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path

from fretbook.importers.base import ImportError, ImportRequest, ImportResult, Progress
from fretbook.score.model import Beat, Measure, Note, ScoreDocument, TempoMark, Track, Voice
from fretbook.score.tuning import midi_to_name

_STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _child(element: ET.Element, name: str) -> ET.Element | None:
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


def _midi(step: str, alter: int, octave: int) -> int:
    return (octave + 1) * 12 + _STEP[step.upper()] + alter


class MusicXmlImporter:
    kind = "musicxml"

    def can_handle(self, request: ImportRequest) -> bool:
        name = (request.filename or "").lower()
        return name.endswith((".musicxml", ".xml"))

    def import_score(self, request: ImportRequest, progress: Progress) -> ImportResult:
        if request.file_path is None:
            raise ImportError("MusicXML import needs a file")
        progress("Reading MusicXML", "import.readingFile")
        try:
            root = ET.parse(request.file_path).getroot()
        except ET.ParseError as exc:
            raise ImportError("MusicXML file could not be parsed") from exc
        if _local(root.tag) not in {"score-partwise", "score-timewise"}:
            raise ImportError("expected a MusicXML score-partwise or score-timewise document")
        if _local(root.tag) == "score-timewise":
            raise ImportError("score-timewise MusicXML is not imported yet; save as score-partwise")
        title, artist = _credits(root)
        part_names = _part_names(root)
        tracks: list[Track] = []
        tempos: list[TempoMark] = []
        for index, part in enumerate(_children(root, "part")):
            track, part_tempos = _part_to_track(part, part_names, index)
            tracks.append(track)
            if not tempos:
                tempos = part_tempos
        if not tracks:
            raise ImportError("this MusicXML file has no tablature string/fret data")
        tracks[0].preferred = True
        bpm = tempos[0].bpm if tempos else 120.0
        if not tempos:
            tempos = [TempoMark(bpm=bpm, measure=0)]
        slug = Path(request.filename or request.file_path.name).stem
        slug = "".join(ch.lower() if ch.isalnum() else "-" for ch in slug).strip("-") or "song"
        progress("Tab ready", "import.tabReady")
        return ImportResult(
            title=title or slug,
            artist=artist,
            slug=slug[:60],
            document=ScoreDocument(bpm=bpm, tempos=tempos, tracks=tracks),
            source_kind="musicxml",
            source_ref={"filename": request.filename or request.file_path.name},
        )


def _credits(root: ET.Element) -> tuple[str, str]:
    work = _child(root, "work")
    title = _text(_child(work if work is not None else root, "work-title"))
    artist = ""
    identification = _child(root, "identification")
    if identification is not None:
        for creator in _children(identification, "creator"):
            if creator.attrib.get("type", "composer") in {"composer", "artist"} or not artist:
                artist = _text(creator) or artist
                if creator.attrib.get("type") in {"composer", "artist"}:
                    break
    return title, artist


def _part_names(root: ET.Element) -> dict[str, str]:
    names: dict[str, str] = {}
    part_list = _child(root, "part-list")
    if part_list is None:
        return names
    for score_part in _children(part_list, "score-part"):
        names[score_part.attrib.get("id", "")] = _text(_child(score_part, "part-name"))
    return names


def _part_to_track(
    part: ET.Element, names: dict[str, str], index: int
) -> tuple[Track, list[TempoMark]]:
    part_id = part.attrib.get("id", str(index))
    tuning: list[int] = []
    divisions = 1
    signature = (4, 4)
    measures: list[Measure] = []
    tempos: list[TempoMark] = []
    saw_fret = False
    for measure_index, raw in enumerate(_children(part, "measure")):
        divisions, signature, tuning, tempo = _attributes(raw, divisions, signature, tuning)
        if tempo is not None:
            tempos.append(TempoMark(bpm=tempo, measure=measure_index))
        beats, found = _measure_beats(raw, divisions)
        saw_fret = saw_fret or found
        measures.append(Measure(signature=signature, voices=[Voice(beats=beats)]))
    if not saw_fret:
        raise ImportError("this MusicXML file has no tablature string/fret data")
    if not tuning:
        highest = 0
        for measure in measures:
            for beat in measure.voices[0].beats:
                for note in beat.notes:
                    highest = max(highest, note.string + 1)
        tuning = [40 - (5 * string) for string in range(max(highest, 1))]
    name = names.get(part_id) or f"Track {index + 1}"
    instrument = "bass-guitar" if len(tuning) <= 5 else "guitar"
    track = Track(
        id=f"trk_xml_{index}",
        name=name,
        instrument=instrument,
        tuning_midi=tuning,
        preferred=index == 0,
        measures=measures or [Measure()],
    )
    return track, tempos


def _attributes(
    measure: ET.Element,
    divisions: int,
    signature: tuple[int, int],
    tuning: list[int],
) -> tuple[int, tuple[int, int], list[int], float | None]:
    tempo: float | None = None
    for element in measure.iter():
        if _local(element.tag) == "divisions" and element.text:
            divisions = max(1, int(element.text))
        elif _local(element.tag) == "time":
            beats = _text(_child(element, "beats"))
            beat_type = _text(_child(element, "beat-type"))
            if beats and beat_type:
                signature = (int(beats), int(beat_type))
        elif _local(element.tag) == "staff-tuning":
            line = int(element.attrib.get("line", "1"))
            step = _text(_child(element, "tuning-step"))
            octave = int(_text(_child(element, "tuning-octave")) or "0")
            alter = int(_text(_child(element, "tuning-alter")) or "0")
            if step:
                while len(tuning) < line:
                    tuning.append(0)
                tuning[line - 1] = _midi(step, alter, octave)
        elif _local(element.tag) == "sound" and element.attrib.get("tempo"):
            tempo = float(element.attrib["tempo"])
    return divisions, signature, tuning, tempo


def _measure_beats(measure: ET.Element, divisions: int) -> tuple[list[Beat], bool]:
    beats: list[Beat] = []
    position = 0.0
    found = False
    pending: list[Note] = []
    pending_quarters = 0.0
    for element in list(measure):
        if _local(element.tag) != "note":
            continue
        if _child(element, "chord") is None and pending:
            beats.append(
                Beat(position=round(position, 4), duration=round(max(pending_quarters, 0.01), 4), notes=pending)
            )
            position += pending_quarters
            pending = []
        duration = int(_text(_child(element, "duration")) or "0")
        quarters = duration / divisions if divisions else 0
        technical = _technical(element)
        if _child(element, "rest") is not None or technical is None:
            if _child(element, "chord") is None:
                pending_quarters = quarters or pending_quarters or 1
                if not pending:
                    beats.append(
                        Beat(
                            position=round(position, 4),
                            duration=round(max(quarters or 1, 0.01), 4),
                            rest=True,
                        )
                    )
                    position += quarters or 1
                    pending_quarters = 0
            continue
        string_number, fret = technical
        found = True
        pending.append(Note(string=string_number - 1, fret=fret))
        pending_quarters = quarters or pending_quarters or 1
    if pending:
        beats.append(
            Beat(
                position=round(position, 4),
                duration=round(max(pending_quarters, 0.01), 4),
                notes=pending,
            )
        )
    return beats, found


def _technical(note: ET.Element) -> tuple[int, int] | None:
    notations = _child(note, "notations")
    if notations is None:
        return None
    technical = _child(notations, "technical")
    if technical is None:
        return None
    string_text = _text(_child(technical, "string"))
    fret_text = _text(_child(technical, "fret"))
    if not string_text or fret_text == "":
        return None
    return int(string_text), int(fret_text)


def tuning_label(midi: int) -> str:
    return midi_to_name(midi)
