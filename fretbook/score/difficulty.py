"""Estimate how hard a track is to play, from the score alone.

Six factors are measured on the notes, each mapped to ``0..1`` (0 is trivial, 1 is as hard as the scale goes),
and a weighted sum gives the track a level from 1 to 10. Each factor is returned with its raw measurement so
the player can see *why* a track got its level; the client words the explanation, so nothing here is prose.

* ``density``: notes per second in the busiest fifth of the bars, so tempo counts.
* ``shifts``: big jumps of the fretting hand between neighbouring beats, per bar.
* ``stretch``: the widest fret span inside a chord or a double stop (the 95th percentile, so one outlier does not
  decide).
* ``techniques``: how many notes are bends, slides, hammer-ons or pull-offs, harmonics, vibrato or dead notes.
* ``chords``: how often the chord shape changes, and how many different shapes there are.
* ``rhythm``: the share of beats that are tuplets, off the sixteenth-note grid, or shorter than a sixteenth, plus
  odd or changing time signatures.

The numbers are a heuristic tuned so that a slow open-position riff is about 2, a typical rock song about 4 to 6,
and fast, technical lead playing 8 or more. Bump :data:`VERSION` when they change: stored levels are recomputed at
start-up when their version is older.

A chord sheet has no notes, so :func:`estimate_chordpro` rates it from its chords instead, with four factors of its
own (:data:`CHORD_FACTORS`): how many different chords it uses, how many of them are barre chords, how many are
extended (ninths, diminished, added notes and the like), and how often the chord changes from line to line.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from math import ceil

from fretbook.chords.chordpro import is_chord
from fretbook.score.model import Beat, ScoreDocument, Track, bar_seconds, preferred_track

VERSION = 2
"""Version of the estimate. Rows stored with an older one are recomputed."""

FACTORS = ("density", "shifts", "stretch", "techniques", "chords", "rhythm")
_WEIGHTS = {
    "density": 0.30,
    "shifts": 0.15,
    "stretch": 0.15,
    "techniques": 0.15,
    "chords": 0.10,
    "rhythm": 0.15,
}
CHORD_FACTORS = ("vocabulary", "barres", "extensions", "changes")
_CHORD_WEIGHTS = {"vocabulary": 0.25, "barres": 0.30, "extensions": 0.15, "changes": 0.30}
CHORD_SHEET_TRACK_ID = "chords"
CHORD_SHEET_TRACK_NAME = "Chords"

# A weighted sum rarely reaches 1 even on hard music, so it is stretched before it is mapped to 1..10.
_SCALE = 1.5
MIN_LEVEL = 1.0
MAX_LEVEL = 10.0

_SHIFT_FRETS = 4
"""A jump of at least this many frets between beats counts as a position shift."""
_SIXTEENTH = 240
"""Ticks in a sixteenth note (the score has 960 to a quarter)."""
_COMMON_NUMERATORS = {2, 3, 4, 6, 12}
_TECHNIQUE_WEIGHT = {"bend": 1.5, "slide": 1.0, "hammer": 0.8, "harmonic": 1.0, "vibrato": 0.4, "dead": 0.4}


@dataclass(frozen=True)
class Factor:
    key: str
    value: float
    """``0..1`` contribution to the level."""
    measure: float
    """The raw number behind it; its unit depends on ``key`` (notes per second, shifts per bar, frets, ...)."""


@dataclass(frozen=True)
class TrackDifficulty:
    track_id: str
    name: str
    level: float
    """``1.0..10.0``, one decimal."""
    factors: list[Factor]


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


def _top_mean(values: list[float], share: float = 0.2) -> float:
    """Mean of the largest ``share`` of ``values`` (at least one)."""
    if not values:
        return 0.0
    ranked = sorted(values, reverse=True)
    top = ranked[: max(1, ceil(len(ranked) * share))]
    return sum(top) / len(top)


def _percentile(values: list[int], share: float) -> float:
    if not values:
        return 0.0
    ranked = sorted(values)
    return float(ranked[min(len(ranked) - 1, int(share * len(ranked)))])


def _technique_weight(note) -> float:
    weight = 0.0
    if note.bend:
        weight += _TECHNIQUE_WEIGHT["bend"]
    if note.slide:
        weight += _TECHNIQUE_WEIGHT["slide"]
    if note.hammer:
        weight += _TECHNIQUE_WEIGHT["hammer"]
    if note.harmonic:
        weight += _TECHNIQUE_WEIGHT["harmonic"]
    if note.vibrato:
        weight += _TECHNIQUE_WEIGHT["vibrato"]
    if note.dead or note.ghost:
        weight += _TECHNIQUE_WEIGHT["dead"]
    return weight


def _onset_notes(beat: Beat):
    """The notes that are struck on this beat; a tie continues an earlier note."""
    return [note for note in beat.notes if not note.tie]


def estimate_track(document: ScoreDocument, track: Track) -> TrackDifficulty:
    seconds = bar_seconds(document)
    onsets_per_bar: list[float] = []
    ordered: list[Beat] = []
    notes_total = 0
    technique_total = 0.0
    spans: list[int] = []
    irregular = 0
    beats_total = 0
    for index, track_bar in enumerate(track.bars):
        count = 0
        bar_beats: list[Beat] = []
        for voice in track_bar.voices:
            for beat in voice.beats:
                struck = _onset_notes(beat)
                if not struck:
                    continue
                count += 1
                bar_beats.append(beat)
                beats_total += 1
                notes_total += len(struck)
                technique_total += sum(_technique_weight(note) for note in struck)
                frets = [note.fret for note in struck if note.fret > 0]
                if len(frets) >= 2:
                    spans.append(max(frets) - min(frets))
                if beat.tuplet or beat.position % _SIXTEENTH or beat.duration < _SIXTEENTH:
                    irregular += 1
        bar_beats.sort(key=lambda beat: beat.position)
        ordered.extend(bar_beats)
        if count:
            onsets_per_bar.append(count / seconds[index])

    if not beats_total:
        return TrackDifficulty(track.id, track.name, MIN_LEVEL, [Factor(key, 0.0, 0.0) for key in FACTORS])

    notes_per_second = _top_mean(onsets_per_bar)
    density = _clamp((notes_per_second - 1.0) / 7.0)

    positions = []
    for beat in ordered:
        frets = [note.fret for note in _onset_notes(beat) if note.fret > 0]
        if frets:
            positions.append(sum(frets) / len(frets))
    jumps = sum(
        1 for before, after in zip(positions, positions[1:], strict=False) if abs(after - before) >= _SHIFT_FRETS
    )
    jumps_per_bar = jumps / len(onsets_per_bar)
    shifts = _clamp(jumps_per_bar / 1.5)

    span = _percentile(spans, 0.95)
    stretch = _clamp((span - 3.0) / 4.0)

    technique_rate = technique_total / notes_total
    techniques = _clamp(technique_rate / 0.4)

    shapes = [
        tuple(sorted((note.string, note.fret) for note in _onset_notes(beat)))
        for beat in ordered
        if len(_onset_notes(beat)) >= 3
    ]
    changes = sum(1 for before, after in zip(shapes, shapes[1:], strict=False) if before != after)
    chord_minutes = (
        sum(
            seconds[index]
            for index, track_bar in enumerate(track.bars)
            if any(len(_onset_notes(beat)) >= 3 for voice in track_bar.voices for beat in voice.beats)
        )
        / 60
    )
    changes_per_minute = changes / chord_minutes if chord_minutes else 0.0
    chords = _clamp(0.6 * _clamp(changes_per_minute / 60.0) + 0.4 * _clamp(len(set(shapes)) / 16.0))

    irregular_share = irregular / beats_total
    first = document.bars[0].signature
    odd_meter = any(bar.signature[0] not in _COMMON_NUMERATORS or bar.signature != first for bar in document.bars)
    rhythm = _clamp(irregular_share / 0.35 + (0.25 if odd_meter else 0.0))

    values = {"density": density, "shifts": shifts, "stretch": stretch, "techniques": techniques}
    values.update({"chords": chords, "rhythm": rhythm})
    measures = {
        "density": notes_per_second,
        "shifts": jumps_per_bar,
        "stretch": span,
        "techniques": technique_rate,
        "chords": changes_per_minute,
        "rhythm": irregular_share,
    }
    raw = sum(_WEIGHTS[key] * values[key] for key in FACTORS)
    level = MIN_LEVEL + (MAX_LEVEL - MIN_LEVEL) * _clamp(raw * _SCALE)
    factors = [Factor(key, round(values[key], 3), round(measures[key], 2)) for key in FACTORS]
    return TrackDifficulty(track.id, track.name, round(level, 1), factors)


def estimate(document: ScoreDocument) -> list[TrackDifficulty]:
    """The difficulty of every track, in score order."""
    return [estimate_track(document, track) for track in document.tracks]


def song_level(document: ScoreDocument, tracks: list[TrackDifficulty] | None = None) -> float:
    """The level of the song as the library shows it: that of its preferred track."""
    tracks = tracks if tracks is not None else estimate(document)
    chosen = preferred_track(document).id
    for item in tracks:
        if item.track_id == chosen:
            return item.level
    return tracks[0].level


# --- chord sheets ---------------------------------------------------------------------------------------------

_INLINE_CHORD = re.compile(r"\[([^\]\s]+)\]")
_ROOT = re.compile(r"^([A-G][#b]?)(.*)$")
_QUALITY_ALIASES = {"min": "m", "mi": "m", "M": "maj", "M7": "maj7", "-": "m", "": ""}
_BASIC_QUALITIES = {"", "m", "5", "6", "m6", "7", "m7", "maj7", "sus", "sus2", "sus4", "7sus4"}
_OPEN_SHAPES = {
    "C": {"", "7", "maj7", "add9"},
    "D": {"", "m", "7", "m7", "maj7", "sus2", "sus4", "7sus4"},
    "E": {"", "m", "7", "m7", "sus4", "7sus4", "m6"},
    "G": {"", "7", "maj7", "sus4", "6"},
    "A": {"", "m", "7", "m7", "maj7", "sus2", "sus4", "7sus4"},
    "B": {"7"},
    "F": {"maj7"},
}
"""Chords with a common open-position fingering that needs no barre, by root. Everything else counts as a barre."""


def _split_chord(chord: str) -> tuple[str, str] | None:
    """``(root, quality)`` of a chord name without its slash bass, or ``None`` when it is not a chord."""
    name = chord.strip("()")
    if not is_chord(name):
        return None
    match = _ROOT.match(name.split("/")[0])
    if match is None:
        return None
    root, quality = match.groups()
    return root, _QUALITY_ALIASES.get(quality, quality)


def chord_is_barre(root: str, quality: str) -> bool:
    """Whether the usual fingering of the chord lays one finger across the strings."""
    return quality != "5" and quality not in _OPEN_SHAPES.get(root, ())


def chord_is_extended(quality: str) -> bool:
    """Whether the chord goes beyond triads, sevenths, sixths and suspensions."""
    return quality not in _BASIC_QUALITIES


def estimate_chordpro(chordpro: str) -> list[TrackDifficulty]:
    """The difficulty of a ChordPro chord sheet: one entry, or none when the sheet has no chords."""
    sequence: list[str] = []
    chord_lines = 0
    for line in chordpro.splitlines():
        if line.lstrip().startswith(("{", "#")):
            continue
        found = [name for name in _INLINE_CHORD.findall(line) if _split_chord(name)]
        if found:
            chord_lines += 1
            sequence.extend(found)
    if not sequence:
        return []

    shapes = {name.strip("()").split("/")[0] for name in sequence}
    parsed = [split for split in (_split_chord(name) for name in shapes) if split]
    distinct = len(parsed)
    barres = sum(1 for root, quality in parsed if chord_is_barre(root, quality))
    extended = sum(1 for _root, quality in parsed if chord_is_extended(quality))
    bases = [name.strip("()").split("/")[0] for name in sequence]
    changes = sum(1 for before, after in zip(bases, bases[1:], strict=False) if before != after)
    changes_per_line = changes / chord_lines

    values = {
        "vocabulary": _clamp((distinct - 3) / 9),
        "barres": _clamp(barres / 5),
        "extensions": _clamp(extended / 6),
        "changes": _clamp((changes_per_line - 0.5) / 4.5),
    }
    measures = {
        "vocabulary": distinct,
        "barres": barres,
        "extensions": extended,
        "changes": changes_per_line,
    }
    raw = sum(_CHORD_WEIGHTS[key] * values[key] for key in CHORD_FACTORS)
    level = MIN_LEVEL + (MAX_LEVEL - MIN_LEVEL) * _clamp(raw * _SCALE)
    factors = [Factor(key, round(values[key], 3), round(measures[key], 2)) for key in CHORD_FACTORS]
    return [TrackDifficulty(CHORD_SHEET_TRACK_ID, CHORD_SHEET_TRACK_NAME, round(level, 1), factors)]
