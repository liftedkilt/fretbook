"""Write a tab as a Standard MIDI File (type 1) for a DAW.

Track 0 carries the title, the tempo map and the time signatures; every score track follows on its own channel
(channel 10, the drum channel, is skipped). Bars are written in *played* order, so repeats, voltas and jumps are
expanded the way the player plays them. A tied note is joined to the note it continues, and a note's pitch is
``tuning + capo + fret``. Dead notes sound as a short tick and grace notes as a very short note on their beat;
techniques (bends, slides, harmonics) are not written.
"""

from __future__ import annotations

import io
from typing import Any

import mido

from fretbook.score.instruments import family
from fretbook.score.model import TICKS_PER_QUARTER, ScoreDocument, Track, tempo_at
from fretbook.score.playback import played_bars

_DRUM_CHANNEL = 9
_PROGRAMS = {"guitar": 27, "acoustic-guitar": 25, "bass-guitar": 33}
_SHORT = TICKS_PER_QUARTER // 8
_GRACE = TICKS_PER_QUARTER // 16


def _program(track: Track) -> int:
    if track.instrument in _PROGRAMS:
        return _PROGRAMS[track.instrument]
    return 33 if family(track.instrument) == "bass" else 27


def _channel(index: int) -> int:
    channel = index % 15
    return channel + 1 if channel >= _DRUM_CHANNEL else channel


def _notes(document: ScoreDocument, track: Track, order: list[int]) -> list[tuple[int, int, int]]:
    """``(start, end, pitch)`` over the played bars, with a tied note joined to the note it continues."""
    notes: list[list[int]] = []
    last: dict[tuple[int, int], list[int]] = {}
    origin = 0
    for bar_index in order:
        for voice_index, voice in enumerate(track.bars[bar_index].voices):
            for beat in voice.beats:
                start = origin + beat.position
                length = _GRACE if beat.grace else beat.duration
                for note in beat.notes:
                    key = (voice_index, note.string)
                    prior = last.get(key)
                    if note.tie and prior is not None and prior[1] == start:
                        prior[1] = start + length
                        continue
                    pitch = track.tuning_midi[note.string] + track.capo + note.fret
                    entry = [start, start + (_SHORT if note.dead else length), pitch]
                    notes.append(entry)
                    last[key] = entry
        origin += document.bars[bar_index].length_ticks
    return [(start, end, pitch) for start, end, pitch in notes]


def to_midi(document: ScoreDocument, *, title: str = "") -> bytes:
    order = played_bars(document.bars)
    midi = mido.MidiFile(type=1, ticks_per_beat=TICKS_PER_QUARTER)

    conductor = mido.MidiTrack()
    if title:
        conductor.append(mido.MetaMessage("track_name", name=title, time=0))
    events: list[tuple[int, int, Any]] = []
    origin = 0
    last_tempo: float | None = None
    last_signature: tuple[int, int] | None = None
    for bar_index in order:
        bar = document.bars[bar_index]
        tempo = tempo_at(document, bar_index)
        if tempo != last_tempo:
            events.append((origin, 0, mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(tempo))))
            last_tempo = tempo
        if bar.signature != last_signature:
            numerator, denominator = bar.signature
            events.append((origin, 1, mido.MetaMessage("time_signature", numerator=numerator, denominator=denominator)))
            last_signature = bar.signature
        origin += bar.length_ticks
    _append(conductor, events)
    conductor.append(mido.MetaMessage("end_of_track", time=0))
    midi.tracks.append(conductor)

    for index, track in enumerate(document.tracks):
        channel = _channel(index)
        part = mido.MidiTrack()
        part.append(mido.MetaMessage("track_name", name=track.name, time=0))
        part.append(mido.Message("program_change", channel=channel, program=_program(track), time=0))
        timed: list[tuple[int, int, Any]] = []
        for start, end, pitch in _notes(document, track, order):
            note = max(0, min(127, pitch))
            timed.append((start, 1, mido.Message("note_on", channel=channel, note=note, velocity=90)))
            timed.append((end, 0, mido.Message("note_off", channel=channel, note=note, velocity=0)))
        _append(part, timed)
        part.append(mido.MetaMessage("end_of_track", time=0))
        midi.tracks.append(part)

    buffer = io.BytesIO()
    midi.save(file=buffer)
    return buffer.getvalue()


def _append(track: mido.MidiTrack, timed: list[tuple[int, int, Any]]) -> None:
    """Add ``(tick, order, message)`` items to ``track`` with delta times; offs sort before ons at the same tick."""
    now = 0
    for tick, _, message in sorted(timed, key=lambda item: (item[0], item[1])):
        track.append(message.copy(time=tick - now))
        now = tick
