"""Chord voicings for guitar, a port of ``web/src/lib/chords/{theory,voicings}.ts``.

The browser draws the chord diagrams, so this module exists to give the server the same answer to one question: does
the shape a reader sees need a barre? Keep the two generators in step: same qualities, same window, same scoring.

Strings run from the lowest-pitched to the highest, as in ChordPro ``{define:}``. Only the best voicing is needed
here, so the port stops at ranking and returns the first.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache

STANDARD_GUITAR = (40, 45, 50, 55, 59, 64)
"""Open-string MIDI notes of a guitar in standard tuning, lowest string first."""

_SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
_FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
_PITCH = {
    **{name: index for index, name in enumerate(_SHARPS)},
    **{name: index for index, name in enumerate(_FLATS)},
    "Cb": 11,
    "Fb": 4,
    "E#": 5,
    "B#": 0,
}
_CHORD = re.compile(r"^([A-G][#b]?)([^/]*)(?:/([A-G][#b]?))?$")

# quality -> (intervals, optional intervals)
_QUALITIES: dict[str, tuple[list[int], list[int]]] = {
    "maj": ([0, 4, 7], []),
    "m": ([0, 3, 7], []),
    "5": ([0, 7], []),
    "6": ([0, 4, 7, 9], [7]),
    "m6": ([0, 3, 7, 9], [7]),
    "7": ([0, 4, 7, 10], [7]),
    "maj7": ([0, 4, 7, 11], [7]),
    "m7": ([0, 3, 7, 10], [7]),
    "mmaj7": ([0, 3, 7, 11], [7]),
    "m7b5": ([0, 3, 6, 10], []),
    "dim": ([0, 3, 6], []),
    "dim7": ([0, 3, 6, 9], []),
    "aug": ([0, 4, 8], []),
    "aug7": ([0, 4, 8, 10], []),
    "sus2": ([0, 2, 7], []),
    "sus4": ([0, 5, 7], []),
    "7sus4": ([0, 5, 7, 10], [7]),
    "add9": ([0, 2, 4, 7], [7]),
    "9": ([0, 2, 4, 7, 10], [7]),
    "m9": ([0, 2, 3, 7, 10], [7]),
    "maj9": ([0, 2, 4, 7, 11], [7]),
    "7b9": ([0, 1, 4, 7, 10], [7]),
    "7#9": ([0, 3, 4, 7, 10], [7]),
}
_ALIASES = {
    "": "maj", "maj": "maj", "M": "maj", "m": "m", "min": "m", "-": "m", "5": "5", "6": "6", "m6": "m6",
    "min6": "m6", "7": "7", "dom7": "7", "maj7": "maj7", "M7": "maj7", "ma7": "maj7", "Δ": "maj7", "Δ7": "maj7",
    "m7": "m7", "min7": "m7", "-7": "m7", "mmaj7": "mmaj7", "mM7": "mmaj7", "minmaj7": "mmaj7", "m7b5": "m7b5",
    "m7-5": "m7b5", "min7b5": "m7b5", "ø": "m7b5", "ø7": "m7b5", "dim": "dim", "mb5": "dim", "°": "dim",
    "o": "dim", "dim7": "dim7", "°7": "dim7", "o7": "dim7", "aug": "aug", "+": "aug", "#5": "aug", "aug7": "aug7",
    "+7": "aug7", "7#5": "aug7", "sus2": "sus2", "sus4": "sus4", "sus": "sus4", "7sus4": "7sus4",
    "7sus": "7sus4", "add9": "add9", "9": "9", "m9": "m9", "min9": "m9", "maj9": "maj9", "M9": "maj9",
    "7b9": "7b9", "7#9": "7#9",
}  # fmt: skip

_WINDOW = 4
_MAX_START = 12
_MAX_FINGERS = 4
_OPEN_STRING_REACH = 5

Frets = tuple[int | None, ...]


@dataclass(frozen=True)
class ParsedChord:
    root: int
    bass: int | None
    required: tuple[int, ...]
    optional: tuple[int, ...]


def parse_chord(name: str) -> ParsedChord | None:
    """Read a chord symbol, or ``None`` for anything that is not a chord we can draw."""
    match = _CHORD.match(name.strip())
    if match is None:
        return None
    root_name, raw_quality, bass_name = match.groups()
    quality = _ALIASES.get(re.sub(r"[()\s]", "", raw_quality))
    root = _PITCH.get(root_name)
    if quality is None or root is None:
        return None
    bass: int | None = None
    if bass_name:
        bass_pitch = _PITCH.get(bass_name)
        if bass_pitch is None:
            return None
        bass = None if bass_pitch == root else bass_pitch
    intervals, optional = _QUALITIES[quality]
    required = [(root + i) % 12 for i in intervals if i not in optional]
    optional_pitches = [(root + i) % 12 for i in optional]
    if bass is not None and bass not in required and bass not in optional_pitches:
        required.append(bass)
    required = list(dict.fromkeys(required))
    return ParsedChord(root, bass, tuple(required), tuple(p for p in optional_pitches if p not in required))


def _fretted(frets: Frets) -> list[int]:
    return [fret for fret in frets if fret is not None and fret > 0]


def find_barre(frets: Frets) -> tuple[int, int, int] | None:
    """``(fret, first string, last string)`` of the barre, laid from the lowest sounding string, or ``None``."""
    fretted = _fretted(frets)
    if len(fretted) < 2:
        return None
    lowest = min(fretted)
    first = frets.index(lowest)
    last = len(frets) - 1 - frets[::-1].index(lowest)
    lowest_sounding = next(index for index, fret in enumerate(frets) if fret is not None)
    if first == last or first != lowest_sounding:
        return None
    for fret in frets[first : last + 1]:
        if fret is None or fret < lowest:
            return None
    return lowest, first, last


def _fingers_needed(frets: Frets, barre: tuple[int, int, int] | None) -> int:
    count = 0
    for index, fret in enumerate(frets):
        if fret is None or fret == 0:
            continue
        if barre and fret == barre[0] and barre[1] <= index <= barre[2]:
            continue
        count += 1
    return count + (1 if barre else 0)


def _base_fret(frets: Frets) -> int:
    fretted = _fretted(frets)
    if not fretted:
        return 1
    return 1 if max(fretted) <= _WINDOW else min(fretted)


def _score(frets: Frets, barre: tuple[int, int, int] | None) -> float:
    fretted = _fretted(frets)
    sounding = sum(1 for fret in frets if fret is not None)
    open_strings = sum(1 for fret in frets if fret == 0)
    muted = len(frets) - sounding
    low = min(fretted) if fretted else 0
    high = max(fretted) if fretted else 0
    return (
        muted * 1.5
        + low * 0.5
        + (high - low) * 2
        + (3 if barre else 0)
        + _fingers_needed(frets, barre)
        - open_strings * 0.8
        - sounding
    )


def _key(frets: Frets) -> str:
    return ".".join("x" if fret is None else str(fret) for fret in frets)


def _generate(tuning: tuple[int, ...], chord: ParsedChord, root_in_bass: bool, limit: int) -> list[Frets]:
    strings = len(tuning)
    allowed = {*chord.required, *chord.optional}
    wanted = chord.root if chord.bass is None else chord.bass
    min_sounding = min(3, strings)
    found: dict[str, tuple[Frets, float]] = {}

    def check(frets: Frets) -> None:
        lowest_pitch = None
        present: set[int] = set()
        sounding = 0
        for index, fret in enumerate(frets):
            if fret is None:
                continue
            sounding += 1
            pitch = tuning[index] + fret
            present.add(pitch % 12)
            if lowest_pitch is None or pitch < lowest_pitch:
                lowest_pitch = pitch
        if sounding < min_sounding or lowest_pitch is None:
            return
        if not all(pitch in present for pitch in chord.required):
            return
        if root_in_bass:
            if lowest_pitch % 12 != wanted:
                return
        elif wanted not in present:
            return
        if 0 in frets and max(fret or 0 for fret in frets) > _OPEN_STRING_REACH:
            return
        barre = find_barre(frets)
        if _fingers_needed(frets, barre) > _MAX_FINGERS:
            return
        key = _key(frets)
        if key not in found:
            found[key] = (frets, _score(frets, barre))

    for start in range(1, _MAX_START + 1):
        options: list[list[int | None]] = []
        for open_pitch in tuning:
            choices: list[int | None] = [None]
            if open_pitch % 12 in allowed:
                choices.append(0)
            choices.extend(f for f in range(start, start + _WINDOW) if (open_pitch + f) % 12 in allowed)
            options.append(choices)

        def walk(index: int, picked: tuple[int | None, ...]) -> None:
            if index == strings:
                check(picked)
                return
            for fret in options[index]:
                # Only the bass side may be muted: a mute after a sounding string is never kept.
                if fret is None and any(p is not None for p in picked):
                    continue
                walk(index + 1, (*picked, fret))

        walk(0, ())

    ranked = sorted(found.items(), key=lambda item: (item[1][1], item[0]))
    picked: list[str] = []
    per_position: dict[int, int] = {}

    def take(key: str, capped: bool) -> None:
        if len(picked) >= limit or key in picked:
            return
        position = _base_fret(found[key][0])
        if capped and per_position.get(position, 0) >= 2:
            return
        per_position[position] = per_position.get(position, 0) + 1
        picked.append(key)

    for key, _ in ranked:
        take(key, True)
    for key, _ in ranked:
        take(key, False)
    return [found[key][0] for key in picked]


@lru_cache(maxsize=512)
def best_voicing(chord_name: str, tuning: tuple[int, ...] = STANDARD_GUITAR, root_in_bass: bool = True) -> Frets | None:
    """The shape a chord diagram shows first when the song defines none, or ``None`` when there is none."""
    chord = parse_chord(chord_name)
    if chord is None or len(tuning) < 3:
        return None
    voicings = _generate(tuning, chord, root_in_bass, 6)
    return voicings[0] if voicings else None


def parse_define(value: str) -> tuple[str, Frets] | None:
    """Read ``{define: Am base-fret 1 frets x 0 2 2 1 0 …}`` (or the older ``Am 1 x 0 2 2 1 0``) into a name and
    absolute frets, lowest string first. ``None`` when the value is not a fingering."""
    tokens = value.split()
    if not tokens:
        return None
    name = tokens.pop(0)
    if not _CHORD.match(name):
        return None
    base = 1
    lowered = [token.lower() for token in tokens]
    if "frets" in lowered:
        frets_at = lowered.index("frets")
        if "base-fret" in lowered[:frets_at]:
            try:
                base = int(tokens[lowered.index("base-fret") + 1])
            except (ValueError, IndexError):
                return None
        rest = tokens[frets_at + 1 :]
        for index, token in enumerate(rest):
            if re.match(r"^[A-Za-z]{2,}", token) and not re.fullmatch(r"x+", token, re.IGNORECASE):
                rest = rest[:index]
                break
    else:
        if not tokens:
            return None
        try:
            base = int(tokens.pop(0))
        except ValueError:
            return None
        rest = tokens
    if not 1 <= base <= 24 or not 3 <= len(rest) <= 12:
        return None
    frets: list[int | None] = []
    for token in rest:
        if re.fullmatch(r"[xX-]", token):
            frets.append(None)
        elif re.fullmatch(r"\d{1,2}", token):
            number = int(token)
            frets.append(0 if number == 0 else base + number - 1)
        else:
            return None
    return name, tuple(frets)


def sheet_defines(chordpro: str) -> dict[str, Frets]:
    """The ``{define:}`` fingerings of a sheet by chord name, the first definition of a name winning."""
    defines: dict[str, Frets] = {}
    for match in re.finditer(r"^\s*\{\s*define\s*:\s*(.*?)\s*\}\s*$", chordpro, re.MULTILINE | re.IGNORECASE):
        parsed = parse_define(match.group(1))
        if parsed and parsed[0] not in defines:
            defines[parsed[0]] = parsed[1]
    return defines


def needs_barre(frets: Frets) -> bool:
    return find_barre(frets) is not None
