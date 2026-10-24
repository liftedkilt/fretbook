"""The musical key of a song: parsed from a name, or detected from a score's notes.

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

VERSION = 1
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


def chordpro_key(chordpro: str) -> str | None:
    """The key a chord sheet declares with ``{key: ...}``, if it is one we know."""
    declared = chordpro_text.metadata(chordpro).get("key", "")
    return parse_key(declared) if declared else None
