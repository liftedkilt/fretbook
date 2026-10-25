"""ABC notation (``.abc``) importer.

ABC represents tunes in plain ASCII: header lines (``X:``, ``T:``, ``C:``, ``M:``, ``L:``, ``Q:``, ``K:``)
followed by melody lines with pitch letters (``C..B`` in octave 4, ``c..b`` in octave 5), octave marks
(``'`` up, ``,`` down), accidentals (``^``, ``_``, ``=``), durations (``2``, ``/``, ``3/2``), broken
rhythms (``>``, ``<``), tuplets (``(3``), chords (``[CEG]``), grace notes (``{g}``), ties (``-``), and
bar lines (``|``, ``|:``, ``:|``, ``::``, ``[1``, ``[2``).

Because ABC encodes pitches rather than string/fret numbers, :func:`fretbook.score.fingering.assign_frets`
places the notes on the selected instrument preset.
"""

from __future__ import annotations

import re
import statistics
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fretbook.importers.base import ImportError, ImportRequest, ImportResult, Progress
from fretbook.importers.midi import suggest_preset
from fretbook.importers.musicxml import _directions, _words_marks
from fretbook.score.fingering import assign_frets
from fretbook.score.instruments import get_preset, is_preset
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

EXTENSIONS = (".abc",)
MAX_ABC_BYTES = 8 * 1024 * 1024

_HEADER_LINE_RE = re.compile(r"^[A-Za-z]:\s*.*$")
_KEY_HEADER_RE = re.compile(
    r"^K:\s*(?:none|HP|Hp|[A-Ga-g][#b]?\s*(?:m|min|minor|maj|major|ion|ionian|dor|dorian|phr|phrygian|lyd|lydian|mix|mixolydian|aeo|aeolian|loc|locrian|exp)?)\b",
    re.IGNORECASE,
)
_PRE_KEY_HEADERS = {"X", "T", "C", "M", "L", "Q", "V", "P", "Z", "N", "G", "O", "R", "B", "D", "F", "S", "I", "U"}
_REQUIRED_HEADER_BEFORE_K = {"X", "T", "M", "L", "Q"}

_BASE_SEMITONES: dict[str, int] = {
    "C": 0,
    "D": 2,
    "E": 4,
    "F": 5,
    "G": 7,
    "A": 9,
    "B": 11,
}

_FIFTHS_ORDER_SHARP = ("F", "C", "G", "D", "A", "E", "B")
_FIFTHS_ORDER_FLAT = ("B", "E", "A", "D", "G", "C", "F")

_KEY_FIFTHS: dict[str, int] = {
    "C": 0,
    "G": 1,
    "D": 2,
    "A": 3,
    "E": 4,
    "B": 5,
    "F#": 6,
    "C#": 7,
    "F": -1,
    "Bb": -2,
    "Eb": -3,
    "Ab": -4,
    "Db": -5,
    "Gb": -6,
    "Cb": -7,
    "A#": 10,
    "D#": 9,
    "G#": 8,
}

_MODE_FIFTH_OFFSET: dict[str, int] = {
    "": 0,
    "maj": 0,
    "major": 0,
    "ion": 0,
    "ionian": 0,
    "mix": -1,
    "mixolydian": -1,
    "dor": -2,
    "dorian": -2,
    "m": -3,
    "min": -3,
    "minor": -3,
    "aeo": -3,
    "aeolian": -3,
    "phr": -4,
    "phrygian": -4,
    "loc": -5,
    "locrian": -5,
    "lyd": 1,
    "lydian": 1,
}


def looks_like_abc(text: str) -> bool:
    """True when ``text`` starts like an ABC tune header (``X:``/``T:``/... then ``K:``) followed by ABC body."""
    lines = text.splitlines()
    seen_header_keys: set[str] = set()
    found_key = False
    body_lines: list[str] = []

    for raw in lines[:200]:
        line = raw.strip()
        if not line or line.startswith("%"):
            continue
        if not found_key:
            if not _HEADER_LINE_RE.match(line):
                return False
            field_key = line[0].upper()
            if field_key == "K":
                if not _KEY_HEADER_RE.match(line):
                    return False
                if not (seen_header_keys & _REQUIRED_HEADER_BEFORE_K):
                    return False
                found_key = True
            elif field_key in _PRE_KEY_HEADERS:
                seen_header_keys.add(field_key)
            else:
                return False
        else:
            if _HEADER_LINE_RE.match(line):
                continue
            body_lines.append(line)
            if len(body_lines) >= 3:
                break

    if not found_key or not body_lines:
        return False
    joined = " ".join(body_lines)
    return bool(re.search(r"[A-Ga-gzZxX]", joined))


def _key_accidentals(spec: str) -> tuple[dict[str, int], int, bool]:
    """Return ``(letter_accidentals, octave_shift, is_bass_clef)`` from a ``K:`` field value."""
    cleaned = spec.split("%", 1)[0].strip()
    is_bass = bool(re.search(r"\bclef\s*=\s*bass\b|\bbass\b", cleaned, re.IGNORECASE))
    octave_shift = 0
    oct_match = re.search(r"\boctave\s*=\s*(-?\d+)", cleaned, re.IGNORECASE)
    if oct_match:
        octave_shift = max(-3, min(3, int(oct_match.group(1))))

    acc: dict[str, int] = {letter: 0 for letter in _BASE_SEMITONES}
    if not cleaned or cleaned.lower().startswith("none"):
        return acc, octave_shift, is_bass

    if cleaned.startswith(("HP", "Hp")):
        acc["F"] = 1
        acc["C"] = 1
        return acc, octave_shift, is_bass

    m = re.match(
        r"^([A-Ga-g])([#b]?)\s*(maj(?:or)?|min(?:or)?|ion(?:ian)?|dor(?:ian)?|phr(?:ygian)?|lyd(?:ian)?|mix(?:olydian)?|aeo(?:lian)?|loc(?:rian)?|exp|m)?\b(.*)$",
        cleaned,
        re.IGNORECASE,
    )
    if not m:
        return acc, octave_shift, is_bass

    tonic = m.group(1).upper() + (m.group(2) or "")
    mode = (m.group(3) or "").lower()
    rest = m.group(4) or ""

    if mode != "exp":
        fifths = _KEY_FIFTHS.get(tonic, 0) + _MODE_FIFTH_OFFSET.get(mode, 0)
        if fifths > 0:
            for i in range(min(fifths, 7)):
                acc[_FIFTHS_ORDER_SHARP[i]] += 1
        elif fifths < 0:
            for i in range(min(-fifths, 7)):
                acc[_FIFTHS_ORDER_FLAT[i]] -= 1

    # Explicit accidentals in K: e.g. ^f _b =c
    for exp_m in re.finditer(r"(\^{1,2}|_{1,2}|=)([A-Ga-g])", rest):
        sym, letter = exp_m.group(1), exp_m.group(2).upper()
        if sym == "=":
            acc[letter] = 0
        elif sym.startswith("^"):
            acc[letter] = len(sym)
        elif sym.startswith("_"):
            acc[letter] = -len(sym)

    return acc, octave_shift, is_bass


def _parse_meter(spec: str) -> tuple[int, int]:
    cleaned = spec.split("%", 1)[0].strip()
    if not cleaned or cleaned == "C":
        return (4, 4)
    if cleaned == "C|":
        return (2, 2)
    if cleaned.lower() == "none":
        return (4, 4)
    m = re.match(r"^\(?(\d+(?:\+\d+)*)\)?\s*/\s*(\d+)", cleaned)
    if not m:
        return (4, 4)
    num = sum(int(part) for part in m.group(1).split("+"))
    den = int(m.group(2))
    if 1 <= num <= 32 and den in {1, 2, 4, 8, 16, 32}:
        return (num, den)
    return (4, 4)


def _default_unit_ticks(signature: tuple[int, int]) -> int:
    num, den = signature
    if num / den < 0.75:
        return TICKS_PER_QUARTER // 4
    return TICKS_PER_QUARTER // 2


def _parse_unit_ticks(spec: str, fallback: int) -> int:
    cleaned = spec.split("%", 1)[0].strip()
    m = re.match(r"^(\d+)\s*/\s*(\d+)", cleaned)
    if not m:
        return fallback
    num, den = int(m.group(1)), int(m.group(2))
    if num <= 0 or den <= 0:
        return fallback
    return max(1, round(4 * TICKS_PER_QUARTER * num / den))


def _parse_tempo(spec: str) -> float | None:
    cleaned = spec.split("%", 1)[0].strip()
    # Strip quoted strings such as "Allegro"
    cleaned = re.sub(r'"[^"]*"', "", cleaned).strip()
    if not cleaned:
        return None
    m_ratio = re.search(r"(\d+)\s*/\s*(\d+)\s*=\s*(\d+(?:\.\d+)?)", cleaned)
    if m_ratio:
        num = int(m_ratio.group(1))
        den = int(m_ratio.group(2))
        val = float(m_ratio.group(3))
        if den > 0 and val > 0:
            bpm = round(val * (4.0 * num / den), 2)
            if abs(bpm - round(bpm)) < 0.05:
                bpm = float(round(bpm))
            return bpm if 0 < bpm < 400 else None
    m_plain = re.search(r"(?:=\s*)?(\d+(?:\.\d+)?)", cleaned)
    if m_plain:
        val = float(m_plain.group(1))
        return val if 0 < val < 400 else None
    return None


def _parse_duration_multiplier(text: str) -> tuple[int, int]:
    """Return ``(numerator, denominator)`` multiplier from an ABC duration suffix."""
    if not text:
        return (1, 1)
    if "/" not in text:
        return (max(1, int(text)), 1)
    if text.startswith("/"):
        rest = text[1:]
        if not rest:
            return (1, 2)
        if all(ch == "/" for ch in rest):
            return (1, 2 ** len(text))
        return (1, max(1, int(rest)))
    parts = text.split("/", 1)
    num = int(parts[0]) if parts[0] else 1
    den_str = parts[1]
    if not den_str:
        den = 2
    elif all(ch == "/" for ch in den_str):
        den = 2 ** (len(den_str) + 1)
    else:
        den = max(1, int(den_str))
    return (max(1, num), den)


@dataclass
class _AbcNote:
    pitch: int
    tie_start: bool = False
    tie_stop: bool = False
    hammer: bool = False
    slide: SlideKind | None = None
    vibrato: bool = False
    staccato: bool = False
    string: int | None = None
    fret: int | None = None


@dataclass
class _AbcBeat:
    position: int
    duration: int
    notes: list[_AbcNote] = field(default_factory=list)
    grace: str | None = None
    tuplet: int | None = None


@dataclass
class _AbcBarData:
    signature: tuple[int, int] = (4, 4)
    tempo: float | None = None
    repeat_start: bool = False
    repeat_end: int = 0
    alternate_endings: list[int] = field(default_factory=list)
    section: str | None = None
    marks: set[str] = field(default_factory=set)
    beats: list[_AbcBeat] = field(default_factory=list)

    @property
    def is_empty(self) -> bool:
        return (
            not self.beats
            and not self.repeat_start
            and self.repeat_end == 0
            and not self.alternate_endings
            and self.section is None
            and not self.marks
            and self.tempo is None
        )


@dataclass
class _VoiceInfo:
    id: str
    name: str = ""
    is_bass: bool = False
    octave_shift: int = 0
    bars: list[_AbcBarData] = field(default_factory=list)


class AbcImporter:
    kind = "abc"

    def can_handle(self, request: ImportRequest) -> bool:
        name = (request.filename or "").lower()
        return name.endswith(EXTENSIONS)

    def import_score(self, request: ImportRequest, progress: Progress) -> ImportResult:
        if request.file_path is None:
            raise ImportError("ABC import needs a file", "import.needsFile")
        progress("Reading ABC file", "import.readingFile")
        raw = request.file_path.read_bytes()
        if len(raw) > MAX_ABC_BYTES:
            raise ImportError("this ABC file is larger than 8 MB", "abc.tooLarge")
        text = raw.decode("utf-8", errors="replace")
        return _import_abc_text(
            text,
            filename=request.filename or request.file_path.name,
            options=request.options,
            progress=progress,
        )


def _split_tunes(text: str) -> list[list[str]]:
    tunes: list[list[str]] = []
    current: list[str] = []
    for line in text.splitlines():
        if re.match(r"^X:\s*\d+", line.strip()) and current:
            if any(re.match(r"^K:", item.strip(), re.IGNORECASE) for item in current):
                tunes.append(current)
                current = []
        current.append(line)
    if current:
        tunes.append(current)
    return tunes


def _import_abc_text(
    text: str,
    *,
    filename: str,
    options: dict[str, Any],
    progress: Progress,
) -> ImportResult:
    tunes = _split_tunes(text)
    for tune_lines in tunes:
        result = _parse_single_tune(tune_lines, filename=filename, options=options)
        if result is not None:
            progress("Tab ready", "import.tabReady")
            return result
    raise ImportError("this ABC file has no playable notes", "abc.noNotes")


def _parse_single_tune(
    lines: list[str],
    *,
    filename: str,
    options: dict[str, Any],
) -> ImportResult | None:
    title = ""
    artist = ""
    signature: tuple[int, int] = (4, 4)
    unit_ticks: int | None = None
    opening_tempo: float | None = None
    key_acc: dict[str, int] = {letter: 0 for letter in _BASE_SEMITONES}
    key_octave_shift = 0
    key_is_bass = False
    in_body = False
    pending_section: str | None = None

    voices: dict[str, _VoiceInfo] = {}
    current_voice_id = "1"

    def get_voice(vid: str) -> _VoiceInfo:
        if vid not in voices:
            voices[vid] = _VoiceInfo(
                id=vid,
                is_bass=key_is_bass,
                octave_shift=key_octave_shift,
            )
        return voices[vid]

    body_chunks: list[tuple[str, str]] = []

    for raw_line in lines:
        # Strip % comments unless escaped
        line = re.sub(r"(?<!\\)%.*$", "", raw_line).strip()
        if not line:
            continue
        if not in_body:
            if len(line) >= 2 and line[1] == ":" and line[0].isalpha():
                field_key = line[0].upper()
                field_val = line[2:].strip()
                if field_key == "T" and not title:
                    title = field_val
                elif field_key == "C" and not artist:
                    artist = field_val
                elif field_key == "A" and not artist:
                    artist = field_val
                elif field_key == "M":
                    signature = _parse_meter(field_val)
                elif field_key == "L":
                    unit_ticks = _parse_unit_ticks(field_val, _default_unit_ticks(signature))
                elif field_key == "Q":
                    opening_tempo = _parse_tempo(field_val) or opening_tempo
                elif field_key == "P" and field_val:
                    pending_section = field_val
                elif field_key == "V":
                    vid, v_name, v_bass, v_oct = _parse_voice_header(field_val)
                    v_info = get_voice(vid)
                    if v_name:
                        v_info.name = v_name
                    if v_bass:
                        v_info.is_bass = True
                    if v_oct is not None:
                        v_info.octave_shift = v_oct
                    current_voice_id = vid
                elif field_key == "K":
                    key_acc, key_octave_shift, key_is_bass = _key_accidentals(field_val)
                    for v_info in voices.values():
                        if key_is_bass:
                            v_info.is_bass = True
                        if v_info.octave_shift == 0 and key_octave_shift != 0:
                            v_info.octave_shift = key_octave_shift
                    in_body = True
            continue

        # In body: check for line-level fields
        if len(line) >= 2 and line[1] == ":" and line[0].isalpha():
            field_key = line[0].upper()
            field_val = line[2:].strip()
            if field_key in {"W", "w", "N", "Z", "R", "B", "D", "F", "S", "I", "U"}:
                continue
            if field_key == "V":
                vid, v_name, v_bass, v_oct = _parse_voice_header(field_val)
                v_info = get_voice(vid)
                if v_name:
                    v_info.name = v_name
                if v_bass:
                    v_info.is_bass = True
                if v_oct is not None:
                    v_info.octave_shift = v_oct
                current_voice_id = vid
                continue
            if field_key in {"M", "L", "K", "Q", "P"}:
                body_chunks.append((current_voice_id, f"[{field_key}:{field_val}]"))
                continue

        body_chunks.append((current_voice_id, line))

    if not in_body or not body_chunks:
        return None

    effective_unit = unit_ticks if unit_ticks is not None else _default_unit_ticks(signature)

    grouped_by_voice: dict[str, list[str]] = {}
    for vid, chunk in body_chunks:
        get_voice(vid)
        grouped_by_voice.setdefault(vid, []).append(chunk)

    for vid, chunks in grouped_by_voice.items():
        v_info = get_voice(vid)
        v_info.bars = _parse_voice_body(
            " ".join(chunks),
            initial_signature=signature,
            initial_unit_ticks=effective_unit,
            initial_key_acc=dict(key_acc),
            voice_info=v_info,
            initial_section=pending_section,
        )

    active_voices = [
        v_info for v_info in voices.values() if any(beat.notes for bar in v_info.bars for beat in bar.beats)
    ]
    if not active_voices:
        return None

    prefer = str(options.get("prefer") or "")
    requested_preset = str(options.get("preset") or "")

    master_bars = _build_master_bars(active_voices[0].bars)
    if opening_tempo is None and active_voices[0].bars and active_voices[0].bars[0].tempo is not None:
        opening_tempo = active_voices[0].bars[0].tempo
        master_bars[0].tempo = None

    tracks: list[Track] = []
    for idx, v_info in enumerate(active_voices):
        track = _voice_to_track(
            v_info,
            index=idx,
            master_bar_count=len(master_bars),
            prefer=prefer,
            requested_preset=requested_preset,
            title=title,
        )
        tracks.append(track)

    preferred_idx = 0
    if prefer:
        for idx, trk in enumerate(tracks):
            is_bass = trk.instrument == "bass-guitar" or len(trk.tuning_midi) <= 5
            if is_bass == (prefer == "bass"):
                preferred_idx = idx
                break
    for idx, trk in enumerate(tracks):
        trk.preferred = idx == preferred_idx

    bpm = opening_tempo or 120.0
    slug_source = Path(filename or "song").stem or title or "song"
    slug = "".join(ch.lower() if ch.isalnum() else "-" for ch in slug_source).strip("-") or "song"
    return ImportResult(
        title=title or slug,
        artist=artist,
        slug=slug[:60],
        document=ScoreDocument(bpm=bpm, bars=master_bars, tracks=tracks),
        source_kind="abc",
        source_ref={"filename": filename},
    )


def _parse_voice_header(spec: str) -> tuple[str, str, bool, int | None]:
    parts = spec.split(None, 1)
    vid = parts[0] if parts else "1"
    name = ""
    m_name = re.search(r'\bname\s*=\s*"([^"]+)"', spec, re.IGNORECASE) or re.search(
        r'\bsname\s*=\s*"([^"]+)"', spec, re.IGNORECASE
    )
    if m_name:
        name = m_name.group(1)
    is_bass = bool(re.search(r"\bclef\s*=\s*bass\b|\bbass\b", spec, re.IGNORECASE)) or "bass" in name.lower()
    oct_shift: int | None = None
    m_oct = re.search(r"\boctave\s*=\s*(-?\d+)", spec, re.IGNORECASE)
    if m_oct:
        oct_shift = max(-3, min(3, int(m_oct.group(1))))
    return vid, name, is_bass, oct_shift


_TOKEN_RE = re.compile(
    r"""
    (?P<inline>\[[A-Za-z]:[^\]]*\])
    | (?P<quoted>"[^"]*")
    | (?P<deco>![^!\s]+!|\+[^+\s]+\+)
    | (?P<grace>\{/?[^}]*\})
    | (?P<tuplet>\(\d+(?::\d*)?(?::\d*)?)
    | (?P<volta>\[\d+(?:,\d+)*|\|\d+|\:\|\d+)
    | (?P<barline>\|\:\:|\:\|\|\:|\:\:|\|\:|\:\||\|\]|\|\||\|)
    | (?P<chord>\[(?:\^{1,2}|_{1,2}|=)?[A-Ga-g][',]*\d*(?:/\d*)?(?:[^\]]*)\]\d*(?:/+\d*)?-?)
    | (?P<note>\.?(?:\^{1,2}|_{1,2}|=)?[A-Ga-g][',]*\d*(?:/+\d*)?-?)
    | (?P<rest>[zZxX]\d*(?:/+\d*)?)
    | (?P<broken>>+|<+)
    | (?P<slur_open>\()
    | (?P<slur_close>\))
    | (?P<tie>-)
    """,
    re.VERBOSE,
)

_SINGLE_NOTE_RE = re.compile(
    r"^(?P<staccato>\.?)(?P<acc>\^{1,2}|_{1,2}|=)?(?P<letter>[A-Ga-g])(?P<oct>[',]*)(?P<dur>\d*(?:/+\d*)?)(?P<tie>-?)$"
)


def _parse_voice_body(
    body: str,
    *,
    initial_signature: tuple[int, int],
    initial_unit_ticks: int,
    initial_key_acc: dict[str, int],
    voice_info: _VoiceInfo,
    initial_section: str | None,
) -> list[_AbcBarData]:
    signature = initial_signature
    unit_ticks = initial_unit_ticks
    key_acc = dict(initial_key_acc)
    bars: list[_AbcBarData] = []
    current_bar = _AbcBarData(signature=signature, section=initial_section)
    cursor = 0
    bar_acc: dict[tuple[str, int], int] = {}
    open_ties: set[int] = set()
    pending_grace: tuple[str, list[_AbcNote]] | None = None
    pending_broken: float = 0.0
    tuplet_remaining = 0
    tuplet_ratio_pair: tuple[int, int] = (1, 1)
    pending_staccato = False
    pending_vibrato = False
    pending_slide: SlideKind | None = None
    slur_just_started = False

    def flush_bar(*, next_repeat_start: bool = False, next_endings: list[int] | None = None) -> None:
        nonlocal current_bar, cursor, bar_acc
        if not current_bar.is_empty or bars:
            bars.append(current_bar)
        current_bar = _AbcBarData(
            signature=signature,
            repeat_start=next_repeat_start,
            alternate_endings=list(next_endings or []),
        )
        cursor = 0
        bar_acc = {}

    def resolve_pitch(acc_str: str, letter: str, oct_str: str) -> int:
        upper = letter.upper()
        octave = 5 if letter.islower() else 4
        octave += oct_str.count("'") - oct_str.count(",") + voice_info.octave_shift
        if acc_str:
            if acc_str == "=":
                semitone_offset = 0
            elif acc_str.startswith("^"):
                semitone_offset = len(acc_str)
            else:
                semitone_offset = -len(acc_str)
            bar_acc[(upper, octave)] = semitone_offset
        elif (upper, octave) in bar_acc:
            semitone_offset = bar_acc[(upper, octave)]
        else:
            semitone_offset = key_acc.get(upper, 0)
        return (octave + 1) * 12 + _BASE_SEMITONES[upper] + semitone_offset

    def scale_duration(base_ticks: int) -> tuple[int, int | None]:
        nonlocal pending_broken, tuplet_remaining
        ticks = float(base_ticks)
        tuplet_hint: int | None = None
        if tuplet_remaining > 0:
            p, q = tuplet_ratio_pair
            ticks = ticks * q / p
            if 2 <= p <= 16:
                tuplet_hint = p
            tuplet_remaining -= 1
        if pending_broken != 0.0:
            ticks = ticks * (1.0 + pending_broken)
            pending_broken = 0.0
        return max(1, round(ticks)), tuplet_hint

    def apply_broken(token: str) -> None:
        nonlocal pending_broken, cursor
        k = len(token)
        delta = 1.0 - (1.0 / (2**k))
        if token.startswith(">"):
            # Previous beat lengthens, next beat shortens
            if current_bar.beats:
                prev = current_bar.beats[-1]
                old_dur = prev.duration
                new_dur = max(1, round(old_dur * (1.0 + delta)))
                prev.duration = new_dur
                cursor += new_dur - old_dur
            pending_broken = -delta
        else:
            if current_bar.beats:
                prev = current_bar.beats[-1]
                old_dur = prev.duration
                new_dur = max(1, round(old_dur * (1.0 - delta)))
                prev.duration = new_dur
                cursor += new_dur - old_dur
            pending_broken = delta

    for match in _TOKEN_RE.finditer(body):
        kind = match.lastgroup
        token = match.group(0)

        if kind == "quoted":
            continue

        if kind == "deco":
            inner = token[1:-1].strip().lower()
            if inner in {".", "staccato"}:
                pending_staccato = True
            elif inner in {"~", "vibrato", "trill"}:
                pending_vibrato = True
            elif inner == "slide":
                pending_slide = "shift"
            elif inner == "segno":
                current_bar.marks.add("segno")
            elif inner == "coda":
                current_bar.marks.add("coda")
            elif inner == "fine":
                current_bar.marks.add("fine")
            else:
                current_bar.marks |= _words_marks(inner)
            continue

        if kind == "inline":
            fkey = token[1].upper()
            fval = token[3:-1].strip()
            if fkey == "M":
                signature = _parse_meter(fval)
                if not current_bar.beats:
                    current_bar.signature = signature
            elif fkey == "L":
                unit_ticks = _parse_unit_ticks(fval, unit_ticks)
            elif fkey == "K":
                key_acc, k_oct, k_bass = _key_accidentals(fval)
                if k_bass:
                    voice_info.is_bass = True
                if k_oct:
                    voice_info.octave_shift = k_oct
            elif fkey == "Q":
                t_val = _parse_tempo(fval)
                if t_val is not None:
                    current_bar.tempo = t_val
            elif fkey == "P" and fval:
                current_bar.section = fval
            continue

        if kind == "grace":
            inner = token[1:-1]
            g_kind = "before_beat" if inner.startswith("/") else "on_beat"
            if inner.startswith("/"):
                inner = inner[1:]
            g_notes: list[_AbcNote] = []
            for gm in re.finditer(r"(\^{1,2}|_{1,2}|=)?([A-Ga-g])([',]*)", inner):
                gpitch = resolve_pitch(gm.group(1) or "", gm.group(2), gm.group(3) or "")
                g_notes.append(_AbcNote(pitch=gpitch))
            if g_notes:
                pending_grace = (g_kind, g_notes)
            continue

        if kind == "tuplet":
            nums = [int(x) if x else 0 for x in token[1:].split(":")]
            p = nums[0]
            compound = signature[1] == 8 and signature[0] in {6, 9, 12}
            if len(nums) >= 2 and nums[1] > 0:
                q = nums[1]
            elif p in {2, 4, 8}:
                q = 3
            elif p in {3, 6}:
                q = 2
            else:
                q = 3 if compound else 2
            r = nums[2] if len(nums) >= 3 and nums[2] > 0 else p
            tuplet_ratio_pair = (p, q)
            tuplet_remaining = r
            continue

        if kind == "volta":
            if token.startswith(":|"):
                current_bar.repeat_end = 2
                endings = [int(x) for x in re.findall(r"\d+", token) if 1 <= int(x) <= 32]
                flush_bar(next_endings=endings)
            elif token.startswith("|"):
                endings = [int(x) for x in re.findall(r"\d+", token) if 1 <= int(x) <= 32]
                if current_bar.beats:
                    flush_bar(next_endings=endings)
                else:
                    current_bar.alternate_endings = endings
            else:
                endings = [int(x) for x in re.findall(r"\d+", token) if 1 <= int(x) <= 32]
                current_bar.alternate_endings = endings
            continue

        if kind == "barline":
            if token in {"|:", "::", ":||:", "|::"}:
                if token in {"::", ":||:", "|::"}:
                    current_bar.repeat_end = 2
                if current_bar.is_empty and not bars:
                    current_bar.repeat_start = True
                    bar_acc = {}
                else:
                    flush_bar(next_repeat_start=True)
            elif token == ":|":
                current_bar.repeat_end = 2
                flush_bar()
            else:
                if current_bar.is_empty and not bars:
                    bar_acc = {}
                else:
                    flush_bar()
            continue

        if kind == "broken":
            apply_broken(token)
            continue

        if kind == "slur_open":
            slur_just_started = True
            continue

        if kind == "slur_close":
            slur_just_started = False
            continue

        if kind == "tie":
            if current_bar.beats and current_bar.beats[-1].notes:
                for n in current_bar.beats[-1].notes:
                    n.tie_start = True
                    open_ties.add(n.pitch)
            continue

        if kind == "rest":
            r_char = token[0]
            dur_str = token[1:]
            if r_char in {"Z", "X"}:
                count = int(dur_str) if dur_str.isdigit() else 1
                bar_len = 4 * TICKS_PER_QUARTER * signature[0] // signature[1]
                for _ in range(max(1, count)):
                    if current_bar.beats:
                        flush_bar()
                    current_bar.beats.append(_AbcBeat(position=0, duration=bar_len, notes=[]))
                    flush_bar()
            else:
                num, den = _parse_duration_multiplier(dur_str)
                raw_ticks = round(unit_ticks * num / den)
                ticks, tup_hint = scale_duration(raw_ticks)
                current_bar.beats.append(_AbcBeat(position=cursor, duration=ticks, notes=[], tuplet=tup_hint))
                cursor += ticks
            continue

        if kind in {"note", "chord"}:
            if pending_grace is not None:
                g_kind, g_notes = pending_grace
                current_bar.beats.append(
                    _AbcBeat(
                        position=cursor,
                        duration=TICKS_PER_QUARTER // 4,
                        notes=g_notes,
                        grace=g_kind,
                    )
                )
                pending_grace = None

            if kind == "note":
                nm = _SINGLE_NOTE_RE.match(token)
                if not nm:
                    continue
                is_stac = bool(nm.group("staccato")) or pending_staccato
                pitch = resolve_pitch(nm.group("acc") or "", nm.group("letter"), nm.group("oct") or "")
                num, den = _parse_duration_multiplier(nm.group("dur") or "")
                tie_after = bool(nm.group("tie"))
                tie_stop = pitch in open_ties
                if tie_stop:
                    open_ties.discard(pitch)
                if tie_after:
                    open_ties.add(pitch)

                raw_ticks = round(unit_ticks * num / den)
                ticks, tup_hint = scale_duration(raw_ticks)
                abc_note = _AbcNote(
                    pitch=pitch,
                    tie_start=tie_after,
                    tie_stop=tie_stop,
                    hammer=slur_just_started,
                    slide=pending_slide,
                    vibrato=pending_vibrato,
                    staccato=is_stac,
                )
                current_bar.beats.append(
                    _AbcBeat(
                        position=cursor,
                        duration=ticks,
                        notes=[abc_note],
                        tuplet=tup_hint,
                    )
                )
                cursor += ticks
            else:
                # Chord: [CEG]2/3-
                close_idx = token.rfind("]")
                inner = token[1:close_idx]
                tail = token[close_idx + 1 :]
                chord_tie = tail.endswith("-")
                dur_str = tail[:-1] if chord_tie else tail
                chord_num, chord_den = _parse_duration_multiplier(dur_str)

                chord_notes: list[_AbcNote] = []
                first_note_Ratio: tuple[int, int] | None = None
                for cm in re.finditer(
                    r"(?P<acc>\^{1,2}|_{1,2}|=)?(?P<letter>[A-Ga-g])(?P<oct>[',]*)(?P<dur>\d*(?:/+\d*)?)(?P<tie>-?)",
                    inner,
                ):
                    cpitch = resolve_pitch(cm.group("acc") or "", cm.group("letter"), cm.group("oct") or "")
                    if first_note_Ratio is None and cm.group("dur"):
                        first_note_Ratio = _parse_duration_multiplier(cm.group("dur"))
                    ntie = bool(cm.group("tie")) or chord_tie
                    t_stop = cpitch in open_ties
                    if t_stop:
                        open_ties.discard(cpitch)
                    if ntie:
                        open_ties.add(cpitch)
                    chord_notes.append(
                        _AbcNote(
                            pitch=cpitch,
                            tie_start=ntie,
                            tie_stop=t_stop,
                            hammer=slur_just_started,
                            slide=pending_slide,
                            vibrato=pending_vibrato,
                            staccato=pending_staccato,
                        )
                    )
                if first_note_Ratio is not None and not dur_str:
                    chord_num, chord_den = first_note_Ratio
                raw_ticks = round(unit_ticks * chord_num / chord_den)
                ticks, tup_hint = scale_duration(raw_ticks)
                current_bar.beats.append(
                    _AbcBeat(
                        position=cursor,
                        duration=ticks,
                        notes=chord_notes,
                        tuplet=tup_hint,
                    )
                )
                cursor += ticks

            pending_staccato = False
            pending_vibrato = False
            pending_slide = None
            slur_just_started = False

    if not current_bar.is_empty:
        bars.append(current_bar)

    return bars


def _build_master_bars(voice_bars: list[_AbcBarData]) -> list[Bar]:
    master: list[Bar] = []
    marks_per_bar: list[set[str]] = []
    for idx, vb in enumerate(voice_bars):
        master.append(
            Bar(
                signature=vb.signature,
                tempo=vb.tempo if idx > 0 else None,
                repeat_start=vb.repeat_start,
                repeat_end=vb.repeat_end,
                alternate_endings=vb.alternate_endings,
                section=vb.section,
            )
        )
        marks_per_bar.append(vb.marks)
    for bar, directions in zip(master, _directions(marks_per_bar), strict=True):
        bar.directions = directions  # type: ignore[assignment]
    return master or [Bar()]


def _voice_to_track(
    v_info: _VoiceInfo,
    *,
    index: int,
    master_bar_count: int,
    prefer: str,
    requested_preset: str,
    title: str,
) -> Track:
    pitches = [n.pitch for bar in v_info.bars for beat in bar.beats for n in beat.notes]
    lowest = min(pitches) if pitches else 40
    median = int(statistics.median(pitches)) if pitches else 52

    if requested_preset and is_preset(requested_preset):
        preset = get_preset(requested_preset)
    elif v_info.is_bass or "bass" in v_info.name.lower() or (prefer == "bass" and lowest < 52):
        preset = get_preset("bass-5" if lowest < 28 else "bass-4")
    else:
        preset_id = suggest_preset(None, lowest, median)
        preset = get_preset(preset_id)

    tuning = list(preset.tuning_midi)
    groups: list[list[int]] = []
    group_notes: list[list[_AbcNote]] = []

    for bar in v_info.bars:
        for beat in bar.beats:
            if beat.notes:
                groups.append([n.pitch for n in beat.notes])
                group_notes.append(beat.notes)

    if groups:
        fingering = assign_frets(groups, tuning)
        last_placement_by_pitch: dict[int, tuple[int, int]] = {}
        for placed_group, target_notes in zip(fingering.groups, group_notes, strict=True):
            for placement in placed_group:
                if 0 <= placement.source < len(target_notes):
                    target = target_notes[placement.source]
                    if target.tie_stop and target.pitch in last_placement_by_pitch:
                        target.string, target.fret = last_placement_by_pitch[target.pitch]
                    else:
                        target.string = placement.string
                        target.fret = placement.fret
                    last_placement_by_pitch[target.pitch] = (target.string, target.fret)

    track_bars: list[TrackBar] = []
    for bar in v_info.bars[:master_bar_count]:
        beats: list[Beat] = []
        for ab in bar.beats:
            notes = [
                Note(
                    string=an.string,
                    fret=max(0, min(99, an.fret)),
                    tie=an.tie_stop,
                    hammer=an.hammer,
                    slide=an.slide,
                    vibrato=an.vibrato,
                    staccato=an.staccato,
                )
                for an in ab.notes
                if an.string is not None and an.fret is not None
            ]
            notes.sort(key=lambda item: item.string)
            beats.append(
                Beat(
                    position=ab.position,
                    duration=max(1, ab.duration),
                    notes=notes,
                    grace=ab.grace,  # type: ignore[arg-type]
                    tuplet=ab.tuplet,
                )
            )
        track_bars.append(TrackBar(voices=[Voice(beats=beats)] if beats else [Voice()]))

    while len(track_bars) < master_bar_count:
        track_bars.append(TrackBar())

    track_name = v_info.name or preset.name or f"Track {index + 1}"
    return Track(
        id=f"trk_abc_{index}",
        name=track_name,
        instrument=preset.instrument,
        capo=0,
        tuning_midi=tuning,
        preferred=False,
        bars=track_bars or [TrackBar()],
    )
