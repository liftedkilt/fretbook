"""Render a score to rough audio with known bar times: test and evaluation material for auto-sync.

A kick on every bar's first beat, a snare on the back beats, quiet hats on the eighths and the preferred
track's notes as decaying tones. Nothing here is a good-sounding mix; it only has to have a beat whose
bar starts are known exactly.
"""

from __future__ import annotations

import numpy as np

from fretbook.audio.beats import SAMPLE_RATE, Floats
from fretbook.score.model import TICKS_PER_QUARTER, ScoreDocument, preferred_track
from fretbook.score.playback import played_bars


def render(
    document: ScoreDocument,
    bar_starts: list[float],
    *,
    sample_rate: int = SAMPLE_RATE,
    tail: float = 1.0,
    seed: int = 7,
    noise: float = 0.01,
) -> Floats:
    """Audio in which played bar ``k`` starts at ``bar_starts[k]`` seconds; ``bar_starts`` has one more for the end."""
    rng = np.random.default_rng(seed)
    out = np.zeros(int((bar_starts[-1] + tail) * sample_rate))
    track = preferred_track(document)
    order = played_bars(document.bars)
    for played, written in enumerate(order):
        start, end = bar_starts[played], bar_starts[played + 1]
        bar = document.bars[written]
        quarters = bar.length_quarters

        def at(q: float, start: float = start, end: float = end, quarters: float = quarters) -> float:
            return start + q / quarters * (end - start)

        _add(out, at(0), _kick(sample_rate), sample_rate)
        q = 0.5
        while q < quarters - 1e-9:
            if q % 2 == 1:
                _add(out, at(q), _snare(sample_rate, rng), sample_rate)
            _add(out, at(q), 0.15 * _hat(sample_rate, rng), sample_rate)
            q += 0.5
        for voice in track.bars[written].voices:
            for beat in voice.beats:
                for note in beat.notes:
                    midi = track.tuning_midi[note.string] + note.fret
                    _add(out, at(beat.position / TICKS_PER_QUARTER), _tone(midi, sample_rate), sample_rate)
    out += noise * rng.standard_normal(out.size)
    return out / max(1.0, float(np.abs(out).max()))


def _add(out: Floats, when: float, sound: Floats, sample_rate: int) -> None:
    index = int(round(when * sample_rate))
    if index >= out.size:
        return
    piece = sound[: out.size - index]
    out[index : index + piece.size] += piece


def _kick(sample_rate: int) -> Floats:
    t = np.arange(int(0.2 * sample_rate)) / sample_rate
    return 1.0 * np.sin(2 * np.pi * (45 * t + 40 * (1 - np.exp(-30 * t)) / 30)) * np.exp(-18 * t)


def _snare(sample_rate: int, rng: np.random.Generator) -> Floats:
    t = np.arange(int(0.15 * sample_rate)) / sample_rate
    return 0.6 * rng.standard_normal(t.size) * np.exp(-30 * t)


def _hat(sample_rate: int, rng: np.random.Generator) -> Floats:
    t = np.arange(int(0.04 * sample_rate)) / sample_rate
    return rng.standard_normal(t.size) * np.exp(-120 * t)


def _tone(midi: int, sample_rate: int) -> Floats:
    t = np.arange(int(0.35 * sample_rate)) / sample_rate
    frequency = 440 * 2 ** ((midi - 69) / 12)
    wave = np.sin(2 * np.pi * frequency * t) + 0.4 * np.sin(4 * np.pi * frequency * t)
    return 0.35 * wave * np.exp(-6 * t) * np.minimum(1, t / 0.003)
