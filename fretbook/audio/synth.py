"""Render a score to rough audio with known bar times: test and evaluation material for auto-sync.

A kick on every bar's first beat, a snare on the back beats, quiet hats on the eighths and the preferred
track's notes as decaying tones. Nothing here is a good-sounding mix; it only has to have a beat whose
bar starts are known exactly.
"""

from __future__ import annotations

import numpy as np

from fretbook.audio.beats import SAMPLE_RATE, Floats
from fretbook.score.model import (
    TICKS_PER_QUARTER,
    Bar,
    Beat,
    Note,
    ScoreDocument,
    Track,
    TrackBar,
    Voice,
    played_bar_seconds,
    preferred_track,
)
from fretbook.score.playback import played_bars


def render(
    document: ScoreDocument,
    bar_starts: list[float],
    *,
    sample_rate: int = SAMPLE_RATE,
    tail: float = 1.0,
    seed: int = 7,
    noise: float = 0.01,
    count_in: int = 0,
    intro: float = 0.0,
) -> Floats:
    """Audio in which played bar ``k`` starts at ``bar_starts[k]`` seconds; ``bar_starts`` has one more for the end.

    ``count_in`` is a number of stick clicks before bar 0, one a beat of the first bar, and ``intro`` the seconds
    after the start of the audio in which an unmetered pad is strummed, music the tab does not have. Both need
    room before ``bar_starts[0]``.
    """
    rng = np.random.default_rng(seed)
    out = np.zeros(int((bar_starts[-1] + tail) * sample_rate))
    pulse = (bar_starts[1] - bar_starts[0]) / document.bars[0].signature[0]
    for click in range(1, count_in + 1):
        _add(out, bar_starts[0] - click * pulse, _click(sample_rate), sample_rate)
    if intro:
        strum = 0.3
        while strum < min(intro, bar_starts[0] - count_in * pulse - 0.3):
            for offset, midi in enumerate((45, 52, 57)):
                _add(out, strum + 0.03 * offset, _tone(midi, sample_rate), sample_rate)
            strum += 1.37
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


def render_notes(
    notes: list[tuple[float, float, int]],
    *,
    bpm: float | None = None,
    sample_rate: int = SAMPLE_RATE,
    tail: float = 0.5,
) -> Floats:
    """Plucked-string audio for ``(start_sec, end_sec, midi)`` notes: test and evaluation material for transcription.

    With ``bpm``, a kick on every beat and a snare on the back beats are added under the notes so the beat tracker has
    a pulse to follow, as in a recording with drums.
    """
    end = max(end for _, end, _ in notes) + tail
    out = np.zeros(int(end * sample_rate))
    for start, stop, midi in notes:
        t = np.arange(int(max(stop - start, 0.1) * sample_rate)) / sample_rate
        frequency = 440 * 2 ** ((midi - 69) / 12)
        partials = sum(np.sin(2 * np.pi * frequency * h * t) / h**1.2 for h in range(1, 7) if frequency * h < 8000)
        tone = 0.25 * partials * np.exp(-t * 2.5) * np.minimum(1, t / 0.004)
        _add(out, start, tone, sample_rate)
    if bpm:
        rng = np.random.default_rng(7)
        beat = 60 / bpm
        for index in range(int(end / beat)):
            _add(out, index * beat, _kick(sample_rate) if index % 2 == 0 else _snare(sample_rate, rng), sample_rate)
    return out


def _add(out: Floats, when: float, sound: Floats, sample_rate: int) -> None:
    index = int(round(when * sample_rate))
    if index >= out.size:
        return
    piece = sound[: out.size - index]
    out[index : index + piece.size] += piece


def _click(sample_rate: int) -> Floats:
    t = np.arange(int(0.03 * sample_rate)) / sample_rate
    return 0.7 * np.sin(2 * np.pi * 1800 * t) * np.exp(-150 * t)


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


def build_document(
    signatures: list[tuple[int, int]],
    *,
    bpm: float = 100,
    tempos: dict[int, float] | None = None,
    repeat: tuple[int, int, int] | None = None,
) -> ScoreDocument:
    """A bass line over ``signatures``: a note on every quarter (or eighth, in x/8), stepping through a riff.

    ``tempos`` maps a bar index to a tempo change; ``repeat`` is ``(first bar, last bar, times)``.
    """
    riff = [0, 0, 3, 5, 3, 0, 5, 7]
    bars: list[Bar] = []
    track_bars: list[TrackBar] = []
    count = 0
    for index, (numerator, denominator) in enumerate(signatures):
        bar = Bar(signature=(numerator, denominator), tempo=(tempos or {}).get(index) if index else None)
        if repeat and index == repeat[0]:
            bar.repeat_start = True
        if repeat and index == repeat[1]:
            bar.repeat_end = repeat[2]
        bars.append(bar)
        step = 4 * TICKS_PER_QUARTER // denominator
        beats = []
        for slot in range(numerator):
            fret = riff[count % len(riff)]
            count += 1
            beats.append(Beat(position=slot * step, duration=step, notes=[Note(string=3, fret=fret)]))
        track_bars.append(TrackBar(voices=[Voice(beats=beats)]))
    track = Track(id="t1", name="Bass", instrument="bass", tuning_midi=[28, 33, 38, 43], bars=track_bars)
    return ScoreDocument(bpm=bpm, bars=bars, tracks=[track])


def bar_starts_for(
    document: ScoreDocument,
    *,
    lead_in: float = 0.0,
    drift: float = 0.0,
    sway: float = 0.0,
    sway_cycles: float = 4.0,
    ritardando: float = 0.0,
    jitter: float = 0.0,
    seed: int = 11,
) -> list[float]:
    """Audio time of every played bar start (plus the end) at the score's own tempo, after ``lead_in`` seconds.

    ``drift`` slows or speeds the whole performance by up to that fraction, as a slow sine over the song.
    ``sway`` does the same ``sway_cycles`` times over (rubato), ``ritardando`` slows the last eighth of the
    song by up to that fraction, and ``jitter`` moves each bar start by a random amount of that many seconds
    (standard deviation), as a human player does.
    """
    starts = [lead_in]
    lengths = played_bar_seconds(document)
    total = sum(lengths)
    for length in lengths:
        progress = (starts[-1] - lead_in) / total
        factor = 1 + drift * np.sin(2 * np.pi * progress) + sway * np.sin(2 * np.pi * sway_cycles * progress)
        factor += ritardando * max(0.0, (progress - 0.875) / 0.125)
        starts.append(starts[-1] + length * factor)
    if jitter:
        moved = np.array(starts)
        moved[1:-1] += np.random.default_rng(seed).normal(0, jitter, len(starts) - 2)
        starts = moved.tolist()
    return starts
