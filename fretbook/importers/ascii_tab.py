"""Import plain ASCII tab (``e|---3---|``) as a score.

ASCII tab has no rhythm, so the importer estimates it: every bar is given its
signature's length, and each chord or note is placed on a grid (eighth notes
by default) from where it sits between the bar lines. Durations run to the next
note, rounded down to a value the notation can draw, with rests for the rest.
The result is marked ``rhythm_estimated`` so the UI can say so.

What is read:

* tab systems of 4 to 8 string rows, with or without string labels; systems with different tunings (a bass and
  a guitar tab in one file) become separate tracks, with empty bars where the other instrument plays; the tuning
  comes from the labels (``e B G D A E``, ``E A D G``, ``B E A D G`` and so on, in either order)
  or from the string count;
* multi-digit frets, hammer-ons and pull-offs (``h p``), slides (``/ \\ s``), bends (``b ^``, with a
  target fret and a release), vibrato (``~ v``), dead notes (``x``), ghost notes (``( )``),
  natural harmonics (``< >``), and ``PM`` / ``LR`` rows above or below a system;
* bar lines, repeat dots (``|: :|``, ``|* *|``), ``x4`` markers, and ``[Verse]`` style headers;
* chord names, lyrics and other text between systems, which are skipped.

Text that is chords over lyrics has no tab system; :func:`looks_like_ascii_tab`
is how callers tell the two apart before they pick this or the ChordPro importer.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from fretbook.chords import chordpro
from fretbook.importers.base import ImportError, ImportRequest, ImportResult, Notice, Progress
from fretbook.score.instruments import get_preset
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
from fretbook.score.tuning import labels_to_midi, pitch_class

MAX_CHARS = chordpro.MAX_CHARS
GRIDS = (4, 8, 16, 32)
"""Note values a position can snap to: quarter, eighth, sixteenth, thirty-second."""
DEFAULT_GRID = 8
DEFAULT_BPM = 120.0
EXTENSIONS = (".tab",)
TEXT_EXTENSIONS = (".txt",)
_WHOLE = 4 * TICKS_PER_QUARTER
_MIN_GRID_TICKS = _WHOLE // 64
_SYSTEM_SIZES = (6, 4, 5, 7, 8)
_EIGHT_STRING = (64, 59, 55, 50, 45, 40, 35, 30)
_PRESET_BY_COUNT = {4: "bass-4", 5: "bass-5", 6: "guitar-6", 7: "guitar-7"}

_LABEL = re.compile(r"^[A-Ga-g][#b]?\d?$")
_ROW_START = re.compile(r"^\s*(?P<label>[A-Ga-g][#b]?\d?|[A-Za-z]{1,3})?[ \t]*(?P<sep>\|)?")
_BODY_CHARS = set("-|:*0123456789") | set("hHpPbBrRsSxXvVtT/\\~()<>^.=gG")
_ANNOTATION = re.compile(r"^(?P<pad>\s*)(?P<kind>P\.?M\.?|L\.?R\.?)(?P<span>[\s:]*[-~=_]+[-~=_|\s.]*)$")
_REPEAT_COUNT = r"(?:[xX×]\s*(?P<a>\d+)|(?P<b>\d+)\s*[xX×])\s*(?:times)?"
_REPEAT_LINE = re.compile(rf"^\s*\(?\s*{_REPEAT_COUNT}\s*\)?\s*$")
_TRAILING_REPEAT = re.compile(rf"^\s*{_REPEAT_COUNT}\s*$")
_SECTION = re.compile(
    r"^\s*(?:\[(?P<bracket>[^\]]+)\]|(?P<word>(?:intro|verse|chorus|pre-?chorus|bridge|solo|outro|interlude|riff|"
    r"main riff|refrain|break|hook|coda|ending|fill|lick|breakdown|instrumental|tag|turnaround)"
    r"(?:\s+[0-9A-Za-z]{1,2})?))\s*[:.]?\s*"
    rf"(?:\(?\s*{_REPEAT_COUNT}\s*\)?)?\s*$",
    re.IGNORECASE,
)
_META = re.compile(r"^\s*(?P<key>title|song|artist|band|by)\s*[:=]\s*(?P<value>.+?)\s*$", re.IGNORECASE)
_TEMPO = re.compile(r"\b(?:tempo|bpm)\s*[:=]?\s*(\d{2,3})\b|\b(\d{2,3})\s*bpm\b|[♩♪]\s*=\s*(\d{2,3})", re.IGNORECASE)
_REPRESENTABLE = sorted(
    {
        int(plain * factor)
        for plain in (_WHOLE >> n for n in range(7))
        for factor in (1, 1.5, 1.75)
        if (plain * factor).is_integer()
    },
    reverse=True,
)


@dataclass
class ParsedTab:
    document: ScoreDocument
    title: str
    artist: str
    warnings: list[Notice] = field(default_factory=list)
    system_count: int = 0


@dataclass
class _Row:
    label: str
    body: str
    body_start: int


@dataclass
class _Line:
    kind: Literal["blank", "row", "annotation", "section", "repeat", "chords", "text"]
    text: str
    row: _Row | None = None
    span: tuple[int, int] | None = None
    """For an annotation row: the first and last column it covers."""
    kind_name: str = ""
    name: str = ""
    count: int = 0


@dataclass
class _Raw:
    col: int
    width: int
    fret: int
    dead: bool = False
    ghost: bool = False
    harmonic: bool = False
    hammer: bool = False
    slide: SlideKind | None = None
    vibrato: bool = False
    bend: float | None = None
    abs_col: int = 0


@dataclass
class _Segment:
    start: int
    text: str
    repeat_start: bool = False
    repeat_end: bool = False


@dataclass
class _System:
    rows: list[_Row]
    annotations: list[_Line] = field(default_factory=list)
    section: str | None = None
    repeat: int = 0


# ---------------------------------------------------------------------------
# Reading lines


def _split_row(line: str) -> _Row | None:
    text = line.rstrip()
    start = _ROW_START.match(text)
    if start is None:  # pragma: no cover - every part of the pattern is optional
        return None
    label = start.group("label") or ""
    body = text[start.end() :]
    if not start.group("sep") and not (label and body.startswith("-")):
        return None
    # Anything after the last bar line is a note to the reader ("x4", "mute the strings"), not tab.
    visible = body[: body.rfind("|") + 1 or None].replace(" ", "")
    if visible.count("-") < 3 or any(char not in _BODY_CHARS for char in visible):
        return None
    return _Row(label, body, start.end())


def _repeat_count(match: re.Match[str]) -> int:
    return min(int(match.group("a") or match.group("b")), 32)


def _classify(raw: str) -> _Line:
    text = raw.replace("\t", "    ").rstrip()
    if not text.strip():
        return _Line("blank", "")
    annotation = _ANNOTATION.match(text)
    if annotation:
        end = len(text.rstrip("| ")) - 1
        return _Line("annotation", text, span=(len(annotation.group("pad")), end), kind_name=annotation.group("kind"))
    row = _split_row(text)
    if row:
        return _Line("row", text, row=row)
    repeat = _REPEAT_LINE.match(text)
    if repeat:
        return _Line("repeat", text, count=_repeat_count(repeat))
    section = _SECTION.match(text)
    if section:
        name = (section.group("bracket") or section.group("word")).strip()
        if not chordpro.is_chord(name):
            count = _repeat_count(section) if section.group("a") or section.group("b") else 0
            return _Line("section", text, name=name, count=count)
    if chordpro.is_chord_line(text):
        return _Line("chords", text)
    return _Line("text", text)


def _has_notes(rows: list[_Row]) -> bool:
    return any(re.search(r"[0-9xX]", row.body) for row in rows)


def _blocks(lines: list[_Line]) -> list[tuple[int, int]]:
    """Index ranges of consecutive string rows that make up one or more systems."""
    found: list[tuple[int, int]] = []
    index = 0
    while index < len(lines):
        if lines[index].kind != "row":
            index += 1
            continue
        end = index
        while end < len(lines) and lines[end].kind == "row":
            end += 1
        rows = [line.row for line in lines[index:end] if line.row]
        if len(rows) >= 4 and _has_notes(rows):
            found.append((index, end))
        index = end
    return found


def looks_like_ascii_tab(text: str) -> bool:
    """True when the text holds at least one tab system of four to eight string rows with a note in it."""
    lines = [_classify(line) for line in text.replace("\r\n", "\n").split("\n")]
    return bool(_gather(lines)[0])


# ---------------------------------------------------------------------------
# One string row


def _segments(row: _Row) -> tuple[list[_Segment], int]:
    """Bars of one row, and the repeat count written after its last bar line."""
    parts: list[tuple[int, str]] = []
    position = row.body_start
    for part in row.body.split("|"):
        parts.append((position, part))
        position += len(part) + 1
    repeat = 0
    last = parts[-1][1]
    if len(parts) > 1:
        trailing = _TRAILING_REPEAT.match(last)
        if trailing:
            repeat = _repeat_count(trailing)
            parts.pop()
        elif "-" not in last or any(char not in _BODY_CHARS and char != " " for char in last):
            parts.pop()
    segments: list[_Segment] = []
    for start, part in parts:
        if "-" not in part and not re.search(r"\d", part):
            continue
        opens = part.startswith((":", "*"))
        closes = part.rstrip().endswith((":", "*"))
        # Repeat dots take a column on some rows only; as dashes they keep every row the same width.
        text = re.sub(r"^[:*]|[:*]$", "-", part.rstrip()) + part[len(part.rstrip()) :]
        segments.append(_Segment(start, text, opens, closes))
    return segments, repeat


def _scan(part: str, start: int) -> list[_Raw]:
    notes: list[_Raw] = []
    last: _Raw | None = None
    chain_end = -1
    pending_slide: SlideKind | None = None
    parens = 0
    angles = 0
    index = 0
    length = len(part)

    def adjacent_before(at: int) -> bool:
        return last is not None and at > 0 and chain_end == at

    def digits_at(at: int) -> str:
        found = re.match(r"\d{1,2}", part[at:])
        return found.group(0) if found else ""

    while index < length:
        char = part[index]
        if char.isdigit():
            digits = digits_at(index)
            note = _Raw(index, len(digits), int(digits), ghost=parens > 0, harmonic=angles > 0, abs_col=start + index)
            if pending_slide:
                note.slide, pending_slide = pending_slide, None
            notes.append(note)
            last = note
            index += len(digits)
            chain_end = index
            continue
        if char in "xX":
            note = _Raw(index, 1, 0, dead=True, ghost=parens > 0, abs_col=start + index)
            notes.append(note)
            last = note
            index += 1
            chain_end = index
            continue
        before = adjacent_before(index)
        after = index + 1 < length and (part[index + 1].isdigit() or part[index + 1] in "(<xX")
        if char in "()<>":
            if char == "(":
                parens += 1
            elif char == ")":
                parens = max(0, parens - 1)
            elif char == "<":
                angles += 1
            else:
                angles = max(0, angles - 1)
            if char in ")>" and last is not None and chain_end == index:
                chain_end = index + 1
        elif char in "hHpP" and before and last is not None:
            last.hammer = True
        elif char in "/\\s":
            up = char != "\\"
            if before and after and last is not None:
                last.slide = "shift"
            elif before and last is not None:
                last.slide = "out_up" if up else "out_down"
            elif after:
                pending_slide = "in_below" if up else "in_above"
        elif char in "b^" and before and last is not None:
            target = digits_at(index + 1)
            index += len(target)
            semitones = int(target) - last.fret if target else 2
            last.bend = float(min(semitones if semitones > 0 else 2, 4))
            release = re.match(r"r\d{0,2}", part[index + 1 :], re.IGNORECASE)
            if release:
                index += len(release.group(0))
            chain_end = index + 1
        elif char in "rR" and before:
            index += len(digits_at(index + 1))
        elif char in "~vV" and last is not None and chain_end == index:
            last.vibrato = True
            chain_end = index + 1
        index += 1
    return notes


# ---------------------------------------------------------------------------
# Tuning


def _drop(labels: list[str]) -> int:
    """Total semitones walking down the labels. A string order that really descends scores lowest."""
    classes = [pitch_class(re.sub(r"\d", "", label)) for label in labels]
    return sum((before - after) % 12 for before, after in zip(classes, classes[1:], strict=False))


def _tuning(systems: list[_System]) -> tuple[list[int], bool]:
    """MIDI notes highest string first, and whether the rows were written lowest string first."""
    for system in systems:
        labels = [row.label for row in system.rows]
        if all(_LABEL.match(label) for label in labels):
            upside_down = _drop(labels[::-1]) < _drop(labels)
            ordered = labels[::-1] if upside_down else labels
            if ordered[0] == "e":
                # A lowercase top e is the guitar's high string, even on a tab that shows only a few strings.
                ordered = ["E4", *ordered[1:]]
            return labels_to_midi(ordered), upside_down
    count = len(systems[0].rows)
    if count in _PRESET_BY_COUNT:
        return list(get_preset(_PRESET_BY_COUNT[count]).tuning_midi), False
    return list(_EIGHT_STRING[:count]), False


@dataclass
class _Group:
    """Systems that are one instrument: the same strings and tuning."""

    tuning: list[int]
    upside_down: bool
    systems: list[_System] = field(default_factory=list)


def _instrument(tuning: list[int]) -> str:
    return "bass-guitar" if len(tuning) <= 5 and tuning[0] < 52 else "guitar"


def _labelled(system: _System) -> bool:
    return all(_LABEL.match(row.label) for row in system.rows)


def _groups(systems: list[_System]) -> list[_Group]:
    """One group per tuning, in the order each first appears. Rows without labels join the first group of their size."""
    found: dict[tuple[int, ...], _Group] = {}
    for system in systems:
        if _labelled(system):
            tuning, upside_down = _tuning([system])
            found.setdefault(tuple(tuning), _Group(tuning, upside_down)).systems.append(system)
    for system in systems:
        if not _labelled(system):
            group = next((item for item in found.values() if len(item.tuning) == len(system.rows)), None)
            if group is None:
                tuning, upside_down = _tuning([system])
                group = found.setdefault(tuple(tuning), _Group(tuning, upside_down))
            group.systems.append(system)
    for group in found.values():
        group.systems.sort(key=systems.index)
    return sorted(found.values(), key=lambda group: systems.index(group.systems[0]))


# ---------------------------------------------------------------------------
# Rhythm


def _fit_grid(bar_ticks: int, grid: int) -> int:
    ticks = _WHOLE // grid
    while bar_ticks % ticks:
        ticks //= 2
    return ticks


def _fill(ticks: int) -> list[int]:
    """Durations that add up to ``ticks``, each one the notation can draw."""
    parts: list[int] = []
    while ticks > 0:
        value = next((item for item in _REPRESENTABLE if item <= ticks), ticks)
        parts.append(value)
        ticks -= value
    return parts


def _clusters(notes: list[tuple[int, _Raw]]) -> list[list[tuple[int, _Raw]]]:
    """Notes that sit on the same beat: their columns overlap, whichever end a wide fret is aligned to."""
    groups: list[list[tuple[int, _Raw]]] = []
    high = -1
    for item in sorted(notes, key=lambda pair: (pair[1].col, pair[0])):
        taken = {string for string, _ in groups[-1]} if groups else set()
        if groups and item[1].col <= high and item[0] not in taken:
            groups[-1].append(item)
            high = max(high, item[1].col + item[1].width - 1)
        else:
            groups.append([item])
            high = item[1].col + item[1].width - 1
    return groups


def _slots(columns: list[int], width: int, count: int) -> list[int]:
    slots: list[int] = []
    for column in columns:
        slot = column * count // max(width, 1)
        slots.append(max(slot, slots[-1] + 1) if slots else slot)
    for index in range(len(slots) - 1, -1, -1):
        slots[index] = min(slots[index], count - (len(slots) - index))
    return slots


def _build_bar(
    clusters: list[list[tuple[int, _Raw]]],
    width: int,
    bar_ticks: int,
    grid: int,
    annotations: list[_Line],
    bar_number: int,
    pad: int,
) -> tuple[TrackBar, int]:
    """The notes of one bar, and the grid (in ticks) it ended up on."""
    if not clusters:
        return TrackBar(), _WHOLE // grid
    ticks = _fit_grid(bar_ticks, grid)
    while len(clusters) > bar_ticks // ticks:
        if ticks // 2 < _MIN_GRID_TICKS:
            raise ImportError(f"bar {bar_number} has too many notes to place", "asciiTab.tooDense", bar=bar_number)
        ticks //= 2
    columns = [max(min(raw.col for _, raw in cluster) - pad, 0) for cluster in clusters]
    slots = _slots(columns, width - pad, bar_ticks // ticks)
    beats: list[Beat] = []
    cursor = 0
    for index, cluster in enumerate(clusters):
        position = slots[index] * ticks
        for rest in _fill(position - cursor):
            beats.append(Beat(position=cursor, duration=rest))
            cursor += rest
        end = slots[index + 1] * ticks if index + 1 < len(clusters) else bar_ticks
        duration = next(item for item in _REPRESENTABLE if item <= end - position)
        notes = [_note(string, raw, annotations) for string, raw in sorted(cluster, key=lambda pair: pair[0])]
        beats.append(Beat(position=position, duration=duration, notes=notes))
        cursor = position + duration
    for rest in _fill(bar_ticks - cursor):
        beats.append(Beat(position=cursor, duration=rest))
        cursor += rest
    return TrackBar(voices=[Voice(beats=beats)]), ticks


def _note(string: int, raw: _Raw, annotations: list[_Line]) -> Note:
    muted = any(
        line.kind_name.startswith("P") and line.span and line.span[0] <= raw.abs_col <= line.span[1]
        for line in annotations
    )
    ring = any(
        line.kind_name.startswith("L") and line.span and line.span[0] <= raw.abs_col <= line.span[1]
        for line in annotations
    )
    return Note(
        string=string,
        fret=raw.fret,
        dead=raw.dead,
        ghost=raw.ghost,
        hammer=raw.hammer,
        slide=raw.slide,
        vibrato=raw.vibrato,
        harmonic="natural" if raw.harmonic else None,
        bend=raw.bend,
        palm_mute=muted,
        let_ring=ring,
    )


# ---------------------------------------------------------------------------
# Systems


def _system_rows(rows: list[_Row]) -> list[list[_Row]]:
    if len(rows) <= 8:
        return [rows]
    first = rows[0].label
    repeats = [index for index, row in enumerate(rows[1:], 1) if first and row.label == first]
    sizes = [index for index in repeats[:1] if 4 <= index <= 8] + list(_SYSTEM_SIZES)
    for size in sizes:
        if len(rows) % size == 0:
            return [rows[start : start + size] for start in range(0, len(rows), size)]
    return []


def _gather(lines: list[_Line]) -> tuple[list[_System], int]:
    """Systems in reading order with their section, repeat and annotation lines, and how many rows were skipped."""
    systems: list[_System] = []
    claimed: set[int] = set()
    section: str | None = None
    section_repeat = 0
    skipped = 0
    blocks = _blocks(lines)
    inside = {index for start, end in blocks for index in range(start, end)}
    block_starts = {start for start, _ in blocks}
    index = 0
    while index < len(lines):
        line = lines[index]
        if line.kind == "section":
            section, section_repeat = line.name, line.count
        elif line.kind == "row" and index not in inside:
            skipped += 1
        elif index in block_starts:
            end = next(stop for start, stop in blocks if start == index)
            groups = _system_rows([item.row for item in lines[index:end] if item.row])
            skipped += (end - index) - sum(len(group) for group in groups)
            annotations: list[_Line] = []
            above = index - 1
            while above >= 0 and lines[above].kind == "annotation":
                annotations.append(lines[above])
                above -= 1
            below = end
            while below < len(lines) and lines[below].kind == "annotation":
                annotations.append(lines[below])
                below += 1
            repeat = section_repeat
            if above >= 0 and lines[above].kind == "repeat" and above not in claimed:
                repeat = lines[above].count
                claimed.add(above)
            elif below < len(lines) and lines[below].kind == "repeat" and below not in claimed:
                repeat = lines[below].count
                claimed.add(below)
            for position, rows in enumerate(groups):
                systems.append(
                    _System(rows, annotations, section if position == 0 else None, repeat if position == 0 else 0)
                )
            section, section_repeat = None, 0
            index = end - 1
        elif line.kind == "repeat" and index not in claimed:
            section_repeat = line.count
        index += 1
    return systems, skipped


def _heading(lines: list[_Line]) -> tuple[str, str, float | None]:
    title = artist = ""
    tempo: float | None = None
    guess = ""
    seen_system = False
    for line in lines:
        if line.kind == "row":
            seen_system = True
        if line.kind != "text" and line.kind != "chords":
            continue
        meta = _META.match(line.text)
        if meta:
            key = meta.group("key").lower()
            if key in {"artist", "band", "by"}:
                artist = artist or meta.group("value")
            else:
                title = title or meta.group("value")
            continue
        found = _TEMPO.search(line.text) if len(line.text) < 60 else None
        if found and tempo is None:
            value = float(next(group for group in found.groups() if group))
            tempo = value if 20 <= value < 400 else None
            continue
        if not seen_system and not guess and line.kind == "text" and len(line.text.strip()) <= 80:
            guess = line.text.strip()
    return title or guess, artist, tempo


def parse(
    text: str,
    *,
    grid: int = DEFAULT_GRID,
    signature: tuple[int, int] = (4, 4),
    bpm: float | None = None,
) -> ParsedTab:
    """Turn ASCII tab into a score document. Raises :class:`ImportError` when the text has no tab in it."""
    if len(text) > MAX_CHARS:
        raise ImportError(f"tab is longer than {MAX_CHARS} characters", "asciiTab.tooLong", limit=MAX_CHARS)
    if grid not in GRIDS:
        raise ImportError(f"grid must be one of {GRIDS}", "asciiTab.badGrid")
    lines = [_classify(line) for line in text.replace("\r\n", "\n").split("\n")]
    systems, _ = _gather(lines)
    if not systems:
        raise ImportError("no tab found: expected four or more string rows such as e|---3---|", "asciiTab.noTab")
    title, artist, found_tempo = _heading(lines)
    warnings: list[Notice] = []
    groups = _groups(systems)
    group_of = {id(system): group for group in groups for system in group.systems}
    numerator, denominator = signature
    bar_ticks = _WHOLE * numerator // denominator
    bars: list[Bar] = []
    placed: dict[int, dict[int, TrackBar]] = {id(group): {} for group in groups}
    refined = 0
    for system in systems:
        group = group_of[id(system)]
        rows = system.rows[::-1] if group.upside_down else system.rows
        parsed = [_segments(row) for row in rows]
        counts = Counter(len(segments) for segments, _ in parsed if segments)
        total = counts.most_common(1)[0][0]
        trailing = max((repeat for _, repeat in parsed), default=0) or system.repeat
        first = len(bars)
        for number in range(total):
            cells = [segments[number] if number < len(segments) else None for segments, _ in parsed]
            opens = any(cell.repeat_start for cell in cells if cell)
            closes = any(cell.repeat_end for cell in cells if cell)
            # Repeat dots mark the bar's edge, not a position in it, so every row drops that column.
            trimmed = [
                (cell.text[int(opens) : len(cell.text) - int(closes)], cell.start + int(opens)) if cell else None
                for cell in cells
            ]
            width = max(len(text) for text, _ in filter(None, trimmed))
            # A dash before the first note is spacing, not time, so it does not push the notes later.
            pad = int(all(text.startswith("-") for text, _ in filter(None, trimmed)))
            raw: list[tuple[int, _Raw]] = []
            for string, cell in enumerate(trimmed):
                if cell:
                    raw.extend((string, note) for note in _scan(*cell))
            track_bar, used = _build_bar(_clusters(raw), width, bar_ticks, grid, system.annotations, len(bars) + 1, pad)
            refined += used < _WHOLE // grid
            placed[id(group)][len(bars)] = track_bar
            bars.append(
                Bar(
                    signature=signature,
                    repeat_start=opens,
                    repeat_end=2 if closes else 0,
                )
            )
        if system.section:
            bars[first].section = system.section
        if trailing:
            bars[first].repeat_start = True
            bars[-1].repeat_end = trailing
    if refined:
        warnings.append(
            Notice(
                "asciiTab.gridRefined",
                f"{refined} bar(s) have more notes than the grid has slots, so a finer grid was used there",
                {"count": refined},
            )
        )
    tracks: list[Track] = []
    for index, group in enumerate(groups):
        instrument = _instrument(group.tuning)
        base = "Bass" if instrument == "bass-guitar" else "Guitar"
        sharing = [item for item in groups if _instrument(item.tuning) == instrument]
        tracks.append(
            Track(
                id=f"trk_ascii_{index}",
                name=f"{base} {sharing.index(group) + 1}" if len(sharing) > 1 else base,
                instrument=instrument,
                tuning_midi=group.tuning,
                preferred=index == 0,
                # A bar another group wrote has nothing for this instrument, so it is empty and the tracks line up.
                bars=[placed[id(group)].get(number, TrackBar()) for number in range(len(bars))],
            )
        )
    document = ScoreDocument(bpm=bpm or found_tempo or DEFAULT_BPM, bars=bars, tracks=tracks)
    warnings.insert(
        0,
        Notice(
            "import.rhythmEstimated",
            "ASCII tab has no rhythm, so note lengths were estimated from the spacing. Check the timing.",
        ),
    )
    return ParsedTab(document, title, artist, warnings, len(systems))


def _slug(stem: str) -> str:
    return (re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-") or "song")[:60]


def read_text(path: Path) -> str:
    raw = path.read_bytes()
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw.decode("cp1252", errors="replace")


class AsciiTabImporter:
    kind = "ascii-tab"

    def can_handle(self, request: ImportRequest) -> bool:
        name = (request.filename or "").lower()
        if name.endswith(EXTENSIONS):
            return True
        if name.endswith(TEXT_EXTENSIONS) and request.file_path is not None:
            return looks_like_ascii_tab(read_text(request.file_path)[:MAX_CHARS])
        return False

    def import_score(self, request: ImportRequest, progress: Progress) -> ImportResult:
        if request.file_path is None:
            raise ImportError("ASCII tab import needs a file", "import.needsFile")
        progress("Reading the file", "import.readingFile")
        text = read_text(request.file_path)
        options = request.options
        numerator, denominator = options.get("signature") or (4, 4)
        parsed = parse(
            text,
            grid=int(options.get("grid") or DEFAULT_GRID),
            signature=(int(numerator), int(denominator)),
            bpm=options.get("bpm"),
        )
        stem = Path(request.filename or request.file_path.name).stem
        title = str(options.get("title") or parsed.title or stem)
        progress("Ready", "import.tabReady")
        return ImportResult(
            title=title,
            artist=str(options.get("artist") or parsed.artist),
            slug=_slug(stem),
            document=parsed.document,
            source_kind="ascii-tab",
            source_ref={
                "filename": request.filename or request.file_path.name,
                "rhythm_estimated": True,
                "grid": int(options.get("grid") or DEFAULT_GRID),
            },
            warnings=parsed.warnings,
        )
