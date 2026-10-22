"""Read ``songs/<slug>/tab-data.js`` from the original bass-tab-sync player."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fretbook.score.model import Beat, Measure, Note, ScoreDocument, SyncMap, TempoMark, Track, Voice
from fretbook.score.tuning import labels_to_midi


def parse_js_const(text: str) -> Any:
    """Parse the JSON after ``= `` in a generated ``const NAME = ...;`` file."""
    payload = text.split("= ", 1)[1].strip()
    if payload.endswith(";"):
        payload = payload[:-1]
    return json.loads(payload)


def signature_from_length(length: float) -> tuple[int, int]:
    """Best small time signature with this length in quarter notes.

    The legacy file stored only the length, so 6/8 and 3/4 (both 3 quarters)
    cannot be told apart. Prefer a denominator of 4 when it divides evenly.
    """
    for denominator in (4, 8, 2, 16, 1):
        numerator = length * denominator / 4
        if abs(numerator - round(numerator)) < 1e-6:
            whole = int(round(numerator))
            if 1 <= whole <= 32:
                return (whole, denominator)
    return (4, 4)


def legacy_document(tab: dict[str, Any], preset: dict[str, Any] | None = None) -> ScoreDocument:
    preset = preset or {}
    tuning = labels_to_midi(list(tab["strings"]))
    measures: list[Measure] = []
    for length, events in tab["measures"]:
        beats: list[Beat] = []
        for index, (position, notes) in enumerate(events):
            nxt = events[index + 1][0] if index + 1 < len(events) else float(length)
            duration = round(max(0.01, float(nxt) - float(position)), 4)
            beats.append(
                Beat(
                    position=float(position),
                    duration=duration,
                    notes=[Note(string=int(string), fret=int(fret)) for string, fret in notes],
                )
            )
        measures.append(
            Measure(signature=signature_from_length(float(length)), voices=[Voice(beats=beats)])
        )
    if not measures:
        measures.append(Measure())
    points = [float(point) for point in (preset.get("points") or [])]
    return ScoreDocument(
        bpm=float(tab.get("bpm") or 120),
        tempos=[TempoMark(bpm=float(tab.get("bpm") or 120), measure=0)],
        tracks=[
            Track(
                id="trk_legacy",
                name="Bass",
                instrument="bass-guitar",
                tuning_midi=tuning,
                preferred=True,
                measures=measures,
            )
        ],
        sync=SyncMap(video_id=preset.get("videoId"), points=points),
    )


def load_legacy_dir(folder: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    tab = parse_js_const((folder / "tab-data.js").read_text(encoding="utf-8"))
    preset_path = folder / "sync-preset.js"
    preset = parse_js_const(preset_path.read_text(encoding="utf-8")) if preset_path.is_file() else {}
    return tab, preset
