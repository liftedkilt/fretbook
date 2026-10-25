"""MuseScore (``.mscx`` and compressed ``.mscz``) importer.

MuseScore 2, 3 and 4 store scores as an XML tree rooted at ``<museScore>``. A ``.mscz`` file is a
ZIP archive holding the ``.mscx`` score (usually named in ``META-INF/container.xml``).

Conventions:

* ``<StringData>`` lists open-string MIDI pitches from **lowest** string to highest; Fretbook stores
  ``tuning_midi`` highest string first, so ascending string lists are reversed.
* ``<Note><string>0</string>`` is already the highest string (0-based), matching Fretbook.
* When a non-drum part has ``<Note><pitch>`` without ``<string>``/``<fret>``, frets are placed with
  :func:`fretbook.score.fingering.assign_frets` on the part's string data or a matching preset.
* ``<Tempo><tempo>`` is stored in quarter notes per second in MuseScore (``2.0`` = 120 BPM).
"""

from __future__ import annotations

import io
import statistics
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from xml.etree.ElementTree import Element

from fretbook.importers.base import ImportError, ImportRequest, ImportResult, Progress
from fretbook.importers.midi import suggest_preset
from fretbook.importers.musicxml import _directions, _words_marks
from fretbook.score.fingering import assign_frets
from fretbook.score.instruments import canonical_instrument, get_preset
from fretbook.score.model import (
    TICKS_PER_QUARTER,
    Bar,
    Beat,
    Note,
    ScoreDocument,
    SlideKind,
    Track,
    TrackBar,
    Voice,
)

EXTENSIONS = (".mscx", ".mscz")
MAX_MSCZ_BYTES = 50 * 1024 * 1024
"""Largest uncompressed ``.mscx`` a ``.mscz`` archive may unpack to."""

MAX_CONTAINER_BYTES = 1024 * 1024

_DURATION_TICKS: dict[str, int] = {
    "long": 16 * TICKS_PER_QUARTER,
    "breve": 8 * TICKS_PER_QUARTER,
    "whole": 4 * TICKS_PER_QUARTER,
    "half": 2 * TICKS_PER_QUARTER,
    "quarter": TICKS_PER_QUARTER,
    "eighth": TICKS_PER_QUARTER // 2,
    "16th": TICKS_PER_QUARTER // 4,
    "32nd": TICKS_PER_QUARTER // 8,
    "64th": TICKS_PER_QUARTER // 16,
    "128th": TICKS_PER_QUARTER // 32,
}

_GRACE_BEFORE = {"acciaccatura", "grace8", "grace16", "grace32", "grace8after", "grace16after", "grace32after"}
_GRACE_ON = {"appoggiatura", "grace4"}


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _child(element: Element | None, name: str) -> Element | None:
    if element is None:
        return None
    for child in element:
        if _local(child.tag) == name:
            return child
    return None


def _children(element: Element | None, name: str) -> list[Element]:
    if element is None:
        return []
    return [child for child in element if _local(child.tag) == name]


def _text(element: Element | None) -> str:
    if element is None:
        return ""
    return "".join(element.itertext()).strip()


def _int(element: Element | None, default: int = 0) -> int:
    try:
        return int(float(_text(element)))
    except ValueError:
        return default


def _open_mscx(path: Path) -> bytes:
    raw = path.read_bytes()
    if raw[:4] != b"PK\x03\x04":
        if len(raw) > MAX_MSCZ_BYTES:
            raise ImportError("this MuseScore file is larger than 50 MB", "musescore.tooLarge")
        return raw
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            names = archive.namelist()
            target: str | None = None
            if "META-INF/container.xml" in names:
                with archive.open("META-INF/container.xml") as handle:
                    container_bytes = handle.read(MAX_CONTAINER_BYTES + 1)[:MAX_CONTAINER_BYTES]
                container = ET.fromstring(container_bytes)
                for elem in container.iter():
                    if _local(elem.tag) == "rootfile":
                        full_path = elem.get("full-path", "")
                        if full_path.lower().endswith(".mscx") and full_path in names:
                            target = full_path
                            break
            if target is None:
                candidates = [
                    name for name in names if name.lower().endswith(".mscx") and not name.startswith("__MACOSX/")
                ]
                if candidates:
                    target = candidates[0]
            if target is None:
                raise ImportError("this .mscz archive has no .mscx score inside", "musescore.parse")
            info = archive.getinfo(target)
            if info.file_size > MAX_MSCZ_BYTES:
                raise ImportError("this .mscz unpacks to more than 50 MB", "musescore.tooLarge")
            with archive.open(info) as handle:
                content = handle.read(MAX_MSCZ_BYTES + 1)
            if len(content) > MAX_MSCZ_BYTES:
                raise ImportError("this .mscz unpacks to more than 50 MB", "musescore.tooLarge")
            return content
    except ImportError:
        raise
    except (zipfile.BadZipFile, KeyError, ET.ParseError) as exc:
        raise ImportError("MuseScore file could not be parsed", "musescore.parse") from exc


@dataclass
class _RawNote:
    pitch: int | None
    string: int | None
    fret: int | None
    dead: bool = False
    tie: bool = False
    ghost: bool = False
    hammer: bool = False
    slide: SlideKind | None = None
    vibrato: bool = False
    harmonic: str | None = None
    bend: float | None = None
    palm_mute: bool = False
    let_ring: bool = False
    staccato: bool = False


@dataclass
class _RawBeat:
    position: int
    duration: int
    notes: list[_RawNote] = field(default_factory=list)
    grace: str | None = None
    tuplet: int | None = None


@dataclass
class _PartMeta:
    name: str
    staff_ids: list[str]
    tuning: list[int]
    capo: int
    program: int | None
    instrument_id: str
    is_drum: bool


@dataclass
class _ParsedStaff:
    bars: list[Bar]
    voices_per_bar: list[list[list[_RawBeat]]]
    opening_tempo: float | None
    has_tab: bool
    pitches: list[int]
    max_string: int


class MuseScoreImporter:
    kind = "musescore"

    def can_handle(self, request: ImportRequest) -> bool:
        name = (request.filename or "").lower()
        return name.endswith(EXTENSIONS)

    def import_score(self, request: ImportRequest, progress: Progress) -> ImportResult:
        if request.file_path is None:
            raise ImportError("MuseScore import needs a file", "import.needsFile")
        progress("Reading MuseScore file", "import.readingFile")
        raw = _open_mscx(request.file_path)
        try:
            root = ET.fromstring(raw)
        except ET.ParseError as exc:
            raise ImportError("MuseScore file could not be parsed", "musescore.parse") from exc

        if _local(root.tag) == "museScore":
            score_child = _child(root, "Score")
            score = score_child if score_child is not None else root
        elif _local(root.tag) == "Score":
            score = root
        else:
            raise ImportError("expected a MuseScore <museScore> document", "musescore.notMuseScore")

        title, artist = _metadata(score)
        part_metas = _read_part_metas(score)
        staff_elements: dict[str, Element] = {}
        for staff_el in _children(score, "Staff"):
            if _children(staff_el, "Measure"):
                sid = staff_el.attrib.get("id", "1")
                staff_elements[sid] = staff_el

        if not part_metas and staff_elements:
            part_metas = [
                _PartMeta(
                    name=f"Track {idx + 1}",
                    staff_ids=[sid],
                    tuning=[],
                    capo=0,
                    program=None,
                    instrument_id="",
                    is_drum=False,
                )
                for idx, sid in enumerate(staff_elements)
            ]

        prefer = str(request.options.get("prefer") or "")
        tracks: list[Track] = []
        master_bars: list[Bar] = []
        opening_tempo: float | None = None

        for part_meta in part_metas:
            if part_meta.is_drum:
                continue
            parsed_staves = [_parse_staff(staff_elements[sid]) for sid in part_meta.staff_ids if sid in staff_elements]
            if not parsed_staves:
                continue

            tab_staves = [ps for ps in parsed_staves if ps.has_tab]
            chosen_staves = tab_staves if tab_staves else parsed_staves

            first_staff = chosen_staves[0]
            if not master_bars and first_staff.bars:
                master_bars = first_staff.bars
            if opening_tempo is None and first_staff.opening_tempo is not None:
                opening_tempo = first_staff.opening_tempo

            has_notes = any(
                beat.notes
                for ps in chosen_staves
                for bar_voices in ps.voices_per_bar
                for voice_beats in bar_voices
                for beat in voice_beats
            )
            if not has_notes:
                continue

            track = _build_track(
                part_meta=part_meta,
                chosen_staves=chosen_staves,
                index=len(tracks),
                prefer=prefer,
            )
            tracks.append(track)

        if not tracks or not master_bars:
            raise ImportError("this MuseScore file has no playable notes", "musescore.noNotes")

        for track in tracks:
            if len(track.bars) < len(master_bars):
                track.bars.extend(TrackBar() for _ in range(len(master_bars) - len(track.bars)))
            elif len(track.bars) > len(master_bars):
                track.bars = track.bars[: len(master_bars)]

        preferred_idx = _preferred_track_index(tracks, prefer)
        for idx, track in enumerate(tracks):
            track.preferred = idx == preferred_idx

        bpm = opening_tempo or 120.0
        slug_source = Path(request.filename or request.file_path.name).stem
        if slug_source.lower().endswith(".mscx"):
            slug_source = Path(slug_source).stem
        slug = "".join(ch.lower() if ch.isalnum() else "-" for ch in slug_source).strip("-") or "song"
        progress("Tab ready", "import.tabReady")
        return ImportResult(
            title=title or slug,
            artist=artist,
            slug=slug[:60],
            document=ScoreDocument(bpm=bpm, bars=master_bars, tracks=tracks),
            source_kind="musescore",
            source_ref={"filename": request.filename or request.file_path.name},
        )


def _preferred_track_index(tracks: list[Track], prefer: str) -> int:
    if prefer:
        for index, track in enumerate(tracks):
            is_bass = track.instrument == "bass-guitar" or len(track.tuning_midi) <= 5
            if is_bass == (prefer == "bass"):
                return index
    return 0


def _metadata(score: Element) -> tuple[str, str]:
    tags: dict[str, str] = {}
    for meta in _children(score, "metaTag"):
        name = meta.attrib.get("name", "")
        value = _text(meta)
        if name and value:
            tags[name] = value

    title = tags.get("workTitle") or tags.get("movementTitle") or ""
    artist = tags.get("composer") or tags.get("artist") or tags.get("lyricist") or tags.get("arranger") or ""

    if not title or not artist:
        for elem in score.iter():
            if _local(elem.tag) == "VBox":
                for text_el in _children(elem, "Text"):
                    style = _text(_child(text_el, "style")).lower()
                    val = _text(_child(text_el, "text"))
                    if not val:
                        continue
                    if style == "title" and not title:
                        title = val
                    elif style in {"composer", "subtitle", "lyricist"} and not artist:
                        artist = val
    return title, artist


def _read_part_metas(score: Element) -> list[_PartMeta]:
    metas: list[_PartMeta] = []
    for index, part in enumerate(_children(score, "Part")):
        staff_ids: list[str] = []
        for staff in _children(part, "Staff"):
            sid = staff.attrib.get("id")
            if sid:
                staff_ids.append(sid)
        instrument = _child(part, "Instrument")
        name = (
            _text(_child(part, "trackName"))
            or _text(_child(instrument, "trackName"))
            or _text(_child(instrument, "longName"))
            or f"Track {index + 1}"
        )
        is_drum = _text(_child(instrument, "useDrumset")) == "1" or bool(_children(instrument, "Drum"))
        instrument_id = _text(_child(instrument, "instrumentId"))
        program: int | None = None
        channel = _child(instrument, "Channel")
        if channel is not None:
            prog_el = _child(channel, "program")
            if prog_el is not None:
                val = prog_el.attrib.get("value") or _text(prog_el)
                if val.isdigit():
                    program = int(val)

        tuning: list[int] = []
        capo = 0
        string_data = _child(instrument, "StringData")
        if string_data is not None:
            raw_strings: list[int] = []
            for s_el in _children(string_data, "string"):
                pitch_attr = s_el.attrib.get("pitch")
                pitch_val = int(pitch_attr) if pitch_attr and pitch_attr.isdigit() else _int(s_el, -1)
                if pitch_val >= 0:
                    raw_strings.append(pitch_val)
            if len(raw_strings) >= 2 and raw_strings[0] < raw_strings[-1]:
                raw_strings.reverse()
            tuning = raw_strings
        capo_el = _child(part, "capo") or _child(instrument, "capo")
        if capo_el is not None:
            capo = max(0, min(24, _int(capo_el, 0)))

        metas.append(
            _PartMeta(
                name=name,
                staff_ids=staff_ids,
                tuning=tuning,
                capo=capo,
                program=program,
                instrument_id=instrument_id,
                is_drum=is_drum,
            )
        )
    return metas


def _parse_fraction(text: str) -> float | None:
    if "/" not in text:
        try:
            return float(text)
        except ValueError:
            return None
    parts = text.split("/", 1)
    try:
        num = float(parts[0])
        den = float(parts[1])
        return num / den if den != 0 else None
    except ValueError:
        return None


def _duration_ticks(element: Element, bar_length: int) -> int:
    dtype = _text(_child(element, "durationType"))
    if dtype == "measure":
        dur_text = _text(_child(element, "duration"))
        frac = _parse_fraction(dur_text) if dur_text else None
        if frac is not None and frac > 0:
            return max(1, round(4 * TICKS_PER_QUARTER * frac))
        return bar_length
    base = _DURATION_TICKS.get(dtype, TICKS_PER_QUARTER)
    dots = _int(_child(element, "dots"), 0)
    total = base
    add = base
    for _ in range(max(0, min(dots, 3))):
        add //= 2
        total += add
    return max(1, total)


def _parse_staff(staff: Element) -> _ParsedStaff:
    signature = (4, 4)
    opening_tempo: float | None = None
    bars: list[Bar] = []
    voices_per_bar: list[list[list[_RawBeat]]] = []
    has_tab = False
    pitches: list[int] = []
    max_string = 0
    marks: defaultdict[int, set[str]] = defaultdict(set)
    volta_by_bar: dict[int, list[int]] = {}
    open_ties_by_key: set[tuple[int | None, int | None]] = set()

    measures = _children(staff, "Measure")
    for m_idx, measure in enumerate(measures):
        bar_fields: dict[str, Any] = {}
        tempo: float | None = None

        if _child(measure, "startRepeat") is not None:
            bar_fields["repeat_start"] = True
        end_rep = _child(measure, "endRepeat")
        if end_rep is not None:
            bar_fields["repeat_end"] = max(2, _int(end_rep, 2))

        for spanner in _children(measure, "Spanner"):
            _read_volta_spanner(spanner, m_idx, volta_by_bar)

        for marker in _children(measure, "Marker") + _children(measure, "Jump"):
            marks[m_idx] |= _marker_marks(marker)

        voice_elements = _children(measure, "voice")
        if not voice_elements:
            voice_elements = [measure]

        bar_voices: list[list[_RawBeat]] = []
        for v_el in voice_elements:
            cursor = 0
            tuplet_defs: dict[str, tuple[int, int]] = {}
            active_tuplet: tuple[int, int] | None = None
            beats: list[_RawBeat] = []

            for item in v_el:
                tag = _local(item.tag)
                if tag == "TimeSig":
                    sig_n = _int(_child(item, "sigN"), signature[0])
                    sig_d = _int(_child(item, "sigD"), signature[1])
                    if 1 <= sig_n <= 32 and sig_d in {1, 2, 4, 8, 16, 32}:
                        signature = (sig_n, sig_d)
                elif tag == "Tempo":
                    t_val = _extract_tempo(item)
                    if t_val is not None:
                        tempo = tempo or t_val
                elif tag == "startRepeat":
                    bar_fields["repeat_start"] = True
                elif tag == "endRepeat":
                    bar_fields["repeat_end"] = max(2, _int(item, 2))
                elif tag in {"RehearsalMark", "SystemText", "StaffText"}:
                    sec_text = _text(_child(item, "text"))
                    if sec_text and "section" not in bar_fields:
                        bar_fields["section"] = sec_text
                elif tag in {"Marker", "Jump"}:
                    marks[m_idx] |= _marker_marks(item)
                elif tag == "Spanner":
                    _read_volta_spanner(item, m_idx, volta_by_bar)
                elif tag == "Tuplet":
                    normal = _int(_child(item, "normalNotes"), 2)
                    actual = _int(_child(item, "actualNotes"), 3)
                    if normal > 0 and actual > 0:
                        tup = (actual, normal)
                        tid = item.attrib.get("id")
                        if tid:
                            tuplet_defs[tid] = tup
                        active_tuplet = tup
                elif tag == "endTuplet":
                    active_tuplet = None
                elif tag == "location":
                    frac_text = _text(_child(item, "fractions"))
                    frac = _parse_fraction(frac_text) if frac_text else None
                    if frac is not None:
                        cursor = max(0, cursor + round(4 * TICKS_PER_QUARTER * frac))
                elif tag in {"Rest", "Chord"}:
                    bar_len = 4 * TICKS_PER_QUARTER * signature[0] // signature[1]
                    grace_kind = _chord_grace(item) if tag == "Chord" else None
                    ticks = _duration_ticks(item, bar_len)

                    tuplet_info = active_tuplet
                    tup_ref = _text(_child(item, "Tuplet"))
                    if tup_ref and tup_ref in tuplet_defs:
                        tuplet_info = tuplet_defs[tup_ref]

                    tuplet_hint: int | None = None
                    if tuplet_info is not None and grace_kind is None:
                        actual, normal = tuplet_info
                        ticks = max(1, round(ticks * normal / actual))
                        if 2 <= actual <= 16:
                            tuplet_hint = actual

                    if tag == "Rest":
                        beats.append(
                            _RawBeat(
                                position=cursor,
                                duration=ticks,
                                notes=[],
                                tuplet=tuplet_hint,
                            )
                        )
                        cursor += ticks
                    else:
                        raw_notes = _read_chord_notes(item, open_ties_by_key)
                        for rn in raw_notes:
                            if rn.string is not None and rn.fret is not None:
                                has_tab = True
                                max_string = max(max_string, rn.string + 1)
                            if rn.pitch is not None:
                                pitches.append(rn.pitch)
                        beats.append(
                            _RawBeat(
                                position=cursor,
                                duration=ticks,
                                notes=raw_notes,
                                grace=grace_kind,
                                tuplet=tuplet_hint,
                            )
                        )
                        if grace_kind is None:
                            cursor += ticks

            if beats:
                bar_voices.append(beats)

        if m_idx in volta_by_bar:
            bar_fields["alternate_endings"] = volta_by_bar[m_idx]
        if tempo is not None:
            if m_idx == 0:
                opening_tempo = tempo
            else:
                bar_fields["tempo"] = tempo

        bars.append(Bar(signature=signature, **bar_fields))
        voices_per_bar.append(bar_voices or [[]])

    for bar, directions in zip(bars, _directions([marks[idx] for idx in range(len(bars))]), strict=True):
        bar.directions = directions  # type: ignore[assignment]

    return _ParsedStaff(
        bars=bars,
        voices_per_bar=voices_per_bar,
        opening_tempo=opening_tempo,
        has_tab=has_tab,
        pitches=pitches,
        max_string=max_string,
    )


def _extract_tempo(tempo_el: Element) -> float | None:
    raw_text = _text(_child(tempo_el, "tempo"))
    if not raw_text:
        return None
    try:
        val = float(raw_text)
    except ValueError:
        return None
    if val <= 0:
        return None
    bpm = round(val * 60.0, 2) if val <= 10.0 else round(val, 2)
    if abs(bpm - round(bpm)) < 0.05:
        bpm = float(round(bpm))
    return bpm if 0 < bpm < 400 else None


def _read_volta_spanner(spanner: Element, m_idx: int, volta_by_bar: dict[int, list[int]]) -> None:
    if spanner.attrib.get("type") != "Volta":
        return
    if _child(spanner, "prev") is not None and _child(spanner, "Volta") is None:
        return
    volta = _child(spanner, "Volta")
    if volta is None:
        return
    endings_text = _text(_child(volta, "endings"))
    endings = [int(tok) for tok in endings_text.replace(" ", "").split(",") if tok.isdigit() and 1 <= int(tok) <= 32]
    if endings:
        volta_by_bar[m_idx] = endings


def _marker_marks(element: Element) -> set[str]:
    found: set[str] = set()
    for sub in ("label", "text", "jumpTo", "playUntil", "continueAt"):
        val = _text(_child(element, sub))
        if val:
            found |= _words_marks(val)
            low = val.lower()
            if low == "segno":
                found.add("segno")
            elif low in {"codab", "coda", "varcoda"}:
                found.add("coda")
            elif low == "fine":
                found.add("fine")
    return found


def _chord_grace(chord: Element) -> str | None:
    for child in chord:
        tag = _local(child.tag)
        if tag in _GRACE_BEFORE:
            return "before_beat"
        if tag in _GRACE_ON:
            return "on_beat"
    return None


def _read_chord_notes(
    chord: Element,
    open_ties_by_key: set[tuple[int | None, int | None]],
) -> list[_RawNote]:
    staccato = False
    vibrato = False
    palm_mute = False
    let_ring = False
    slur_start = False

    for child in chord:
        tag = _local(child.tag)
        if tag == "Articulation":
            subtype = _text(_child(child, "subtype")).lower()
            if "staccato" in subtype:
                staccato = True
            if "vibrato" in subtype:
                vibrato = True
            if "mute" in subtype or "palmmute" in subtype:
                palm_mute = True
            if "letring" in subtype:
                let_ring = True
        elif tag == "Spanner" and child.attrib.get("type") == "Slur":
            if _child(child, "prev") is None:
                slur_start = True

    notes: list[_RawNote] = []
    for note_el in _children(chord, "Note"):
        pitch_el = _child(note_el, "pitch")
        string_el = _child(note_el, "string")
        fret_el = _child(note_el, "fret")

        pitch = _int(pitch_el, -1) if pitch_el is not None else None
        if pitch is not None and pitch < 0:
            pitch = None
        string = _int(string_el, -1) if string_el is not None else None
        if string is not None and string < 0:
            string = None
        fret = _int(fret_el, -1) if fret_el is not None else None
        if fret is not None and fret < 0:
            fret = None

        if pitch is None and (string is None or fret is None):
            continue

        dead = _text(_child(note_el, "dead")) == "1" or _text(_child(note_el, "head")) in {"cross", "x"}
        ghost = _text(_child(note_el, "ghost")) == "1"
        harmonic: str | None = None
        if _text(_child(note_el, "harmonic")) == "1" or _text(_child(note_el, "head")) == "diamond":
            harmonic = "natural"

        hammer = slur_start or _child(note_el, "HammerOn") is not None or _child(note_el, "PullOff") is not None
        slide: SlideKind | None = None
        if _child(note_el, "Glissando") is not None or _child(note_el, "Slide") is not None:
            slide = "legato" if slur_start else "shift"

        tie_stop = False
        tie_start = _child(note_el, "Tie") is not None
        for spanner in _children(note_el, "Spanner"):
            stype = spanner.attrib.get("type", "")
            if stype == "Tie":
                if _child(spanner, "prev") is not None:
                    tie_stop = True
                if _child(spanner, "Tie") is not None or _child(spanner, "next") is not None:
                    tie_start = True
            elif stype == "Glissando" and _child(spanner, "prev") is None:
                slide = "legato" if slur_start else "shift"
            elif stype == "Slur" and _child(spanner, "prev") is None:
                hammer = True

        for sym in _children(note_el, "Symbol"):
            if "parenthesis" in _text(_child(sym, "name")).lower():
                ghost = True

        bend: float | None = None
        bend_el = _child(note_el, "Bend")
        if bend_el is not None:
            points = [
                int(pt.attrib.get("pitch", "0"))
                for pt in _children(bend_el, "point")
                if pt.attrib.get("pitch", "").lstrip("-").isdigit()
            ]
            if points and max(points) > 0:
                bend = min(4.0, round(max(points) / 100.0, 2))

        tie_key = (string, pitch)
        is_tied = tie_stop or (tie_key in open_ties_by_key)
        if is_tied and not tie_start:
            open_ties_by_key.discard(tie_key)
        if tie_start:
            open_ties_by_key.add(tie_key)

        notes.append(
            _RawNote(
                pitch=pitch,
                string=string,
                fret=fret,
                dead=dead,
                tie=is_tied,
                ghost=ghost,
                hammer=hammer,
                slide=slide,
                vibrato=vibrato,
                harmonic=harmonic,
                bend=bend,
                palm_mute=palm_mute,
                let_ring=let_ring,
                staccato=staccato,
            )
        )
    return notes


def _build_track(
    *,
    part_meta: _PartMeta,
    chosen_staves: list[_ParsedStaff],
    index: int,
    prefer: str,
) -> Track:
    all_pitches = [p for ps in chosen_staves for p in ps.pitches]
    has_tab = any(ps.has_tab for ps in chosen_staves)
    max_string = max((ps.max_string for ps in chosen_staves), default=0)

    tuning = list(part_meta.tuning)
    instrument_kind = "guitar"
    if not tuning:
        if has_tab and max_string <= 4:
            preset = get_preset("bass-4")
        elif has_tab and max_string == 5:
            preset = get_preset("bass-5")
        elif all_pitches:
            lowest = min(all_pitches)
            median = int(statistics.median(all_pitches))
            preset_id = suggest_preset(part_meta.program, lowest, median)
            if prefer == "bass" and part_meta.program is None and lowest < 55:
                preset_id = "bass-4"
            preset = get_preset(preset_id)
        else:
            preset = get_preset("bass-4" if prefer == "bass" else "guitar-6")
        tuning = list(preset.tuning_midi)
        instrument_kind = preset.instrument
    else:
        is_bass = (
            "bass" in part_meta.name.lower()
            or "bass" in part_meta.instrument_id.lower()
            or (part_meta.program is not None and 32 <= part_meta.program < 40)
            or len(tuning) <= 5
        )
        instrument_kind = canonical_instrument(
            part_meta.name,
            is_bass=is_bass,
            is_guitar=not is_bass,
        )

    bar_count = max(len(ps.voices_per_bar) for ps in chosen_staves)
    merged_bars: list[list[list[_RawBeat]]] = []
    for b_idx in range(bar_count):
        voices: list[list[_RawBeat]] = []
        for ps in chosen_staves:
            if b_idx < len(ps.voices_per_bar):
                for v_beats in ps.voices_per_bar[b_idx]:
                    if v_beats:
                        voices.append(v_beats)
        merged_bars.append(voices or [[]])

    # Assign frets for any notes that lack explicit string/fret
    groups: list[list[int]] = []
    group_targets: list[list[_RawNote]] = []
    for bar_voices in merged_bars:
        for v_beats in bar_voices:
            for beat in v_beats:
                unplaced = [rn for rn in beat.notes if (rn.string is None or rn.fret is None) and rn.pitch is not None]
                if unplaced:
                    groups.append([rn.pitch for rn in unplaced if rn.pitch is not None])
                    group_targets.append(unplaced)

    if groups:
        fingering = assign_frets(groups, tuning, capo=part_meta.capo)
        for placed_group, target_notes in zip(fingering.groups, group_targets, strict=True):
            for placement in placed_group:
                if 0 <= placement.source < len(target_notes):
                    target_notes[placement.source].string = placement.string
                    target_notes[placement.source].fret = placement.fret

    track_bars: list[TrackBar] = []
    for bar_voices in merged_bars:
        built_voices: list[Voice] = []
        for v_beats in bar_voices:
            built_beats: list[Beat] = []
            for rb in v_beats:
                notes = [
                    Note(
                        string=rn.string,
                        fret=max(0, min(99, rn.fret)),
                        dead=rn.dead,
                        tie=rn.tie,
                        ghost=rn.ghost,
                        hammer=rn.hammer,
                        slide=rn.slide,
                        vibrato=rn.vibrato,
                        harmonic=rn.harmonic,  # type: ignore[arg-type]
                        bend=rn.bend,
                        palm_mute=rn.palm_mute,
                        let_ring=rn.let_ring,
                        staccato=rn.staccato,
                    )
                    for rn in rb.notes
                    if rn.string is not None and rn.fret is not None and 0 <= rn.string < len(tuning)
                ]
                notes.sort(key=lambda n: n.string)
                built_beats.append(
                    Beat(
                        position=rb.position,
                        duration=max(1, rb.duration),
                        notes=notes,
                        grace=rb.grace,  # type: ignore[arg-type]
                        tuplet=rb.tuplet,
                    )
                )
            if built_beats:
                built_voices.append(Voice(beats=built_beats))
        track_bars.append(TrackBar(voices=built_voices or [Voice()]))

    return Track(
        id=f"trk_mscx_{index}",
        name=part_meta.name,
        instrument=instrument_kind,
        capo=part_meta.capo,
        tuning_midi=tuning,
        preferred=False,
        bars=track_bars or [TrackBar()],
    )
