"""Regenerate ``midi/triplets.mid`` and ``midi/sustain.mid``
(python tests/fixtures/corpus/generate_midi.py, from the repo root).

Both are original phrases written with mido for this repository; neither is a real song.
"""

from pathlib import Path

import mido

TPB = 480
OUT = Path(__file__).parent / "midi"


def track(notes: list[tuple[int, int, int]], *, program: int, name: str) -> mido.MidiTrack:
    """``(start tick, pitch, length)`` notes as a track."""
    events = []
    for start, pitch, length in notes:
        events.append((start, 1, mido.Message("note_on", note=pitch, velocity=80)))
        events.append((start + length, 0, mido.Message("note_off", note=pitch, velocity=0)))
    events.sort(key=lambda item: (item[0], item[1]))
    result = mido.MidiTrack([mido.MetaMessage("track_name", name=name, time=0)])
    result.append(mido.Message("program_change", program=program, time=0))
    now = 0
    for at, _, message in events:
        result.append(message.copy(time=at - now))
        now = at
    return result


def save(name: str, notes: list[tuple[int, int, int]], *, program: int, title: str) -> None:
    midi = mido.MidiFile(type=1, ticks_per_beat=TPB)
    midi.tracks.append(
        mido.MidiTrack(
            [
                mido.MetaMessage("track_name", name=title, time=0),
                mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(100), time=0),
                mido.MetaMessage("time_signature", numerator=4, denominator=4, time=0),
            ]
        )
    )
    midi.tracks.append(track(notes, program=program, name="Guitar"))
    midi.save(OUT / name)


def triplets() -> list[tuple[int, int, int]]:
    """Bar 1: eighth triplets, then a quarter and an eighth pair. Bar 2: a quintuplet and a swung pair, then a rest."""
    third, fifth = TPB // 3, TPB // 5
    notes = [(i * third, pitch, third) for i, pitch in enumerate((52, 55, 57))]
    notes += [(TPB + i * third, pitch, third) for i, pitch in enumerate((59, 57, 55))]
    notes += [(2 * TPB, 52, TPB), (3 * TPB, 55, TPB // 2), (3 * TPB + TPB // 2, 57, TPB // 2)]
    bar = 4 * TPB
    notes += [(bar + i * fifth, pitch, fifth) for i, pitch in enumerate((64, 62, 60, 59, 57))]
    notes += [(bar + TPB, 55, 2 * TPB // 3), (bar + TPB + 2 * TPB // 3, 52, TPB // 3)]
    return notes


def sustain() -> list[tuple[int, int, int]]:
    """A low E held for the whole bar under a moving melody, then a held chord under a moving top line."""
    bar = 4 * TPB
    notes = [(0, 40, bar)] + [(i * TPB, pitch, TPB) for i, pitch in enumerate((64, 67, 69, 67))]
    notes += [(bar, 43, bar), (bar, 47, bar)]
    notes += [(bar + i * TPB, pitch, TPB) for i, pitch in enumerate((62, 64, 66, 64))]
    return notes


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    save("triplets.mid", triplets(), program=25, title="Triplets and quintuplets")
    save("sustain.mid", sustain(), program=25, title="Sustained notes")
