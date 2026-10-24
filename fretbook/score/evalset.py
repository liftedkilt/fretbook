"""The hand-checked real recordings that auto-sync is evaluated on (``tests/fixtures/autosync/recordings``).

A recording is listed in ``manifest.json`` with the score it was played from, where its bars really start
(checked by ear against the waveform) and the source and licence of the audio. ``scripts/autosync_eval.py``
runs ``propose`` on each and prints the error beside the synthetic rows.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from fretbook.audio.beats import decode
from fretbook.score.autosync import propose
from fretbook.score.model import ScoreDocument

LICENCES = frozenset({"CC0-1.0", "CC-BY-4.0", "CC-BY-SA-4.0", "public-domain", "original"})
"""``original`` is a take made for this repository and released under CC0."""
MAX_BYTES = 3_000_000
"""Recordings stay small: a short excerpt, not a whole song."""


class EvalSetError(ValueError):
    """The manifest or one of its recordings is not usable."""


class RecordingEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]*$")
    audio: str
    score: str
    """Path (relative to the manifest) of a Fretbook JSON score: a bare document or a tab export."""
    title: str
    source: str
    """Where the audio came from: a URL, or who played it and how."""
    licence: str
    checked_by: str
    """Who checked the bar marks against the audio, and how (for example "by ear, with a click overlay")."""
    bar_starts: list[float]
    """Seconds in the audio at which each played bar starts, from ``start_bar`` on, plus the end of the last bar."""
    start_bar: int = 0
    start_seconds: float | None = None
    """Tell ``propose`` where the music starts, as a listener would. Leave out to test it unaided."""
    notes: str = ""

    @model_validator(mode="after")
    def _check(self) -> RecordingEntry:
        if self.licence not in LICENCES:
            raise ValueError(f"licence must be one of {sorted(LICENCES)}, not {self.licence!r}")
        if len(self.bar_starts) < 3:
            raise ValueError("bar_starts needs at least two bars and the end of the last")
        if any(b <= a for a, b in zip(self.bar_starts, self.bar_starts[1:], strict=False)):
            raise ValueError("bar_starts must increase")
        if self.bar_starts[0] < 0 or self.start_bar < 0:
            raise ValueError("bar_starts and start_bar cannot be negative")
        return self


@dataclass
class Recording:
    entry: RecordingEntry
    audio: Path
    document: ScoreDocument


def load_score(path: Path) -> ScoreDocument:
    data = json.loads(path.read_text(encoding="utf-8"))
    return ScoreDocument.model_validate(data["document"] if "document" in data else data)


def load_manifest(directory: Path) -> list[Recording]:
    """Read and validate ``directory/manifest.json``; an absent manifest is an empty set."""
    manifest = directory / "manifest.json"
    if not manifest.exists():
        return []
    try:
        entries = [RecordingEntry.model_validate(item) for item in json.loads(manifest.read_text())["recordings"]]
    except (ValidationError, KeyError, TypeError, json.JSONDecodeError) as error:
        raise EvalSetError(f"{manifest}: {error}") from error
    ids = [entry.id for entry in entries]
    if len(set(ids)) != len(ids):
        raise EvalSetError(f"{manifest}: duplicate id")
    out = []
    for entry in entries:
        audio, score = directory / entry.audio, directory / entry.score
        if not audio.is_file() or not score.is_file():
            raise EvalSetError(f"{entry.id}: {entry.audio} or {entry.score} is missing")
        if audio.stat().st_size > MAX_BYTES:
            raise EvalSetError(f"{entry.id}: {entry.audio} is over {MAX_BYTES} bytes; use a shorter excerpt")
        document = load_score(score)
        if entry.start_bar + len(entry.bar_starts) - 1 > len(document.bars) and not _repeats(document):
            raise EvalSetError(f"{entry.id}: more marked bars than the score has")
        out.append(Recording(entry, audio, document))
    return out


def _repeats(document: ScoreDocument) -> bool:
    return any(bar.repeat_start or bar.repeat_end for bar in document.bars)


def evaluate_recording(recording: Recording, tracker: str = "auto") -> dict[str, float | str]:
    """Error of ``propose`` against the hand-checked bar starts, in the shape ``autosync_eval`` prints."""
    entry = recording.entry
    samples = decode(recording.audio)
    proposal = propose(
        recording.document,
        samples,
        start_bar=entry.start_bar,
        start_seconds=entry.start_seconds,
        tracker=tracker,
    )
    errors = np.array(
        [
            abs(proposal.anchors[str(entry.start_bar + i)] - t) * 1000
            for i, t in enumerate(entry.bar_starts)
            if str(entry.start_bar + i) in proposal.anchors
        ]
    )
    if errors.size == 0:
        raise EvalSetError(f"{entry.id}: no bar was marked")
    return {
        "name": f"real: {entry.title}",
        "bars": f"{errors.size}/{len(entry.bar_starts)}",
        "median": float(np.median(errors)),
        "p95": float(np.percentile(errors, 95)),
        "max": float(errors.max()),
        "within50": float(np.mean(errors <= 50) * 100),
        "confidence": proposal.overall,
    }
