"""MIDI note names and octave guesses for legacy tabs that only stored letter names."""

from __future__ import annotations

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
_PITCH = {name: index for index, name in enumerate(NOTE_NAMES)}
_PITCH["DB"] = 1
_PITCH["EB"] = 3
_PITCH["GB"] = 6
_PITCH["AB"] = 8
_PITCH["BB"] = 10


def midi_to_name(midi: int, octave: bool = True) -> str:
    pitch = NOTE_NAMES[midi % 12]
    if not octave:
        return pitch
    return f"{pitch}{midi // 12 - 1}"


def pitch_class(label: str) -> int:
    key = label.strip().upper().replace("♯", "#").replace("♭", "B")
    if key not in _PITCH:
        raise ValueError(f"unknown note name: {label}")
    return _PITCH[key]


def labels_to_midi(labels: list[str]) -> list[int]:
    """Map note names to MIDI, highest string first, each next string lower.

    Octave-less labels (the old player's ``strings`` array) pick a starting
    octave from the string count: 6 or more starts at octave 4 (guitar), fewer
    at octave 2 (bass). Names that already include an octave are honored for
    the first string and then still forced downward.
    """
    if not labels:
        raise ValueError("tuning is empty")
    top_octave = 4 if len(labels) >= 6 else 2
    midis: list[int] = []
    current: int | None = None
    for label in labels:
        text = label.strip()
        octave_digits = ""
        while text and (text[-1].isdigit() or (text[-1] == "-" and not octave_digits)):
            octave_digits = text[-1] + octave_digits
            text = text[:-1]
        pc = pitch_class(text)
        if current is None:
            if octave_digits:
                current = (int(octave_digits) + 1) * 12 + pc
            else:
                current = (top_octave + 1) * 12 + pc
            midis.append(current)
            continue
        candidate = (current // 12) * 12 + pc
        while candidate > current:
            candidate -= 12
        midis.append(candidate)
        current = candidate
    return midis
