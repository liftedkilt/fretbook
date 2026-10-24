"""Beat tracking with numpy only: decode, onset envelope, tempo, and Ellis-style dynamic programming.

This is deliberately small (no librosa, madmom or torch, which would triple the image). It is a
steady-pulse tracker: good for a recording with a clear beat, and given the score's tempo as a prior it
rarely picks the wrong octave. The alignment to the score's bars is in :mod:`fretbook.score.autosync`.
"""

from __future__ import annotations

import shutil
import subprocess
import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

SAMPLE_RATE = 22050
FRAME = 1024
HOP = 256  # 11.6 ms per envelope frame
MAX_SECONDS = 20 * 60
BANDS = 32
LOW_HZ = 250
FRAME_OFFSET = 0.028
"""Seconds added to a frame's start time to get the time of the onset that peaks in it (measured on clicks)."""

Floats = NDArray[np.float64]


class AudioDecodeError(Exception):
    """The audio could not be read. ``key`` is an ``errors`` catalog key."""

    def __init__(self, message: str, key: str) -> None:
        super().__init__(message)
        self.key = key


@dataclass(frozen=True)
class Envelope:
    full: Floats
    """Onset strength over all bands, as z-scores per frame."""
    low: Floats
    """The same for the bands below ``LOW_HZ``, where a kick or a bass note marks a bar's first beat."""
    frame_seconds: float

    @property
    def size(self) -> int:
        return int(self.full.size)


@dataclass(frozen=True)
class BeatGrid:
    beats: Floats
    """Beat times in seconds."""
    strengths: Floats
    """Low-band onset strength at each beat, in standard deviations above the mean."""
    period: float
    """Median seconds per beat."""
    envelope: Envelope


def decode(path: Path, *, sample_rate: int = SAMPLE_RATE) -> Floats:
    """Mono float samples. WAV is read directly; everything else goes through ffmpeg."""
    if path.suffix.lower() == ".wav":
        try:
            return _read_wav(path, sample_rate)
        except (wave.Error, EOFError):
            pass  # float or exotic WAV: let ffmpeg try
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        raise AudioDecodeError("ffmpeg is needed to read this audio file", "autosync.noFfmpeg")
    command = [ffmpeg, "-v", "error", "-i", str(path), "-t", str(MAX_SECONDS), "-ac", "1", "-ar", str(sample_rate)]
    command += ["-f", "f32le", "-"]
    try:
        done = subprocess.run(command, capture_output=True, timeout=600, check=False)
    except subprocess.TimeoutExpired as exc:
        raise AudioDecodeError("decoding the audio took too long", "autosync.decodeFailed") from exc
    samples = np.frombuffer(done.stdout, dtype="<f4").astype(np.float64)
    if done.returncode != 0 or samples.size == 0:
        raise AudioDecodeError("the audio file could not be decoded", "autosync.decodeFailed")
    return samples


def _read_wav(path: Path, sample_rate: int) -> Floats:
    with wave.open(str(path), "rb") as handle:
        channels, width, rate, frames = (
            handle.getnchannels(),
            handle.getsampwidth(),
            handle.getframerate(),
            handle.getnframes(),
        )
        raw = handle.readframes(min(frames, MAX_SECONDS * rate))
    if width == 2:
        data = np.frombuffer(raw, dtype="<i2").astype(np.float64) / 32768
    elif width == 1:
        data = (np.frombuffer(raw, dtype=np.uint8).astype(np.float64) - 128) / 128
    elif width == 4:
        data = np.frombuffer(raw, dtype="<i4").astype(np.float64) / 2**31
    else:
        raise wave.Error("unsupported sample width")
    if channels > 1:
        data = data[: data.size - data.size % channels].reshape(-1, channels).mean(axis=1)
    if rate != sample_rate and data.size:
        target = max(1, int(round(data.size * sample_rate / rate)))
        data = np.interp(np.linspace(0, data.size - 1, target), np.arange(data.size), data)
    return data


def onset_envelope(samples: Floats, sample_rate: int = SAMPLE_RATE) -> Envelope:
    """Half-wave rectified log-spectral flux over ``BANDS`` bands, as z-scores, overall and for the low bands."""
    frame_seconds = HOP / sample_rate
    if samples.size < FRAME * 2:
        return Envelope(np.zeros(0), np.zeros(0), frame_seconds)
    window = np.hanning(FRAME)
    count = 1 + (samples.size - FRAME) // HOP
    index = np.arange(FRAME)[None, :] + HOP * np.arange(count)[:, None]
    spectrum = np.abs(np.fft.rfft(samples[index] * window, axis=1))
    edges = np.unique(np.geomspace(2, spectrum.shape[1] - 1, BANDS + 1).astype(int))
    bands = np.stack([spectrum[:, lo:hi].sum(axis=1) for lo, hi in zip(edges[:-1], edges[1:], strict=True)], axis=1)
    logged = np.log1p(100 * bands / (bands.max() + 1e-12))
    flux = np.concatenate([np.zeros((1, logged.shape[1])), np.maximum(logged[1:] - logged[:-1], 0)])
    low_bands = max(1, int(np.searchsorted(edges * sample_rate / FRAME, LOW_HZ)))
    return Envelope(_zscore(flux.mean(axis=1)), _zscore(flux[:, :low_bands].mean(axis=1)), frame_seconds)


def _zscore(values: Floats) -> Floats:
    spread = values.std()
    if spread < 1e-9:
        return np.zeros(values.size)
    return (values - values.mean()) / spread


def estimate_period(envelope: Floats, frame_seconds: float, hint_bpm: float | None) -> float:
    """Seconds per beat from the envelope's autocorrelation, weighted toward ``hint_bpm`` when given."""
    low_lag = max(2, int(0.25 / frame_seconds))  # 240 BPM
    high_lag = min(envelope.size // 2, int(1.5 / frame_seconds))  # 40 BPM
    if high_lag <= low_lag:
        raise AudioDecodeError("the audio is too short to find a beat", "autosync.tooShort")
    size = 1 << int(np.ceil(np.log2(envelope.size * 2)))
    spectrum = np.fft.rfft(envelope - envelope.mean(), size)
    acf = np.fft.irfft(spectrum * np.conj(spectrum))[: high_lag + 1]
    acf = acf / (acf[0] + 1e-12)
    lags = np.arange(low_lag, high_lag + 1)
    score = acf[low_lag : high_lag + 1].copy()
    if hint_bpm:
        # Log-Gaussian, one octave wide: strong enough to stop 2x and 0.5x, weak enough to follow a slower take.
        octaves = np.log2(lags * frame_seconds * hint_bpm / 60)
        score = score * np.exp(-0.5 * (octaves / 0.6) ** 2)
    best = int(lags[int(np.argmax(score))])
    # Refine to a sub-frame lag with a parabola through the peak.
    if low_lag < best < high_lag:
        left, mid, right = acf[best - 1], acf[best], acf[best + 1]
        denominator = left - 2 * mid + right
        if denominator < 0:
            best = best + 0.5 * (left - right) / denominator
    return float(best * frame_seconds)


def track_beats(envelope: Floats, frame_seconds: float, period: float | Floats, tightness: float = 100.0) -> list[int]:
    """Frame indexes of the beats: each beat adds its onset score and a penalty for straying from the period.

    ``period`` is a number of seconds, or one value per frame when the tempo changes.
    """
    count = envelope.size
    lags = np.broadcast_to(np.asarray(period, dtype=np.float64) / frame_seconds, (count,))
    reference = float(np.median(lags))
    kernel_half = max(1, int(reference / 8))
    kernel = np.exp(-0.5 * (np.arange(-kernel_half, kernel_half + 1) / (kernel_half / 2)) ** 2)
    local = np.convolve(envelope, kernel, mode="same")
    backlink = np.full(count, -1, dtype=np.int64)
    cumulative = local.copy()
    ratios = np.linspace(2.0, 0.5, 64)
    penalties = -tightness * np.log(ratios) ** 2
    for frame in range(count):
        offsets = np.round(ratios * lags[frame]).astype(np.int64)
        candidates = frame - offsets
        valid = candidates >= 0
        if not valid.any():
            continue
        values = cumulative[candidates[valid]] + penalties[valid]
        best = int(np.argmax(values))
        cumulative[frame] = local[frame] + values[best]
        backlink[frame] = candidates[valid][best]
    # The last beat is the best-scoring frame in the final two beats of the signal.
    tail_start = max(0, count - int(2 * lags[-1]))
    last = int(np.argmax(cumulative[tail_start:])) + tail_start
    beats = [last]
    while backlink[beats[-1]] >= 0:
        beats.append(int(backlink[beats[-1]]))
    return beats[::-1]


def beat_grid(
    envelope: Envelope,
    hint_bpm: float | None = None,
    period: float | Floats | None = None,
) -> BeatGrid:
    """Track beats in ``envelope``. Without ``period`` it is estimated (with ``hint_bpm`` as a prior)."""
    frame_seconds = envelope.frame_seconds
    if envelope.size < int(4 / frame_seconds):
        raise AudioDecodeError("the audio is too short to find a beat", "autosync.tooShort")
    if period is None:
        period = estimate_period(envelope.full, frame_seconds, hint_bpm)
    frames = track_beats(envelope.full, frame_seconds, period)
    if len(frames) < 4:
        raise AudioDecodeError("no steady beat was found in this audio", "autosync.noBeat")
    beats = np.array(frames, dtype=np.float64) * frame_seconds + FRAME_OFFSET
    return BeatGrid(
        beats=beats,
        strengths=envelope.low[np.array(frames)],
        period=float(np.median(np.diff(beats))),
        envelope=envelope,
    )
