"""Propose sync anchors from a song's audio: beat grid, aligned to the score's played bars.

The audio's beats (:mod:`fretbook.audio.beats`) are mapped onto the score's quarter-note timeline, so
time signatures and tempo changes come from the score. Which beat is bar 0, the downbeat phase, is the
one whose bar starts land on the strongest onsets over the whole song. Bar starts between beats are
interpolated, so a 7/8 bar or a drifting tempo still gets a start time. A second pass re-tracks the beats
with the tempo profile of the score when it has tempo changes.

Anchors are keyed by *played* bar index like the tapped ones (see :class:`fretbook.score.model.SyncMap`).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from fretbook.audio import beats as beat_tracking
from fretbook.audio.beats import AudioDecodeError, BeatGrid, Envelope, Floats
from fretbook.score.model import ScoreDocument
from fretbook.score.playback import played_bars

# Quarter notes per tracked beat. Half-time and double-time are the usual octave slips.
UNITS = (0.5, 1.0, 2.0)
LOW_CONFIDENCE = 0.5


@dataclass
class Proposal:
    anchors: dict[str, float]
    """Played bar index (and the end of the last bar) to seconds in the audio."""
    confidence: dict[str, float]
    """0..1 for each anchor: how clearly the bar start lands on an onset in a steady stretch of beats."""
    overall: float
    tempo_bpm: float
    """Quarter notes per minute measured in the audio, for the score's opening bars."""
    beat_count: int
    audio_seconds: float
    low_confidence: list[int] = field(default_factory=list)
    """Played bar indexes below :data:`LOW_CONFIDENCE`."""


def _bar_timeline(document: ScoreDocument) -> tuple[Floats, Floats]:
    """Quarter-note start of each played bar (plus the end) and the tempo in force in each, in BPM."""
    starts = [0.0]
    tempos: list[float] = []
    tempo = document.bpm
    for index in played_bars(document.bars):
        bar = document.bars[index]
        if index == 0:
            tempo = document.bpm
        elif bar.tempo is not None:
            tempo = bar.tempo
        tempos.append(tempo)
        starts.append(starts[-1] + bar.length_quarters)
    return np.array(starts), np.array(tempos)


def _nearest_unit(period: float, quarter_period: float) -> float:
    ratio = period / quarter_period
    return min(UNITS, key=lambda unit: abs(np.log2(ratio / unit)))


def _beat_times(grid: BeatGrid, positions: Floats) -> Floats:
    """Seconds at fractional beat positions, extrapolating past the ends at the end periods."""
    beats = grid.beats
    count = beats.size
    inside = np.interp(positions, np.arange(count), beats)
    head = (beats[min(3, count - 1)] - beats[0]) / min(3, count - 1)
    tail = (beats[-1] - beats[max(0, count - 4)]) / min(3, count - 1)
    inside = np.where(positions < 0, beats[0] + positions * head, inside)
    return np.where(positions > count - 1, beats[-1] + (positions - (count - 1)) * tail, inside)


def _strength_at(grid: BeatGrid, times: Floats) -> Floats:
    """Largest low-band onset strength within 40 ms of each time (the kick or bass note a bar start sits on)."""
    envelope = grid.envelope.low
    frame_seconds = grid.envelope.frame_seconds
    radius = max(1, int(round(0.04 / frame_seconds)))
    centres = np.round((times - beat_tracking.FRAME_OFFSET) / frame_seconds).astype(np.int64)
    out = np.full(times.shape, -3.0)
    for slot, centre in enumerate(centres):
        if 0 <= centre < envelope.size:
            out[slot] = envelope[max(0, centre - radius) : centre + radius + 1].max()
    return out


def _align(grid: BeatGrid, bar_quarters: Floats, unit: float) -> tuple[int, Floats]:
    """The beat index that bar 0 starts on, and the bar start times, by total onset strength at the bar starts."""
    count = grid.beats.size
    bars = bar_quarters.size - 1
    first_bar_beats = max(1, int(np.ceil((bar_quarters[1] - bar_quarters[0]) / unit)))
    audio_end = grid.envelope.size * grid.envelope.frame_seconds
    baseline = float(np.mean(grid.strengths))
    best_score = -np.inf
    best: tuple[int, Floats] = (0, np.zeros(0))
    for shift in range(-first_bar_beats, count):
        times = _beat_times(grid, shift + bar_quarters / unit)
        covered = (times[:bars] >= -0.05) & (times[:bars] < audio_end - 0.1)
        if not covered.any():
            continue
        strength = _strength_at(grid, times[:bars][covered])
        # Bars are summed (not averaged) so that a shift that drops bars off the end has to earn it.
        score = float(np.sum(strength - baseline))
        if score > best_score:
            best_score, best = score, (shift, times)
    return best


def propose(document: ScoreDocument, samples: Floats, sample_rate: int = beat_tracking.SAMPLE_RATE) -> Proposal:
    """Estimate sync anchors for ``document`` from mono ``samples``."""
    envelope = beat_tracking.onset_envelope(samples, sample_rate)
    audio_seconds = samples.size / sample_rate
    bar_quarters, tempos = _bar_timeline(document)
    quarter_period = 60 / float(np.median(tempos))
    grid = beat_tracking.beat_grid(envelope, hint_bpm=float(np.median(tempos)))
    unit = _nearest_unit(grid.period, quarter_period)
    shift, times = _align(grid, bar_quarters, unit)
    if np.ptp(tempos) > 0.5:
        refined = _retrack(envelope, bar_quarters, tempos, times, unit, grid.period / unit)
        if refined is not None:
            grid = refined
            shift, times = _align(grid, bar_quarters, unit)
    bars = bar_quarters.size - 1
    covered = (times >= 0) & (times <= audio_seconds)
    covered[bars] = covered[bars] and covered[bars - 1]
    strength = _strength_at(grid, times)
    contrast = (strength - float(np.mean(grid.strengths))) / (float(np.std(grid.strengths)) + 1e-9)
    downbeat = 1 / (1 + np.exp(-(contrast - 0.5)))
    # A beat interval far from its neighbours' median means the tracker was guessing there.
    intervals = np.diff(grid.beats)
    positions = np.clip(np.round(shift + bar_quarters / unit).astype(np.int64), 0, max(0, intervals.size - 1))
    local = np.array([np.median(intervals[max(0, p - 3) : p + 4]) for p in positions])
    deviation = np.abs(intervals[positions] - local) / local
    steady = np.clip(1 - deviation / 0.2, 0, 1)
    confidence = np.clip(0.6 * downbeat + 0.4 * steady, 0, 1)
    anchors = {str(index): round(float(times[index]), 4) for index in range(bars + 1) if covered[index]}
    scores = {key: round(float(confidence[int(key)]), 3) for key in anchors}
    if len(anchors) < 2:
        raise AudioDecodeError("the beats found do not line up with this score", "autosync.noMatch")
    return Proposal(
        anchors=anchors,
        confidence=scores,
        overall=round(float(np.mean(list(scores.values()))), 3),
        tempo_bpm=round(60 / (grid.period / unit), 2),
        beat_count=int(grid.beats.size),
        audio_seconds=round(audio_seconds, 3),
        low_confidence=[int(key) for key, value in scores.items() if value < LOW_CONFIDENCE and int(key) < bars],
    )


def _retrack(
    envelope: Envelope,
    bar_quarters: Floats,
    tempos: Floats,
    first_times: Floats,
    unit: float,
    audio_quarter_period: float,
) -> BeatGrid | None:
    """Track the beats again with a period that follows the score's tempo changes.

    The first pass fixes where bar 0 sits and the audio's overall speed relative to the score; the score's
    tempo map then says how fast each bar should be, scaled by that factor.
    """
    bars = bar_quarters.size - 1
    scale = audio_quarter_period / (60 / float(np.median(tempos)))
    quarter_seconds = 60 / tempos * scale  # audio seconds per quarter note in each bar
    # Audio time of each bar start under the profile, anchored on the first pass's bar 0.
    profile_starts = first_times[0] + np.concatenate([[0.0], np.cumsum(np.diff(bar_quarters) * quarter_seconds)])
    frame_times = np.arange(envelope.size) * envelope.frame_seconds
    bar_of_frame = np.clip(np.searchsorted(profile_starts, frame_times, side="right") - 1, 0, bars - 1)
    periods = unit * quarter_seconds[bar_of_frame]
    try:
        return beat_tracking.beat_grid(envelope, period=periods)
    except AudioDecodeError:
        return None
