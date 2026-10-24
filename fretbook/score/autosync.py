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
OPENING = 3.0
"""Bonus, in the same units, for bar 0 starting on the first attack in the audio."""
SLIP = 4.0
"""Cost, in standard deviations of onset strength, of a bar starting a beat early or late of its length."""


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


def _pulse(bar_quarters: Floats) -> float:
    """The longest steady pulse (in quarter notes) that every bar length is a whole number of.

    A 7/8 bar is 3.5 quarters, so the quarter pulse slips half a beat each time one goes by: such a song is
    tracked in eighths (or sixteenths) instead.
    """
    lengths = np.diff(bar_quarters)
    for pulse in (1.0, 0.5, 0.25):
        if np.allclose(lengths / pulse, np.round(lengths / pulse), atol=1e-6):
            return pulse
    return 0.25


def _nearest_unit(period: float, quarter_period: float, pulse: float) -> float:
    ratio = period / quarter_period
    return min((unit * pulse for unit in UNITS), key=lambda unit: abs(np.log2(ratio / unit)))


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
    # A running maximum over 2 * radius + 1 frames, by padding with the floor value off both ends.
    padded = np.concatenate([np.full(radius, -3.0), envelope, np.full(radius, -3.0)])
    windows = np.lib.stride_tricks.sliding_window_view(padded, 2 * radius + 1).max(axis=1)
    inside = (centres >= 0) & (centres < envelope.size)
    return np.where(inside, windows[np.clip(centres, 0, envelope.size - 1)], -3.0)


def _first_attack(grid: BeatGrid) -> float:
    """Seconds to the first clear onset (more than 3 standard deviations above the mean) in the audio."""
    attacks = np.flatnonzero((grid.envelope.full > 3.0) | (grid.envelope.low > 3.0))
    first = int(attacks[0]) if attacks.size else 0
    return first * grid.envelope.frame_seconds + beat_tracking.FRAME_OFFSET


def _align(grid: BeatGrid, bar_quarters: Floats, unit: float, *, upto: int | None = None) -> tuple[Floats, Floats]:
    """Beat positions and times of the bar starts (and the end), by Viterbi over which beat each bar starts on.

    A bar's start sits on a beat (or a fixed fraction of one) and is rewarded by the low-band onset there. The
    next bar starts one bar-length of beats later, give or take a beat: a slip costs ``SLIP``, so a beat the
    tracker dropped or added is absorbed there rather than shifting every later bar.
    """
    count = grid.beats.size
    if upto is not None:
        bar_quarters = bar_quarters[: upto + 1]
    bars = bar_quarters.size - 1
    audio_end = grid.envelope.size * grid.envelope.frame_seconds
    span = max(1, int(np.ceil((bar_quarters[1] - bar_quarters[0]) / unit)))
    shifts = np.arange(-span, count)
    positions = shifts[None, :] + bar_quarters[:, None] / unit
    times = _beat_times(grid, positions.ravel()).reshape(positions.shape)
    strength = _strength_at(grid, times[:bars].ravel()).reshape(bars, -1)
    reward = strength - float(np.mean(grid.strengths))
    # A bar that would start before the first attack in the audio counts against the path: the score starts
    # with the music, and without this a bar-long shift of a repeating pattern would be a tie.
    attack = _first_attack(grid)
    reward = np.where(times[:bars] < attack - 0.15, -1.0, reward)
    reward = np.where(times[:bars] >= audio_end - 0.1, 0.0, reward)
    # Whole bars of a repeating pattern look alike, so a song that opens on its first bar is given the edge: bar 0
    # on the first attack in the audio, or else as early as it can be.
    reward[0] += OPENING * (np.abs(times[0] - attack) < 0.12)
    score = reward[0] - 0.01 * np.arange(shifts.size)
    back = np.zeros((bars, shifts.size), dtype=np.int64)
    floor = np.full(1, -np.inf)
    for bar in range(1, bars):
        options = np.stack(
            [score, np.concatenate([floor, score[:-1]]) - SLIP, np.concatenate([score[1:], floor]) - SLIP]
        )
        back[bar] = np.argmax(options, axis=0)
        score = options.max(axis=0) + reward[bar]
    state = int(np.argmax(score))
    path = [state]
    for bar in range(bars - 1, 0, -1):
        state += (0, -1, 1)[int(back[bar, state])]
        path.append(state)
    path.reverse()
    path.append(path[-1])
    rows = np.arange(bars + 1)
    return positions[rows, path], times[rows, path]


def propose(document: ScoreDocument, samples: Floats, sample_rate: int = beat_tracking.SAMPLE_RATE) -> Proposal:
    """Estimate sync anchors for ``document`` from mono ``samples``."""
    envelope = beat_tracking.onset_envelope(samples, sample_rate)
    audio_seconds = samples.size / sample_rate
    bar_quarters, tempos = _bar_timeline(document)
    quarter_period = 60 / float(np.median(tempos))
    pulse = _pulse(bar_quarters)
    grid = beat_tracking.beat_grid(envelope, hint_bpm=float(np.median(tempos)) / pulse)
    unit = _nearest_unit(grid.period, quarter_period, pulse)
    changes = np.flatnonzero(np.abs(tempos - tempos[0]) > 0.5)
    if changes.size:
        # The first pass tracks one tempo, so only the bars before the first change say where the song starts.
        _, first = _align(grid, bar_quarters, unit, upto=max(4, int(changes[0])))
        profile = _score_profile(bar_quarters, tempos, float(first[0]), grid.period / unit)
        refined = _retrack(envelope, bar_quarters, profile, unit)
        if refined is not None:
            grid = refined
        positions, times = _align(grid, bar_quarters, unit)
        # Once the bars are placed, the tempo can be read off them instead of taken from the score.
        again = _retrack(envelope, bar_quarters, times, unit)
        if again is not None:
            positions2, times2 = _align(again, bar_quarters, unit)
            if _plausible(times2, times):
                grid, positions, times = again, positions2, times2
    else:
        positions, times = _align(grid, bar_quarters, unit)
    bars = bar_quarters.size - 1
    covered = (times >= -0.05) & (times <= audio_seconds + 0.05)
    covered[bars] = covered[bars] and covered[bars - 1]
    strength = _strength_at(grid, times)
    contrast = (strength - float(np.mean(grid.strengths))) / (float(np.std(grid.strengths)) + 1e-9)
    downbeat = 1 / (1 + np.exp(-(contrast - 0.5)))
    # A beat interval far from its neighbours' median means the tracker was guessing there.
    intervals = np.diff(grid.beats)
    beat_index = np.clip(np.round(positions).astype(np.int64), 0, max(0, intervals.size - 1))
    local = np.array([np.median(intervals[max(0, p - 3) : p + 4]) for p in beat_index])
    deviation = np.abs(intervals[beat_index] - local) / local
    steady = np.clip(1 - deviation / 0.2, 0, 1)
    confidence = np.clip(0.6 * downbeat + 0.4 * steady, 0, 1)
    anchors = {str(index): round(max(0.0, float(times[index])), 4) for index in range(bars + 1) if covered[index]}
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


def _retrack(envelope: Envelope, bar_quarters: Floats, bar_starts: Floats, unit: float) -> BeatGrid | None:
    """Track the beats again with a period that follows where the bars are thought to start.

    ``bar_starts`` are the bars' audio times (``bar_quarters.size`` of them); each bar's beat period is its
    length in seconds over its length in beats, so a tempo change in the score is followed as it comes.
    """
    bars = bar_quarters.size - 1
    seconds = np.maximum(np.diff(bar_starts), 1e-3)
    periods_per_bar = unit * seconds / np.diff(bar_quarters)
    frame_times = np.arange(envelope.size) * envelope.frame_seconds
    bar_of_frame = np.clip(np.searchsorted(bar_starts, frame_times, side="right") - 1, 0, bars - 1)
    try:
        return beat_tracking.beat_grid(envelope, period=periods_per_bar[bar_of_frame])
    except AudioDecodeError:
        return None


def _score_profile(bar_quarters: Floats, tempos: Floats, first_start: float, audio_quarter_period: float) -> Floats:
    """Bar start times if the performance follows the score's tempo map, scaled to the audio's overall speed."""
    scale = audio_quarter_period / (60 / float(np.median(tempos)))
    return first_start + np.concatenate([[0.0], np.cumsum(np.diff(bar_quarters) * 60 / tempos * scale)])


def _plausible(new: Floats, old: Floats) -> bool:
    """A second reading is taken only if it stays near the first (a bar or two moving by a beat, not a new song)."""
    return bool(np.median(np.abs(new - old)) < 0.1)
