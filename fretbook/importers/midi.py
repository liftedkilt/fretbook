"""Import a Standard MIDI File as tab.

MIDI knows pitches, not strings, so the importer places every note with
:func:`fretbook.score.fingering.assign_frets` on the instrument and tuning the reader picks. What is read:

* one *source* per MIDI track and channel that holds notes. Channel 10 (drums) is never a source. The reader picks
  the sources and a preset for each (see :func:`inspect_midi`); with no choice, every source that looks like a guitar
  or bass (by General MIDI program, else by pitch range) becomes a track;
* tempo and time-signature events. A time signature takes effect at the next bar line, and a tempo change applies from
  the bar after it happens, so bars never hold two tempos;
* notes, snapped to a grid (sixteenths by default). Notes that start together are one chord, a note lasts until the
  next onset at most (a tab voice cannot overlap itself), and a note that crosses a bar line is split and tied.

Not read: velocities, controllers, pitch bends, lyrics, and triplets (a triplet snaps to the nearest grid position).
"""

from __future__ import annotations

import io
import statistics
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import mido

from fretbook.importers.ascii_tab import _fill
from fretbook.importers.base import ImportError, ImportRequest, ImportResult, Notice, Progress
from fretbook.score.fingering import assign_frets
from fretbook.score.instruments import InstrumentPreset, family, get_preset, is_preset
from fretbook.score.model import TICKS_PER_QUARTER, Bar, Beat, Note, ScoreDocument, Track, TrackBar, Voice

EXTENSIONS = (".mid", ".midi")
MAX_BYTES = 8 * 1024 * 1024
MAX_NOTES = 200_000
MAX_BARS = 2000
GRIDS = (4, 8, 16, 32)
DEFAULT_GRID = 16
DEFAULT_BPM = 120.0
LOW_PITCH = 23
"""B0, the low string of a five-string bass."""
HIGH_PITCH = 88
"""The 24th fret of a standard guitar's high string."""
_WHOLE = 4 * TICKS_PER_QUARTER
_DRUM_CHANNEL = 9
_GUITAR_PROGRAMS = range(24, 32)
_BASS_PROGRAMS = range(32, 40)
_ACOUSTIC_PROGRAMS = (24, 25)
_DENOMINATORS = {1, 2, 4, 8, 16, 32}


@dataclass
class MidiSource:
    """The notes of one MIDI track and channel, in 960-ticks-per-quarter time."""

    id: str
    track: int
    channel: int
    name: str
    program: int | None
    notes: list[tuple[int, int, int]] = field(default_factory=list)
    """``(start, end, pitch)``."""

    @property
    def lowest(self) -> int:
        return min(pitch for _, _, pitch in self.notes)

    @property
    def highest(self) -> int:
        return max(pitch for _, _, pitch in self.notes)

    @property
    def in_range(self) -> bool:
        fits = sum(LOW_PITCH <= pitch <= HIGH_PITCH for _, _, pitch in self.notes)
        return fits * 2 >= len(self.notes)

    @property
    def instrument_program(self) -> bool:
        return self.program is not None and self.program in (*_GUITAR_PROGRAMS, *_BASS_PROGRAMS)

    @property
    def suggested_preset(self) -> str:
        return suggest_preset(self.program, self.lowest, int(statistics.median(p for _, _, p in self.notes)))


@dataclass
class ParsedMidi:
    title: str
    sources: list[MidiSource]
    tempos: list[tuple[int, float]]
    signatures: list[tuple[int, int, int]]
    drum_notes: int = 0

    @property
    def opening_bpm(self) -> float:
        return _bpm_at(self.tempos, 0)

    @property
    def opening_signature(self) -> tuple[int, int]:
        sig = _signature_at(self.signatures, 0)
        return sig[0], sig[1]

    def default_selection(self) -> list[str]:
        """Sources a reader most likely wants: guitar and bass programs, or else whatever fits the neck."""
        playable = [source for source in self.sources if source.in_range]
        programs = [source for source in playable if source.instrument_program]
        return [source.id for source in (programs or playable)]


def suggest_preset(program: int | None, lowest: int, median: int) -> str:
    """The preset a part most likely belongs to, from its General MIDI program and pitch range."""
    if program in _ACOUSTIC_PROGRAMS and lowest >= 40:
        return "guitar-acoustic"
    bass = program in _BASS_PROGRAMS or (program not in _GUITAR_PROGRAMS and median < 50)
    if bass:
        return "bass-5" if lowest < 28 else "bass-4"
    if lowest < 38:
        return "guitar-7"
    if lowest < 40:
        return "guitar-drop-d"
    return "guitar-6"


def _bpm_at(tempos: list[tuple[int, float]], tick: int) -> float:
    bpm = DEFAULT_BPM
    for at, value in tempos:
        if at > tick:
            break
        bpm = value
    return bpm


def _signature_at(signatures: list[tuple[int, int, int]], tick: int) -> tuple[int, int, int]:
    found = (0, 4, 4)
    for item in signatures:
        if item[0] > tick:
            break
        found = item
    return found


_PROGRAM_FAMILIES = (
    "Piano",
    "Chromatic percussion",
    "Organ",
    "Guitar",
    "Bass",
    "Strings",
    "Ensemble",
    "Brass",
    "Reed",
    "Pipe",
    "Synth lead",
    "Synth pad",
    "Synth effects",
    "Ethnic",
    "Percussive",
    "Sound effects",
)


def _program_family(program: int | None) -> str | None:
    if program is None:
        return None
    return _PROGRAM_FAMILIES[min(program // 8, 15)]


def read_midi(path: Path | None = None, *, data: bytes | None = None, filename: str = "") -> ParsedMidi:
    """Parse a Standard MIDI File from ``path`` or ``data`` into per-channel note lists."""
    try:
        if data is not None:
            if len(data) > MAX_BYTES:
                raise ImportError("this MIDI file is larger than 8 MB", "midi.tooLarge")
            midi = mido.MidiFile(file=io.BytesIO(data), clip=True)
        elif path is not None:
            if path.stat().st_size > MAX_BYTES:
                raise ImportError("this MIDI file is larger than 8 MB", "midi.tooLarge")
            midi = mido.MidiFile(filename=str(path), clip=True)
        else:
            raise ImportError("MIDI import needs a file", "import.needsFile")
    except ImportError:
        raise
    except (OSError, EOFError, ValueError, KeyError, IndexError) as exc:
        raise ImportError("this MIDI file could not be read", "midi.parse") from exc
    if midi.type == 2:
        raise ImportError("MIDI files with independent sequences (type 2) are not supported", "midi.type2")
    division = midi.ticks_per_beat
    if division <= 0:
        raise ImportError("this MIDI file could not be read", "midi.parse")

    def scale(ticks: int) -> int:
        return round(ticks * TICKS_PER_QUARTER / division)

    tempos: dict[int, float] = {}
    signatures: dict[int, tuple[int, int, int]] = {}
    sources: dict[tuple[int, int], MidiSource] = {}
    names: dict[int, str] = {}
    drums = 0
    count = 0
    for index, track in enumerate(midi.tracks):
        now = 0
        programs: dict[int, int] = {}
        open_notes: dict[tuple[int, int], list[int]] = {}
        for message in track:
            now += message.time
            at = scale(now)
            if message.is_meta:
                if message.type == "set_tempo" and message.tempo > 0:
                    tempos[at] = round(mido.tempo2bpm(message.tempo), 2)
                elif message.type == "time_signature":
                    if 1 <= message.numerator <= 32 and message.denominator in _DENOMINATORS:
                        signatures[at] = (at, message.numerator, message.denominator)
                elif message.type == "track_name" and index not in names and message.name.strip():
                    names[index] = message.name.strip()
                continue
            if message.type == "program_change":
                programs.setdefault(message.channel, message.program)
                continue
            if message.type not in ("note_on", "note_off"):
                continue
            key = (message.channel, message.note)
            if message.type == "note_on" and message.velocity > 0:
                open_notes.setdefault(key, []).append(at)
                continue
            starts = open_notes.get(key)
            if not starts:
                continue
            start = starts.pop(0)
            if message.channel == _DRUM_CHANNEL:
                drums += 1
                continue
            count += 1
            if count > MAX_NOTES:
                raise ImportError("this MIDI file has too many notes", "midi.tooLarge")
            source = sources.setdefault(
                (index, message.channel),
                MidiSource(f"{index}:{message.channel}", index, message.channel, "", programs.get(message.channel)),
            )
            source.notes.append((start, max(at, start), message.note))
        for (channel, pitch), starts in open_notes.items():
            if channel == _DRUM_CHANNEL:
                continue
            for start in starts:
                source = sources.setdefault(
                    (index, channel),
                    MidiSource(f"{index}:{channel}", index, channel, "", programs.get(channel)),
                )
                source.notes.append((start, max(scale(now), start), pitch))
        for (track_index, channel), source in sources.items():
            if track_index == index and source.program is None:
                source.program = programs.get(channel)

    ordered = sorted(sources.values(), key=lambda source: (source.track, source.channel))
    per_track: dict[int, int] = {}
    for source in ordered:
        per_track[source.track] = per_track.get(source.track, 0) + 1
    for source in ordered:
        base = names.get(source.track) or _program_family(source.program) or f"Track {source.track + 1}"
        source.name = f"{base} (ch {source.channel + 1})" if per_track[source.track] > 1 else base
        source.notes.sort()

    stem = Path(filename).stem if filename else ""
    first_has_notes = any(source.track == 0 for source in ordered)
    title = names.get(0, "") if midi.type == 0 or not first_has_notes else ""
    return ParsedMidi(
        title=title or stem,
        sources=ordered,
        tempos=sorted(tempos.items()),
        signatures=sorted(signatures.values()),
        drum_notes=drums,
    )


@dataclass
class MidiOptions:
    tracks: list[str] | None = None
    """Source ids to import (``"track:channel"``); ``None`` picks :meth:`ParsedMidi.default_selection`."""
    preset: str | None = None
    """One preset for every chosen source; ``None`` suggests one per source."""
    presets: dict[str, str] = field(default_factory=dict)
    """A preset for individual sources, taking precedence over ``preset``."""
    capo: int = 0
    grid: int = DEFAULT_GRID

    @classmethod
    def from_dict(cls, raw: dict[str, Any] | None) -> MidiOptions:
        raw = raw or {}
        tracks = raw.get("tracks")
        return cls(
            tracks=[str(item) for item in tracks] if tracks is not None else None,
            preset=raw.get("preset") or None,
            presets={str(key): str(value) for key, value in (raw.get("presets") or {}).items()},
            capo=int(raw.get("capo") or 0),
            grid=int(raw.get("grid") or DEFAULT_GRID),
        )


def _preset_for(source: MidiSource, options: MidiOptions) -> InstrumentPreset:
    wanted = options.presets.get(source.id) or options.preset or source.suggested_preset
    if not is_preset(wanted):
        raise ImportError(f"unknown instrument {wanted!r}", "midi.badPreset", preset=wanted)
    return get_preset(wanted)


def _bars(parsed: ParsedMidi, end: int) -> list[tuple[int, Bar]]:
    """``(start tick, bar)`` for every bar up to ``end``, with signatures at bar lines and tempo changes marked."""
    bars: list[tuple[int, Bar]] = []
    tick = 0
    previous_bpm = parsed.opening_bpm
    while tick < end or not bars:
        _, numerator, denominator = _signature_at(parsed.signatures, tick)
        bpm = _bpm_at(parsed.tempos, tick)
        bar = Bar(signature=(numerator, denominator))
        if bars and bpm != previous_bpm:
            bar.tempo = min(max(bpm, 1.0), 399.0)
        previous_bpm = bpm
        bars.append((tick, bar))
        tick += bar.length_ticks
        if len(bars) > MAX_BARS:
            raise ImportError("this MIDI file is longer than 2000 bars", "midi.tooLong", limit=MAX_BARS)
    return bars


@dataclass
class _Event:
    start: int
    duration: int
    pitches: list[int]


def _events(source: MidiSource, grid_ticks: int) -> list[_Event]:
    def snap(tick: int) -> int:
        return round(tick / grid_ticks) * grid_ticks

    starts: dict[int, dict[int, int]] = {}
    for start, end, pitch in source.notes:
        begin = snap(start)
        finish = max(snap(end), begin + grid_ticks)
        held = starts.setdefault(begin, {})
        held[pitch] = max(held.get(pitch, 0), finish - begin)
    ordered = sorted(starts)
    events: list[_Event] = []
    for position, begin in enumerate(ordered):
        held = starts[begin]
        duration = max(held.values())
        if position + 1 < len(ordered):
            duration = min(duration, ordered[position + 1] - begin)
        events.append(_Event(begin, duration, sorted(held, reverse=True)))
    return events


def _layout(
    events: list[_Event], placements: list[list[tuple[int, int]]], bars: list[tuple[int, Bar]]
) -> list[TrackBar]:
    """Lay the placed events out bar by bar: rests for gaps, ties for notes across bar lines or beyond one value."""
    starts = [start for start, _ in bars]
    pieces: list[list[tuple[int, int, list[tuple[int, int]], bool]]] = [[] for _ in bars]
    bar_index = 0
    for event, placed in zip(events, placements, strict=True):
        if not placed:
            continue
        cursor = event.start
        remaining = event.duration
        first = True
        while remaining > 0:
            while bar_index + 1 < len(starts) and starts[bar_index + 1] <= cursor:
                bar_index += 1
            while bar_index > 0 and starts[bar_index] > cursor:
                bar_index -= 1
            bar_end = starts[bar_index] + bars[bar_index][1].length_ticks
            length = min(remaining, bar_end - cursor)
            pieces[bar_index].append((cursor - starts[bar_index], length, placed, not first))
            cursor += length
            remaining -= length
            first = False
    result: list[TrackBar] = []
    for index, (_, bar) in enumerate(bars):
        beats: list[Beat] = []
        position = 0
        for at, length, placed, continues in pieces[index]:
            for rest in _fill(at - position):
                beats.append(Beat(position=position, duration=rest))
                position += rest
            for part, duration in enumerate(_fill(length)):
                tie = continues or part > 0
                notes = [Note(string=string, fret=fret, tie=tie) for string, fret in sorted(placed)]
                beats.append(Beat(position=position, duration=duration, notes=notes))
                position += duration
        for rest in _fill(bar.length_ticks - position):
            beats.append(Beat(position=position, duration=rest))
            position += rest
        result.append(TrackBar(voices=[Voice(beats=beats)]))
    return result


def build_document(parsed: ParsedMidi, options: MidiOptions) -> tuple[ScoreDocument, list[Notice], list[MidiSource]]:
    if options.grid not in GRIDS:
        raise ImportError(f"grid must be one of {GRIDS}", "midi.badGrid", grid=options.grid)
    if not 0 <= options.capo <= 24:
        raise ImportError("capo must be between 0 and 24", "midi.badCapo")
    by_id = {source.id: source for source in parsed.sources}
    wanted = options.tracks if options.tracks is not None else parsed.default_selection()
    unknown = [item for item in wanted if item not in by_id]
    if unknown:
        raise ImportError(f"no such MIDI track: {unknown[0]}", "midi.noSuchTrack", track=unknown[0])
    chosen = [by_id[item] for item in dict.fromkeys(wanted)]
    if not chosen:
        raise ImportError("this MIDI file has no guitar or bass notes to import", "midi.noTracks")

    grid_ticks = _WHOLE // options.grid
    prepared = [(source, _preset_for(source, options), _events(source, grid_ticks)) for source in chosen]
    end = max(event.start + event.duration for _, _, events in prepared for event in events)
    bars = _bars(parsed, end)
    notices: list[Notice] = []
    tracks: list[Track] = []
    for source, preset, events in prepared:
        fingering = assign_frets([event.pitches for event in events], preset.tuning_midi, capo=options.capo)
        if fingering.shifted:
            notices.append(
                Notice(
                    "midi.shifted",
                    "{count} note(s) on '{track}' are outside the instrument's range and were moved by octaves",
                    {"count": len(fingering.shifted), "track": source.name},
                )
            )
        if fingering.dropped:
            notices.append(
                Notice(
                    "midi.dropped",
                    "{count} chord(s) on '{track}' cannot be fingered in one position and lost some notes",
                    {"count": len(fingering.dropped), "track": source.name},
                )
            )
        placements = [[(item.string, item.fret) for item in group] for group in fingering.groups]
        tracks.append(
            Track(
                id=f"midi-{source.track}-{source.channel}",
                name=source.name,
                instrument=preset.instrument,
                capo=options.capo,
                tuning_midi=list(preset.tuning_midi),
                preferred=not tracks,
                bars=_layout(events, placements, bars),
            )
        )
    document = ScoreDocument(bpm=min(max(parsed.opening_bpm, 1.0), 399.0), bars=[bar for _, bar in bars], tracks=tracks)
    return document, notices, chosen


class MidiImporter:
    kind = "midi"

    def can_handle(self, request: ImportRequest) -> bool:
        return (request.filename or "").lower().endswith(EXTENSIONS)

    def import_score(self, request: ImportRequest, progress: Progress) -> ImportResult:
        if request.file_path is None:
            raise ImportError("MIDI import needs a file", "import.needsFile")
        progress("Reading MIDI", "import.readingFile")
        parsed = read_midi(request.file_path, filename=request.filename or request.file_path.name)
        options = MidiOptions.from_dict(request.options.get("midi"))
        document, notices, chosen = build_document(parsed, options)
        slug = Path(request.filename or request.file_path.name).stem
        slug = "".join(ch.lower() if ch.isalnum() else "-" for ch in slug).strip("-") or "song"
        families = {family(track.instrument) for track in document.tracks}
        return ImportResult(
            title=parsed.title or slug,
            artist="",
            slug=slug[:60],
            source_kind="midi",
            source_ref={
                "grid": options.grid,
                "tracks": [source.id for source in chosen],
                "families": sorted(families),
            },
            document=document,
            warnings=notices,
        )
