"""Transpose, retune and convert one track of a score, without touching the original.

``convert_track`` returns a new :class:`Track` plus a :class:`Report` of what had to give. It covers four jobs with one
set of options:

* **Transpose** by ``semitones``: every pitch moves, the tuning stays.
* **Retune keeping pitches** (``keep="pitch"``): the music sounds the same on a new tuning, capo or string count, so
  standard to Drop D, 4-string to 5-string bass, 6 to 7-string guitar, or a guitar part moved down an octave onto bass.
* **Retune keeping shapes** (``keep="shape"``): frets stay where they are and the tuning or capo changes, so the part
  sounds higher or lower but is played with the same hand shapes (capo-style).
* **Reduce** (``reduce="lowest"``): keep only the lowest note of every beat, a starting point for a bass line.
  ``reduce="root"`` keeps the root of the chord the beat sounds instead (see :func:`chord_root_note`), which is the
  better bass note for inversions, slash chords and open-string drones. A beat with fewer than three pitch classes
  (an arpeggio plays one note per beat) takes the root of the chord the whole bar spells instead.

Frets count from the capo, as everywhere in the score model: a note sounds at ``tuning[string] + capo + fret``.

When a pitch moves, a note stays on its string if it still fits there (and a chord still fits the hand); otherwise the
whole beat goes through :func:`fretbook.score.fingering.assign_frets`. A tie follows the note it continues.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Literal

from fretbook.score.fingering import MAX_FRET, MAX_STRETCH, assign_frets
from fretbook.score.model import Beat, Note, Track, TrackBar, Voice

Keep = Literal["pitch", "shape"]
Reduce = Literal["all", "lowest", "root"]

_CHORD_SHAPES: tuple[frozenset[int], ...] = tuple(
    frozenset(shape)
    for shape in (
        (0, 4, 7),  # major
        (0, 3, 7),  # minor
        (0, 3, 6),  # diminished
        (0, 4, 8),  # augmented
        (0, 2, 7),  # sus2
        (0, 5, 7),  # sus4
        (0, 7),  # power chord
        (0, 4, 7, 10),  # dominant seventh
        (0, 4, 7, 11),  # major seventh
        (0, 3, 7, 10),  # minor seventh
        (0, 3, 6, 10),  # half-diminished
        (0, 3, 6, 9),  # diminished seventh
        (0, 4, 7, 9),  # sixth
        (0, 3, 7, 9),  # minor sixth
    )
)
"""Intervals above the root, in semitones, of the chords the root detection knows. Extensions (a ninth, an added
note) are allowed on top of any of these, so Cadd9 still reads as C."""

_MAX_LISTED_BARS = 20
_SAME_STRING_REACH = 5
"""A string keeps its notes only if its open pitch moved by at most this many semitones (Drop D, Eb, a capo).
A bigger move, such as guitar to bass, would leave every note high up the neck, so the beat is refingered."""


@dataclass
class Report:
    notes: int = 0
    """Notes in the source track."""
    refretted: int = 0
    """Notes that ended on a different string or fret."""
    reduced: int = 0
    """Notes removed by ``reduce``."""
    shifted_bars: list[int] = field(default_factory=list)
    """Bars (1-based) where a pitch was moved by octaves because the instrument cannot play it."""
    dropped_bars: list[int] = field(default_factory=list)
    """Bars (1-based) where notes were left out because no fingering holds them all."""
    dropped: int = 0
    """Notes left out for that reason."""
    techniques_dropped: int = 0
    """Natural harmonics turned into plain notes because the note moved."""


@dataclass
class Conversion:
    track: Track
    report: Report


@dataclass
class _Ref:
    """A note to place, with where it sits so the result can be written back."""

    bar: int
    note: Note
    pitch: int | None
    """Sounding pitch after the change, ``None`` for a dead note."""


def _sounding(tuning: Sequence[int], capo: int, note: Note) -> int:
    return tuning[note.string] + capo + note.fret


def chord_root_note(pitches: Sequence[int]) -> int | None:
    """The index into ``pitches`` of the note that is the root of the chord they spell, or ``None`` when no known
    chord fits (a single note, a plain third, a cluster) or the root itself is not played (a rootless voicing).

    Every pitch class that is sounding is tried as a root; the chord must contain all of a shape's tones, and the
    shape with the most tones wins. A tie, such as C6 against Am7, goes to the root that is the lowest note, so a
    bass player's own choice of bottom note settles the ambiguity. Of several notes on the root's pitch class the
    lowest is returned.
    """
    if len(pitches) < 2:
        return None
    classes = {pitch % 12 for pitch in pitches}
    lowest_class = min(pitches) % 12
    best: tuple[int, bool, int] | None = None
    best_root = 0
    for root in classes:
        tones = frozenset((cls - root) % 12 for cls in classes)
        size = max((len(shape) for shape in _CHORD_SHAPES if shape <= tones), default=0)
        if not size:
            continue
        # Most tones first, then a root that is the bass, then the lower root for a stable answer.
        score = (size, root == lowest_class, -root)
        if best is None or score > best:
            best, best_root = score, root
    if best is None:
        return None
    candidates = [index for index, pitch in enumerate(pitches) if pitch % 12 == best_root]
    return min(candidates, key=lambda index: pitches[index])


def _root_note(track: Track, beat_notes: list[Note], bar_notes: list[Note]) -> Note:
    """The bass note for one beat of ``reduce="root"``: the root of the chord the beat spells, else the root of the
    chord the whole bar spells when the beat has fewer than three pitch classes (an arpeggio plays one note per beat;
    a dyad only counts if it plays that root), else the beat's lowest note. The bar's root is its lowest note of the
    chord's root; when the beat does not play it, a copy of that note stands in, so the beat keeps its place and length.
    """
    sounding = [_sounding(track.tuning_midi, track.capo, note) for note in beat_notes]
    lowest = min(range(len(beat_notes)), key=lambda i: sounding[i])
    root = chord_root_note(sounding)
    if root is not None:
        return beat_notes[root]
    if len({pitch % 12 for pitch in sounding}) >= 3:
        return beat_notes[lowest]
    bar_sounding = [_sounding(track.tuning_midi, track.capo, note) for note in bar_notes]
    bar_root = chord_root_note(bar_sounding)
    if bar_root is None:
        return beat_notes[lowest]
    own = [i for i, pitch in enumerate(sounding) if pitch == bar_sounding[bar_root]]
    if own:
        return beat_notes[own[0]]
    if len(sounding) > 1 and len({pitch % 12 for pitch in sounding}) > 1:
        # A dyad the bar's chord does not contain is a chord of its own (the second chord of the bar): keep its bass.
        return beat_notes[lowest]
    return _clone(bar_notes[bar_root], tie=False)


def _clone(note: Note, **changes: object) -> Note:
    return note.model_copy(update=changes, deep=True)


def _spread(frets: Sequence[int]) -> int:
    fretted = [fret for fret in frets if fret > 0]
    return max(fretted) - min(fretted) if fretted else 0


def _same_string(
    refs: list[_Ref], tuning: Sequence[int], capo: int, before: Sequence[int], capo_before: int
) -> list[tuple[int, int]] | None:
    """The beat's notes kept on their strings, or ``None`` when one falls off the neck, the chord no longer fits
    the hand, or a string's open pitch moved too far for its position to mean the same thing."""
    found: list[tuple[int, int]] = []
    for ref in refs:
        assert ref.pitch is not None
        string = ref.note.string
        if string >= len(tuning) or string >= len(before):
            return None
        if abs(tuning[string] + capo - before[string] - capo_before) > _SAME_STRING_REACH:
            return None
        fret = ref.pitch - tuning[ref.note.string] - capo
        if not 0 <= fret <= MAX_FRET:
            return None
        found.append((ref.note.string, fret))
    if len({string for string, _ in found}) != len(found) or _spread([fret for _, fret in found]) > MAX_STRETCH:
        return None
    return found


def convert_track(
    track: Track,
    *,
    semitones: int = 0,
    tuning: Sequence[int] | None = None,
    capo: int | None = None,
    keep: Keep = "pitch",
    reduce: Reduce = "all",
) -> Conversion:
    """The track transposed and retuned as asked (see the module docstring); ``track`` itself is not changed.

    ``tuning`` lists the new open-string pitches, highest first; left out, the tuning stays (``keep="shape"`` with
    only ``semitones`` retunes every string by that much instead, which is how a capo-style transposition sounds).
    ``capo`` defaults to the track's own.

    Raises :class:`ValueError` when shapes cannot be kept because the string count differs.
    """
    new_tuning = list(tuning) if tuning is not None else list(track.tuning_midi)
    new_capo = track.capo if capo is None else capo
    if keep == "shape":
        if len(new_tuning) != len(track.tuning_midi):
            raise ValueError("keeping shapes needs the same number of strings")
        if tuning is None:
            new_tuning = [pitch + semitones for pitch in new_tuning]
        if any(not 0 <= pitch <= 127 for pitch in new_tuning):
            raise ValueError("the tuning is out of range")
        shift = 0
    else:
        shift = semitones
    report = Report()
    voice_count = max((len(bar.voices) for bar in track.bars), default=1)
    out_bars = [
        TrackBar(voices=[Voice() for _ in range(max(1, len(bar.voices)))], extras=dict(bar.extras))
        for bar in track.bars
    ]

    for voice_index in range(voice_count):
        beats: list[tuple[int, Beat]] = [
            (bar_index, beat)
            for bar_index, bar in enumerate(track.bars)
            if voice_index < len(bar.voices)
            for beat in bar.voices[voice_index].beats
        ]
        _convert_voice(track, beats, out_bars, voice_index, new_tuning, new_capo, shift, keep, reduce, report)

    converted = track.model_copy(
        update={"tuning_midi": new_tuning, "capo": new_capo, "bars": out_bars},
        deep=True,
    )
    report.shifted_bars = sorted(set(report.shifted_bars))[:_MAX_LISTED_BARS]
    report.dropped_bars = sorted(set(report.dropped_bars))[:_MAX_LISTED_BARS]
    return Conversion(track=converted, report=report)


def _convert_voice(
    track: Track,
    beats: list[tuple[int, Beat]],
    out_bars: list[TrackBar],
    voice_index: int,
    tuning: list[int],
    capo: int,
    shift: int,
    keep: Keep,
    reduce: Reduce,
    report: Report,
) -> None:
    # Which source notes survive, per beat.
    bar_pitched: dict[int, list[Note]] = {}
    if reduce == "root":
        # Every sounding note of each bar, for beats too thin to name a chord on their own (an arpeggio).
        for bar_index, beat in beats:
            bar_pitched.setdefault(bar_index, []).extend(note for note in beat.notes if not note.dead)
    kept: list[list[Note]] = []
    for bar_index, beat in beats:
        notes = list(beat.notes)
        report.notes += len(notes)
        pitched = [note for note in notes if not note.dead]
        if reduce == "lowest" and len(notes) > 1:
            if pitched:
                lowest = min(pitched, key=lambda note: _sounding(track.tuning_midi, track.capo, note))
                report.reduced += len(notes) - 1
                notes = [lowest]
        elif reduce == "root" and pitched:
            chosen = _root_note(track, pitched, bar_pitched[bar_index])
            report.reduced += len(notes) - 1 if chosen in notes else len(notes)
            notes = [chosen]
        kept.append(notes)

    # Placement of every surviving note: index of beat -> {id(source note): (string, fret)}.
    placed: list[dict[int, tuple[int, int]]] = [{} for _ in beats]
    pending: list[tuple[int, list[_Ref]]] = []
    for index, ((bar_index, beat), notes) in enumerate(zip(beats, kept, strict=True)):
        if keep == "shape":
            for note in notes:
                placed[index][id(note)] = (note.string, note.fret)
            continue
        free: list[_Ref] = []
        for note in notes:
            if note.dead:
                string = min(note.string, len(tuning) - 1)
                placed[index][id(note)] = (string, note.fret)
                continue
            old_pitch = _sounding(track.tuning_midi, track.capo, note)
            origin = _tie_origin(kept, index, note) if note.tie else None
            if origin is not None:
                # A tie follows the note it continues; it is resolved once that note is placed.
                if id(origin[1]) in placed[origin[0]]:
                    placed[index][id(note)] = placed[origin[0]][id(origin[1])]
                continue
            free.append(_Ref(bar_index, note, old_pitch + shift))
        if free:
            fixed = _same_string(free, tuning, capo, track.tuning_midi, track.capo)
            if fixed is not None:
                for ref, fitted in zip(free, fixed, strict=True):
                    placed[index][id(ref.note)] = fitted
            else:
                pending.append((index, free))
    if pending:
        fingering = assign_frets(
            [[ref.pitch for ref in refs if ref.pitch is not None] for _, refs in pending], tuning, capo=capo
        )
        for slot, (index, refs) in enumerate(pending):
            bar_number = refs[0].bar + 1
            if slot in fingering.shifted:
                report.shifted_bars.append(bar_number)
            if slot in fingering.dropped:
                report.dropped_bars.append(bar_number)
            # assign_frets keeps the input order for the pitches it places and omits the ones it dropped.
            result = iter(fingering.groups[slot])
            taken = next(result, None)
            for ref in refs:
                if taken is not None and _matches(taken.pitch, ref.pitch):
                    placed[index][id(ref.note)] = (taken.string, taken.fret)
                    taken = next(result, None)
                else:
                    report.dropped += 1
    # Ties whose source was only placed just now, in beat order so a chain of ties resolves.
    for index in range(len(beats)):
        for note in kept[index]:
            if note.tie and id(note) not in placed[index]:
                origin = _tie_origin(kept, index, note)
                if origin is not None and id(origin[1]) in placed[origin[0]]:
                    placed[index][id(note)] = placed[origin[0]][id(origin[1])]

    for index, ((bar_index, beat), notes) in enumerate(zip(beats, kept, strict=True)):
        out_notes: list[Note] = []
        for note in notes:
            spot = placed[index].get(id(note))
            if spot is None:
                continue
            string, fret = spot
            moved = (string, fret) != (note.string, note.fret)
            changes: dict[str, object] = {"string": string, "fret": fret}
            if moved:
                report.refretted += 1
                if note.harmonic == "natural":
                    changes["harmonic"] = None
                    report.techniques_dropped += 1
            out_notes.append(_clone(note, **changes))
        out_beat = beat.model_copy(update={"notes": out_notes}, deep=True)
        out_bars[bar_index].voices[voice_index].beats.append(out_beat)


def _matches(placed_pitch: int, wanted: int | None) -> bool:
    """A placement answers a wanted pitch exactly or, when assign_frets moved it, by whole octaves."""
    return wanted is not None and (placed_pitch - wanted) % 12 == 0


def _tie_origin(kept: list[list[Note]], index: int, note: Note) -> tuple[int, Note] | None:
    """The note a tie continues: the same source string and fret in the closest earlier beat that has notes."""
    for back in range(index - 1, -1, -1):
        if not kept[back]:
            continue
        for earlier in kept[back]:
            if earlier.string == note.string and earlier.fret == note.fret:
                return back, earlier
        return None
    return None
