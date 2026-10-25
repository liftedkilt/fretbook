"""Polyphonic audio transcription into tabs: audio-to-MIDI-to-tab with basic-pitch, beats and fingering.

Transcription runs only in the job worker (worker-only kind ``audio.transcribe``) when ``onnxruntime``
is installed and the basic-pitch ONNX model is present.

Pipeline:
1. Optional stem isolation (isolate bass or guitar stem using Demucs).
2. Polyphonic transcription to MIDI note events using Spotify's basic-pitch model (via ONNX runtime).
3. Beat tracking (:mod:`fretbook.audio.beats`) to find tempo and bar anchor times.
4. Note-to-tick mapping and automatic fret assignment (:func:`fretbook.score.fingering.assign_frets`).
5. Output is a draft tab track with sync marks set from the beat grid.
"""

from __future__ import annotations

import importlib.util
from bisect import bisect_right
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from fretbook.audio import beats as beat_tracking
from fretbook.audio import stems as stem_engine
from fretbook.importers.base import Notice
from fretbook.importers.midi import (
    DEFAULT_GRID,
    GRIDS,
    HIGH_PITCH,
    LOW_PITCH,
    MidiOptions,
    MidiSource,
    ParsedMidi,
    build_document,
    suggest_preset,
)
from fretbook.score.instruments import is_preset
from fretbook.score.model import TICKS_PER_QUARTER, ScoreDocument

MODEL_PATH = Path(__file__).parent / "models" / "basic_pitch.onnx"

SAMPLE_RATE = 22050
FFT_HOP = 256
AUDIO_N_SAMPLES = 43844
N_OVERLAPPING_FRAMES = 30
ANNOTATIONS_FPS = 86.1328125  # 22050 / 256
MIDI_OFFSET = 21
MAX_FREQ_IDX = 87
DEFAULT_ONSET_THRESH = 0.5
DEFAULT_FRAME_THRESH = 0.3
DEFAULT_MIN_NOTE_LEN = 11


class TranscriptionError(Exception):
    """Transcription failed. ``key`` is an ``errors`` catalog key."""

    def __init__(self, message: str, key: str, **params: Any) -> None:
        super().__init__(message)
        self.key = key
        self.params = params


def available() -> bool:
    """Whether transcription can run here. A worker that cannot run it does not advertise the job."""
    return importlib.util.find_spec("onnxruntime") is not None and MODEL_PATH.is_file()


@dataclass(frozen=True)
class NoteEvent:
    start_sec: float
    end_sec: float
    pitch: int
    amplitude: float


_SESSION = None


def _get_session() -> Any:
    global _SESSION
    if _SESSION is None:
        if not available():
            raise TranscriptionError("onnxruntime is not installed", "transcribe.unavailable")
        import onnxruntime as ort  # noqa: PLC0415

        _SESSION = ort.InferenceSession(str(MODEL_PATH), providers=["CPUExecutionProvider"])
    return _SESSION


def _unwrap_output(output: NDArray[np.float32], original_length: int, n_overlapping_frames: int) -> NDArray[np.float32]:
    """Unwrap batched model predictions into a 2D (frames x freqs) matrix."""
    n_olap = int(0.5 * n_overlapping_frames)
    if n_olap > 0:
        output = output[:, n_olap:-n_olap, :]
    n_output_frames = int(np.floor(original_length * (ANNOTATIONS_FPS / SAMPLE_RATE)))
    flat = output.reshape(-1, output.shape[2])
    return flat[:n_output_frames, :]


def _get_inferred_onsets(
    onsets: NDArray[np.float32], frames: NDArray[np.float32], n_diff: int = 2
) -> NDArray[np.float32]:
    """Infer onsets from large changes in frame amplitudes in addition to predicted onsets."""
    diffs = []
    for n in range(1, n_diff + 1):
        frames_appended = np.concatenate([np.zeros((n, frames.shape[1]), dtype=frames.dtype), frames])
        diffs.append(frames_appended[n:, :] - frames_appended[:-n, :])
    frame_diff = np.min(diffs, axis=0)
    frame_diff[frame_diff < 0] = 0
    frame_diff[:n_diff, :] = 0
    max_diff = float(np.max(frame_diff))
    max_onset = float(np.max(onsets))
    if max_diff > 0:
        frame_diff = max_onset * frame_diff / max_diff
    return np.maximum(onsets, frame_diff)


def _output_to_notes(
    frames: NDArray[np.float32],
    onsets: NDArray[np.float32],
    onset_thresh: float = DEFAULT_ONSET_THRESH,
    frame_thresh: float = DEFAULT_FRAME_THRESH,
    min_note_len: int = DEFAULT_MIN_NOTE_LEN,
    infer_onsets: bool = True,
    melodia_trick: bool = True,
    energy_tol: int = 11,
    min_pitch: int = LOW_PITCH,
    max_pitch: int = HIGH_PITCH,
) -> list[NoteEvent]:
    """Decode raw model frames and onsets into polyphonic NoteEvent objects."""
    import scipy.signal  # noqa: PLC0415

    n_frames = frames.shape[0]
    if infer_onsets:
        onsets = _get_inferred_onsets(onsets, frames)

    peak_thresh_mat = np.zeros_like(onsets)
    peaks = scipy.signal.argrelmax(onsets, axis=0)
    peak_thresh_mat[peaks] = onsets[peaks]

    onset_idx = np.where(peak_thresh_mat >= onset_thresh)
    onset_time_idx = onset_idx[0][::-1]
    onset_freq_idx = onset_idx[1][::-1]

    remaining_energy = frames.copy()
    note_events: list[tuple[int, int, int, float]] = []

    for note_start_idx, freq_idx in zip(onset_time_idx, onset_freq_idx, strict=False):
        if note_start_idx >= n_frames - 1:
            continue
        i = note_start_idx + 1
        k = 0
        while i < n_frames - 1 and k < energy_tol:
            if remaining_energy[i, freq_idx] < frame_thresh:
                k += 1
            else:
                k = 0
            i += 1
        i -= k
        if i - note_start_idx <= min_note_len:
            continue

        remaining_energy[note_start_idx:i, freq_idx] = 0
        if freq_idx < MAX_FREQ_IDX:
            remaining_energy[note_start_idx:i, freq_idx + 1] = 0
        if freq_idx > 0:
            remaining_energy[note_start_idx:i, freq_idx - 1] = 0

        amplitude = float(np.mean(frames[note_start_idx:i, freq_idx]))
        pitch = int(freq_idx) + MIDI_OFFSET
        if min_pitch <= pitch <= max_pitch:
            note_events.append((int(note_start_idx), int(i), pitch, amplitude))

    if melodia_trick:
        energy_shape = remaining_energy.shape
        while float(np.max(remaining_energy)) > frame_thresh:
            i_mid, freq_idx = np.unravel_index(np.argmax(remaining_energy), energy_shape)
            remaining_energy[i_mid, freq_idx] = 0

            i = i_mid + 1
            k = 0
            while i < n_frames - 1 and k < energy_tol:
                if remaining_energy[i, freq_idx] < frame_thresh:
                    k += 1
                else:
                    k = 0
                remaining_energy[i, freq_idx] = 0
                if freq_idx < MAX_FREQ_IDX:
                    remaining_energy[i, freq_idx + 1] = 0
                if freq_idx > 0:
                    remaining_energy[i, freq_idx - 1] = 0
                i += 1
            i_end = i - 1 - k

            i = i_mid - 1
            k = 0
            while i > 0 and k < energy_tol:
                if remaining_energy[i, freq_idx] < frame_thresh:
                    k += 1
                else:
                    k = 0
                remaining_energy[i, freq_idx] = 0
                if freq_idx < MAX_FREQ_IDX:
                    remaining_energy[i, freq_idx + 1] = 0
                if freq_idx > 0:
                    remaining_energy[i, freq_idx - 1] = 0
                i -= 1
            i_start = i + 1 + k

            if i_end - i_start <= min_note_len:
                continue

            amplitude = float(np.mean(frames[i_start:i_end, freq_idx]))
            pitch = int(freq_idx) + MIDI_OFFSET
            if min_pitch <= pitch <= max_pitch:
                note_events.append((int(i_start), int(i_end), pitch, amplitude))

    note_events.sort(key=lambda n: (n[0], n[2]))
    frame_duration = FFT_HOP / SAMPLE_RATE
    return [
        NoteEvent(
            start_sec=round(start * frame_duration, 4),
            end_sec=round(end * frame_duration, 4),
            pitch=pitch,
            amplitude=round(amp, 4),
        )
        for start, end, pitch, amp in note_events
    ]


# Intervals above a fundamental where a harmonic is heard as a note of its own: octave, octave and a fifth, two octaves.
_HARMONIC_INTERVALS = (12, 19, 24)


def suppress_harmonics(notes: list[NoteEvent], onset_window: float = 0.06, ratio: float = 0.8) -> list[NoteEvent]:
    """Drop notes that are probably a harmonic of a stronger, simultaneous note.

    A plucked string sounds its octave and fifth above, which the model sometimes reports as a quieter note that starts
    with the fundamental. A note goes when a note 12, 19 or 24 semitones below it starts within ``onset_window``
    seconds and is at least ``ratio`` times as loud.
    """
    kept: list[NoteEvent] = []
    for note in notes:
        harmonic = any(
            other.pitch == note.pitch - interval
            and abs(other.start_sec - note.start_sec) <= onset_window
            and other.amplitude >= note.amplitude * ratio
            for other in notes
            for interval in _HARMONIC_INTERVALS
        )
        if not harmonic:
            kept.append(note)
    return kept


def predict_notes(
    samples: NDArray[np.float64],
    *,
    onset_thresh: float = DEFAULT_ONSET_THRESH,
    frame_thresh: float = DEFAULT_FRAME_THRESH,
    min_note_len: int = DEFAULT_MIN_NOTE_LEN,
    min_pitch: int = LOW_PITCH,
    max_pitch: int = HIGH_PITCH,
) -> list[NoteEvent]:
    """Transcribe audio samples into polyphonic note events using basic-pitch ONNX."""
    session = _get_session()
    audio = samples.astype(np.float32)
    original_length = len(audio)

    overlap_len = N_OVERLAPPING_FRAMES * FFT_HOP
    hop_size = AUDIO_N_SAMPLES - overlap_len
    pad_front = int(overlap_len / 2)
    audio_padded = np.concatenate([np.zeros(pad_front, dtype=np.float32), audio])

    windows: list[NDArray[np.float32]] = []
    for i in range(0, len(audio_padded), hop_size):
        chunk = audio_padded[i : i + AUDIO_N_SAMPLES]
        if len(chunk) < AUDIO_N_SAMPLES:
            chunk = np.pad(chunk, (0, AUDIO_N_SAMPLES - len(chunk)))
        windows.append(chunk[:, None])

    if not windows:
        return []

    batch = np.stack(windows, axis=0)
    outs = session.run(
        ["StatefulPartitionedCall:1", "StatefulPartitionedCall:2", "StatefulPartitionedCall:0"],
        {"serving_default_input_2:0": batch},
    )
    frames = _unwrap_output(outs[0], original_length, N_OVERLAPPING_FRAMES)
    onsets = _unwrap_output(outs[1], original_length, N_OVERLAPPING_FRAMES)

    return suppress_harmonics(
        _output_to_notes(
            frames,
            onsets,
            onset_thresh=onset_thresh,
            frame_thresh=frame_thresh,
            min_note_len=min_note_len,
            min_pitch=min_pitch,
            max_pitch=max_pitch,
        )
    )


def _time_to_tick(time_sec: float, beats: NDArray[np.float64], period: float) -> int:
    """Map a timestamp in seconds to standard score ticks (960 ticks per quarter note)."""
    if len(beats) < 2:
        return max(0, round(time_sec * (TICKS_PER_QUARTER / max(period, 0.1))))
    if time_sec <= beats[0]:
        quarters = (time_sec - beats[0]) / period
        return max(0, round(quarters * TICKS_PER_QUARTER))
    if time_sec >= beats[-1]:
        quarters = (len(beats) - 1) + (time_sec - beats[-1]) / period
        return round(quarters * TICKS_PER_QUARTER)
    idx = bisect_right(beats, time_sec) - 1
    fraction = (time_sec - beats[idx]) / max(beats[idx + 1] - beats[idx], 1e-6)
    quarters = idx + fraction
    return round(quarters * TICKS_PER_QUARTER)


# Transcriber: (source_path, stem, preset, grid, progress) -> (ScoreDocument, notices)
Transcriber = Callable[[Path, str, str | None, int, Callable[[str, str], None]], tuple[ScoreDocument, list[Notice]]]


def transcribe(
    audio_path: Path,
    stem: str = "mix",
    preset: str | None = None,
    grid: int = DEFAULT_GRID,
    progress: Callable[[str, str], None] | None = None,
) -> tuple[ScoreDocument, list[Notice]]:
    """Transcribe an audio file into a ScoreDocument with fingered frets and beat-grid sync marks."""
    if grid not in GRIDS:
        raise TranscriptionError(f"grid must be one of {GRIDS}", "transcribe.badGrid", grid=grid)

    def report(msg: str, key: str = "") -> None:
        if progress:
            progress(msg, key)

    work_path = audio_path
    cleanup_stem = False
    stem_clean_dir: Path | None = None

    if stem in ("bass", "guitar"):
        if not stem_engine.available():
            raise TranscriptionError("Demucs stem separation is not available", "transcribe.stemsUnavailable")
        report(f"Isolating {stem} stem", "transcribe.stemSeparation")
        stem_dir = stem_engine.scratch_dir()
        stem_clean_dir = stem_dir
        try:
            found = stem_engine.separate(audio_path, stem_engine.DEFAULT_MODEL, stem_dir, report)
            if stem in found and found[stem].is_file():
                work_path = found[stem]
                cleanup_stem = True
        except Exception as exc:
            import shutil

            shutil.rmtree(stem_dir, ignore_errors=True)
            raise TranscriptionError(f"stem separation failed: {exc}", "transcribe.stemFailed") from exc

    try:
        report("Decoding audio", "transcribe.decoding")
        samples = beat_tracking.decode(work_path, sample_rate=SAMPLE_RATE)
        if samples.size < SAMPLE_RATE * 0.5:
            raise TranscriptionError("the audio is too short to transcribe", "transcribe.tooShort")

        report("Transcribing notes", "transcribe.modelInference")
        note_events = predict_notes(samples)
        if not note_events:
            raise TranscriptionError("no notes were detected in this audio", "transcribe.noNotes")

        report("Tracking beats and tempo", "transcribe.beatTracking")
        envelope = beat_tracking.onset_envelope(samples, SAMPLE_RATE)
        beat_res = beat_tracking.beat_grid(envelope)
        beats = beat_res.beats
        period = beat_res.period
        bpm = round(min(max(60.0 / period, 30.0), 360.0), 2)
        if beats.size == 0:
            beats = np.array([0.0])

        # Convert NoteEvents to tick notes
        min_tick_len = TICKS_PER_QUARTER // grid
        tick_notes: list[tuple[int, int, int]] = []
        for event in note_events:
            start_tick = _time_to_tick(event.start_sec, beats, period)
            end_tick = _time_to_tick(event.end_sec, beats, period)
            end_tick = max(end_tick, start_tick + min_tick_len)
            tick_notes.append((start_tick, end_tick, event.pitch))

        report("Fingering tab", "transcribe.fingering")
        suggested = preset
        if not suggested or not is_preset(suggested):
            pitches = [p for _, _, p in tick_notes]
            lowest = min(pitches)
            median = int(np.median(pitches))
            suggested = "bass-4" if stem == "bass" else suggest_preset(None, lowest, median)

        source = MidiSource(
            id="0:0",
            track=0,
            channel=0,
            name=f"Transcribed ({suggested})",
            program=33 if "bass" in suggested else 25,
            notes=tick_notes,
        )
        parsed = ParsedMidi(
            title="Transcribed",
            sources=[source],
            tempos=[(0, bpm)],
            signatures=[(0, 4, 4)],
        )
        options = MidiOptions(grid=grid, preset=suggested)
        document, notices, _ = build_document(parsed, options)

        # Set sync anchors from the beat grid: each bar (4 beats in 4/4) gets an anchor
        anchors: dict[str, float] = {}
        for b_idx in range(len(document.bars)):
            beat_idx = b_idx * 4
            if beat_idx < len(beats):
                bar_sec = float(beats[beat_idx])
            else:
                bar_sec = float(beats[-1] + (beat_idx - (len(beats) - 1)) * period)
            anchors[str(b_idx)] = round(bar_sec, 3)

        document.sync.anchors = anchors
        document.sync.keyed_by = "played"
        report("Transcription complete", "transcribe.complete")
        return document, notices

    finally:
        if cleanup_stem and stem_clean_dir:
            import shutil

            shutil.rmtree(stem_clean_dir, ignore_errors=True)


def note_f_measure(
    reference: list[tuple[float, float, int]],
    estimated: list[tuple[float, float, int]],
    *,
    onset_tolerance: float = 0.05,
) -> tuple[float, float, float]:
    """Precision, recall and F-measure of ``(start_sec, end_sec, pitch)`` notes.

    A note matches when the pitch is equal and the onset is within ``onset_tolerance`` seconds (the usual MIREX
    note-onset criterion without offsets). Each reference note matches at most one estimated note.
    """
    unmatched = list(reference)
    hits = 0
    for start, _, pitch in sorted(estimated):
        best = None
        for index, (ref_start, _, ref_pitch) in enumerate(unmatched):
            if ref_pitch == pitch and abs(ref_start - start) <= onset_tolerance:
                if best is None or abs(ref_start - start) < abs(unmatched[best][0] - start):
                    best = index
        if best is not None:
            unmatched.pop(best)
            hits += 1
    precision = hits / len(estimated) if estimated else 0.0
    recall = hits / len(reference) if reference else 0.0
    f_measure = 2 * precision * recall / (precision + recall) if hits else 0.0
    return precision, recall, f_measure
