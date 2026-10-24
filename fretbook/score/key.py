"""The musical key of a song: parsed from a name, or detected from a score's notes.

A chord sheet without a ``{key}`` directive gets one from its chords instead (:func:`chords_key`).

Detection is the Krumhansl-Schmuckler algorithm: the duration-weighted histogram of the pitch classes in the
preferred track is correlated with the Krumhansl-Kessler major and minor key profiles at all twelve rotations, and
the best of the 24 wins. A key is written ``C``, ``F#`` or ``Bb`` for major and with an ``m`` for minor
(``Am``, ``C#m``): :data:`KEYS` is the whole set, and the UI translates the name into the user's language.
"""

from __future__ import annotations

import math
import re

from fretbook.chords import chordpro as chordpro_text
from fretbook.score.model import ScoreDocument, preferred_track

VERSION = 2
"""Bump when detection changes, so :meth:`SongRepository.refresh_keys` redoes every song."""

_MAJOR_NAMES = ("C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
_MINOR_NAMES = ("Cm", "C#m", "Dm", "D#m", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "Bbm", "Bm")
KEYS: tuple[str, ...] = (*_MAJOR_NAMES, *_MINOR_NAMES)

_MAJOR_PROFILE = (6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88)
_MINOR_PROFILE = (6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17)

_SEMITONES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_KEY_TEXT = re.compile(r"^([A-Ga-g])\s*([#♯b♭]?)\s*(.*)$")
_MINOR_WORDS = {"m", "min", "minor", "mi", "-"}
_MAJOR_WORDS = {"", "maj", "major", "ma", "M"}
MIN_NOTES = 8
"""Fewer sounding notes than this say too little to name a key."""


def parse_key(text: str) -> str | None:
    """The canonical name for a key written by a person (``f sharp`` is not understood; ``F#``, ``Bb minor`` are)."""
    match = _KEY_TEXT.match(text.strip())
    if not match:
        return None
    letter, accidental, rest = match.groups()
    rest = rest.strip()
    if rest in _MINOR_WORDS or rest.lower() == "minor":
        minor = True
    elif rest in _MAJOR_WORDS or rest.lower() in {"major", "maj"}:
        minor = False
    else:
        return None
    pitch = _SEMITONES[letter.upper()] + {"#": 1, "♯": 1, "b": -1, "♭": -1, "": 0}[accidental]
    return (_MINOR_NAMES if minor else _MAJOR_NAMES)[pitch % 12]


def _correlation(histogram: list[float], profile: tuple[float, ...], shift: int) -> float:
    ys = [profile[(pc - shift) % 12] for pc in range(12)]
    mean_x = sum(histogram) / 12
    mean_y = sum(ys) / 12
    covariance = sum((x - mean_x) * (y - mean_y) for x, y in zip(histogram, ys, strict=True))
    spread = math.sqrt(sum((x - mean_x) ** 2 for x in histogram) * sum((y - mean_y) ** 2 for y in ys))
    return covariance / spread if spread else 0.0


def best_key(histogram: list[float]) -> str | None:
    """The key whose profile best fits a 12-bin pitch-class histogram, or ``None`` for a flat or empty one."""
    if len(histogram) != 12 or max(histogram, default=0) <= 0 or len(set(histogram)) == 1:
        return None
    scored = [
        (_correlation(histogram, profile, shift), names[shift])
        for profile, names in ((_MAJOR_PROFILE, _MAJOR_NAMES), (_MINOR_PROFILE, _MINOR_NAMES))
        for shift in range(12)
    ]
    return max(scored, key=lambda item: item[0])[1]


def pitch_histogram(document: ScoreDocument) -> tuple[list[float], int]:
    """Ticks of sounding time per pitch class in the preferred track, and how many notes were counted.

    Dead notes are skipped, and so are tied ones: the note they continue already sounded.
    """
    track = preferred_track(document)
    histogram = [0.0] * 12
    notes = 0
    for bar in track.bars:
        for voice in bar.voices:
            for beat in voice.beats:
                for note in beat.notes:
                    if note.dead or note.tie or note.string >= len(track.tuning_midi):
                        continue
                    histogram[(track.tuning_midi[note.string] + track.capo + note.fret) % 12] += beat.duration
                    notes += 1
    return histogram, notes


def detect_key(document: ScoreDocument) -> str | None:
    """The key of a score, or ``None`` when it has too few notes to tell."""
    histogram, notes = pitch_histogram(document)
    return best_key(histogram) if notes >= MIN_NOTES else None


_CHORD_ROOT = re.compile(r"^\(?([A-G])([#b]?)(.*?)(?:/[A-G][#b]?)?\)?$")
_MAJOR_SCALE = (0, 2, 4, 5, 7, 9, 11)
_MINOR_SCALE = (0, 2, 3, 5, 7, 8, 10, 11)
"""Natural minor plus the raised seventh of the harmonic minor, which the dominant chord uses."""
MIN_CHORDS = 3
"""Fewer chords than this say too little to name a key."""
_ENDS_BONUS = 2.0
"""What the first and the last chord each add to the key they sound like the home of."""


def _chord_triad(chord: str) -> tuple[int, bool, frozenset[int]] | None:
    """``(root, minor, pitch classes)`` of a chord's triad, ignoring extensions and the slash bass."""
    match = _CHORD_ROOT.match(chord)
    if not match:
        return None
    letter, accidental, quality = match.groups()
    root = (_SEMITONES[letter] + {"#": 1, "b": -1, "": 0}[accidental]) % 12
    lowered = quality.lower()
    diminished = lowered.startswith(("dim", "\u00b0", "\u00f8")) or "b5" in lowered
    minor = not quality.startswith(("maj", "M")) and lowered.startswith(("m", "dim", "\u00b0", "\u00f8"))
    third = () if lowered.startswith("sus") else (3 if minor else 4,)
    fifth = 6 if diminished else 8 if lowered.startswith(("aug", "+")) else 7
    return root, minor, frozenset((root + step) % 12 for step in (0, *third, fifth))


def chords_key(chords: list[str]) -> str | None:
    """The key a list of chords (in order) belongs to, or ``None`` when there are too few to tell.

    Each of the 24 keys scores one point per chord whose notes are all in its scale. A chord that is the key's tonic
    (the major chord of a major key, the minor chord of a minor one) adds a point more, and the first and last chords
    add a bonus when they are the tonic. That last part is what tells a major key from its relative minor, which
    share every chord. A tie between keys gives no key.
    """
    triads = [triad for triad in map(_chord_triad, chords) if triad is not None]
    if len(triads) < MIN_CHORDS or len({(root, minor) for root, minor, _ in triads}) < 2:
        return None
    scored: list[tuple[float, str]] = []
    for names, scale, minor_key in ((_MAJOR_NAMES, _MAJOR_SCALE, False), (_MINOR_NAMES, _MINOR_SCALE, True)):
        for tonic in range(12):
            notes = {(tonic + step) % 12 for step in scale}
            score = 0.0
            for root, minor, pitches in triads:
                if pitches <= notes:
                    score += 1.0
                if root == tonic and minor == minor_key:
                    score += 1.0
            for root, minor, _ in (triads[0], triads[-1]):
                if root == tonic and minor == minor_key:
                    score += _ENDS_BONUS
            scored.append((score, names[tonic]))
    scored.sort(key=lambda item: -item[0])
    if scored[0][0] == scored[1][0]:
        return None
    return scored[0][1]


def chordpro_key(chordpro: str) -> str | None:
    """The key a chord sheet declares with ``{key: ...}``, else the one its chords point to.

    The chords are taken as sounding after the sheet's ``{capo}``, as a tab's notes are.
    """
    meta = chordpro_text.metadata(chordpro)
    declared = meta.get("key", "")
    if declared:
        return parse_key(declared)
    capo = re.match(r"\d+", meta.get("capo", ""))
    found = chords_key(chordpro_text.chords(chordpro))
    if found is None or not capo or not int(capo.group()) % 12:
        return found
    shift = int(capo.group()) % 12
    names = _MINOR_NAMES if found.endswith("m") else _MAJOR_NAMES
    return names[(names.index(found) + shift) % 12]
