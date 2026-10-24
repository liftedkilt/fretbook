"""Assign a string and fret to every pitch of a part, moving the hand as little as possible.

The input is a sequence of *groups*: one MIDI pitch for a single note, several for a chord. The output has one
placement per pitch. A group's candidates are every way to play its pitches on distinct strings within the stretch
the hand can span; a Viterbi pass then picks one candidate per group so the total hand movement (the distance between
the average fretted position of neighbouring groups) is smallest. Low frets and staying on a string are mildly
preferred, so an ambiguous pitch lands where a player would play it.

Frets count from the capo, as everywhere else in the score model: a note sounds at
``tuning[string] + capo + fret``. String 0 is the highest string.

Pitches the instrument cannot reach are moved by octaves into range and the group is reported in
:attr:`Fingering.shifted`; a chord with no playable fingering loses its outermost notes until one exists, reported
in :attr:`Fingering.dropped`. Callers turn those lists into warnings.

A note that keeps ringing while the next group starts (a held bass under a melody) is passed again in that group, and
``holds`` links the two entries. The group is then fingered as one chord, so the strings are not reused, and a held
note is steered to stay where it was put. The module has no format dependencies, so
transcription and transpose/retune can reuse it.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from itertools import combinations

MAX_FRET = 24
MAX_STRETCH = 4
"""Largest fret distance between the fretted notes of one chord (a hand covers five frets)."""
_MAX_CANDIDATES = 120
_MOVE_WEIGHT = 1.0
_STRING_WEIGHT = 0.15
_HEIGHT_WEIGHT = 0.04
_MAX_CHORD = 8
_HOLD_WEIGHT = 25.0
"""Cost of a held note moving to another string or fret. Large, but finite so a path always exists."""


@dataclass(frozen=True)
class Placement:
    pitch: int
    """The pitch that sounds, which differs from the requested one only when the group is in ``shifted``."""
    string: int
    fret: int
    source: int = field(default=-1, compare=False)
    """The index of the pitch within its input group."""


@dataclass
class Fingering:
    groups: list[list[Placement]]
    """One list per input group, in the order the pitches were given. Empty when nothing could be played."""
    shifted: list[int] = field(default_factory=list)
    """Indexes of groups where a pitch was moved by octaves to fit the instrument."""
    dropped: list[int] = field(default_factory=list)
    """Indexes of groups where chord notes were left out because no fingering holds them all."""


_Candidate = tuple[tuple[int, int], ...]
"""``(string, fret)`` for each pitch of a group, in pitch order."""


def _positions(pitch: int, tuning: Sequence[int], capo: int, max_fret: int) -> list[tuple[int, int]]:
    found = []
    for string, open_pitch in enumerate(tuning):
        fret = pitch - open_pitch - capo
        if 0 <= fret <= max_fret:
            found.append((string, fret))
    return found


def _fit_octave(pitch: int, tuning: Sequence[int], capo: int, max_fret: int) -> int | None:
    """``pitch`` moved by whole octaves to the nearest reachable pitch, or ``None`` when no octave fits."""
    if _positions(pitch, tuning, capo, max_fret):
        return pitch
    low = min(tuning) + capo
    high = max(tuning) + capo + max_fret
    for shift in range(12, 12 * 11, 12):
        for candidate in (pitch + shift, pitch - shift):
            if low <= candidate <= high and _positions(candidate, tuning, capo, max_fret):
                return candidate
    return None


def _spread(candidate: _Candidate) -> int:
    fretted = [fret for _, fret in candidate if fret > 0]
    return max(fretted) - min(fretted) if fretted else 0


def _candidates(
    pitches: Sequence[int], tuning: Sequence[int], capo: int, max_fret: int, max_stretch: int
) -> list[_Candidate]:
    options = [_positions(pitch, tuning, capo, max_fret) for pitch in pitches]
    found: list[_Candidate] = []

    def extend(index: int, used: frozenset[int], chosen: tuple[tuple[int, int], ...]) -> None:
        if index == len(options):
            if _spread(chosen) <= max_stretch:
                found.append(chosen)
            return
        for string, fret in options[index]:
            if string not in used:
                extend(index + 1, used | {string}, (*chosen, (string, fret)))

    extend(0, frozenset(), ())
    return found


def _position(candidate: _Candidate) -> float | None:
    """Where the fretting hand sits for ``candidate``: the mean of its fretted notes, ``None`` when all are open."""
    fretted = [fret for _, fret in candidate if fret > 0]
    return sum(fretted) / len(fretted) if fretted else None


def _local_cost(candidate: _Candidate) -> float:
    fretted = [fret for _, fret in candidate if fret > 0]
    return _HEIGHT_WEIGHT * (sum(fretted) / len(fretted) if fretted else 0)


def _mean_string(candidate: _Candidate) -> float:
    """The average string of the notes actually placed (a pitch left out of a thinned chord has string -1)."""
    played = [string for string, _ in candidate if string >= 0]
    return sum(played) / len(played)


def _trim(pitches: list[int], tuning: Sequence[int], capo: int, max_fret: int, max_stretch: int) -> list[_Candidate]:
    """Candidates for the largest subset of ``pitches`` that can be played together, preferring to keep the extremes."""
    ordered = sorted(range(len(pitches)), key=lambda index: pitches[index])
    outer = {ordered[0], ordered[-1]}
    for size in range(len(pitches) - 1, 0, -1):
        subsets = sorted(combinations(ordered, size), key=lambda subset: -len(outer & set(subset)))
        for subset in subsets:
            kept = sorted(subset)
            found = _candidates([pitches[index] for index in kept], tuning, capo, max_fret, max_stretch)
            if found:
                return [_pad(candidate, kept, len(pitches)) for candidate in found]
    return []


def _pad(candidate: _Candidate, kept: list[int], total: int) -> _Candidate:
    """A subset's candidate widened to the group's size, with ``(-1, -1)`` for each left-out pitch."""
    padded = [(-1, -1)] * total
    for index, placed in zip(kept, candidate, strict=True):
        padded[index] = placed
    return tuple(padded)


def _links(
    prepared: list[tuple[int, list[int], list[int], list[_Candidate]]],
    step: int,
    holds: Sequence[Sequence[tuple[int, int]]] | None,
) -> list[tuple[int, int]]:
    """``(slot in the previous prepared group, slot in this one)`` for each held note both groups kept."""
    if not holds or step == 0 or prepared[step - 1][0] != prepared[step][0] - 1:
        return []
    before, now = prepared[step - 1][2], prepared[step][2]
    return [(before.index(a), now.index(b)) for a, b in holds[prepared[step][0]] if a in before and b in now]


def assign_frets(
    groups: Sequence[Sequence[int]],
    tuning: Sequence[int],
    *,
    capo: int = 0,
    max_fret: int = MAX_FRET,
    max_stretch: int = MAX_STRETCH,
    holds: Sequence[Sequence[tuple[int, int]]] | None = None,
) -> Fingering:
    """Choose a string and fret for each pitch in each group (see the module docstring).

    ``tuning`` lists the open-string pitches, highest string first. ``capo`` raises every open string. ``holds[i]``
    lists ``(index in group i - 1, index in group i)`` for each note that rings on from one group into the next.
    """
    if not tuning:
        raise ValueError("tuning is empty")
    result = Fingering(groups=[[] for _ in groups])
    prepared: list[tuple[int, list[int], list[int], list[_Candidate]]] = []
    for index, group in enumerate(groups):
        pitches: list[int] = []
        origin: list[int] = []
        moved = False
        for slot, pitch in enumerate(list(group)[:_MAX_CHORD]):
            fitted = _fit_octave(pitch, tuning, capo, max_fret)
            if fitted is None:
                continue
            moved = moved or fitted != pitch
            pitches.append(fitted)
            origin.append(slot)
        if not pitches:
            if group:
                result.dropped.append(index)
            continue
        if moved:
            result.shifted.append(index)
        found = _candidates(pitches, tuning, capo, max_fret, max_stretch)
        if not found:
            found = _trim(pitches, tuning, capo, max_fret, max_stretch)
            result.dropped.append(index)
        if not found:
            continue
        found.sort(key=lambda candidate: (_spread(candidate), _local_cost(candidate)))
        prepared.append((index, pitches, origin, found[:_MAX_CANDIDATES]))

    # Per state: (total cost, hand position carried out of the state, previous state). A state with only open
    # strings keeps the hand where it was, so the carried position depends on the best predecessor.
    previous: list[tuple[float, float | None, int]] | None = None
    before_strings: list[float] = []
    trail: list[list[int]] = []
    for step, (_, _, _, found) in enumerate(prepared):
        links = _links(prepared, step, holds)
        positions = [_position(candidate) for candidate in found]
        locals_ = [_local_cost(candidate) for candidate in found]
        strings = [_mean_string(candidate) for candidate in found]
        row: list[tuple[float, float | None, int]] = []
        for candidate_index in range(len(found)):
            position = positions[candidate_index]
            if previous is None:
                row.append((locals_[candidate_index], position, -1))
                continue
            best: tuple[float, float | None, int] | None = None
            for before, (cost, carried, _) in enumerate(previous):
                move = abs(position - carried) if position is not None and carried is not None else 0.0
                total = (
                    cost
                    + locals_[candidate_index]
                    + _MOVE_WEIGHT * move
                    + _STRING_WEIGHT * abs(strings[candidate_index] - before_strings[before])
                    + _HOLD_WEIGHT
                    * sum(prepared[step - 1][3][before][a] != found[candidate_index][b] for a, b in links)
                )
                if best is None or total < best[0]:
                    best = (total, position if position is not None else carried, before)
            assert best is not None
            row.append(best)
        trail.append([state[2] for state in row])
        previous = row
        before_strings = strings

    if previous is None:
        return result
    state = min(range(len(previous)), key=lambda item: previous[item][0])
    for step in range(len(prepared) - 1, -1, -1):
        index, pitches, origin, found = prepared[step]
        candidate = found[state]
        placements = [
            Placement(pitch, string, fret, position)
            for pitch, position, (string, fret) in zip(pitches, origin, candidate, strict=True)
            if string >= 0
        ]
        result.groups[index] = placements
        state = trail[step][state]
    result.shifted.sort()
    result.dropped.sort()
    return result
