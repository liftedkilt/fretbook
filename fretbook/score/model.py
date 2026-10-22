"""Instrument-agnostic score document.

This JSON document is the source of truth stored in SQLite. alphaTab renders it
in the browser; importers (Songsterr, MusicXML, a future YouTube pass) write it.

Conventions, which issue #4 must keep:

* String index 0 is the highest-pitched string, matching Songsterr and the
  first entry of ``tuning_midi``. alphaTab's own note.string is the opposite
  (1 = lowest); the frontend converts.
* ``tuning_midi`` may be any length from 1 to 16. MIDI note numbers keep the
  octave, so drop D, 5-string bass, and 7-string guitar need no schema change.
* A song has one or more tracks. Sync points are song-level because a backing
  track is shared. Measure timing is in quarter notes.
* Unknown source fields are kept on ``extras`` so a later importer or the PDF
  exporter (issue #3) can use them without a migration.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, model_validator


class Note(BaseModel):
    string: int = Field(ge=0)
    fret: int = Field(ge=0, le=99)
    dead: bool = False
    tie: bool = False
    extras: dict[str, Any] = Field(default_factory=dict)


class Beat(BaseModel):
    """One rhythmic position in a voice. ``duration`` is in quarter notes."""

    position: float = Field(ge=0)
    duration: float = Field(gt=0)
    notes: list[Note] = Field(default_factory=list)
    rest: bool = False
    extras: dict[str, Any] = Field(default_factory=dict)


class Voice(BaseModel):
    beats: list[Beat] = Field(default_factory=list)


class Measure(BaseModel):
    """Time signature ``[numerator, denominator]``. Length in quarters is derived."""

    signature: tuple[int, int] = (4, 4)
    voices: list[Voice] = Field(default_factory=lambda: [Voice()])
    extras: dict[str, Any] = Field(default_factory=dict)

    @property
    def length_quarters(self) -> float:
        numerator, denominator = self.signature
        return 4 * numerator / denominator


class Track(BaseModel):
    id: str
    name: str
    instrument: str
    capo: int = Field(default=0, ge=0, le=24)
    tuning_midi: list[int] = Field(min_length=1, max_length=16)
    preferred: bool = False
    measures: list[Measure] = Field(min_length=1)


class TempoMark(BaseModel):
    bpm: float = Field(gt=0, lt=400)
    measure: int = Field(default=0, ge=0)


class SyncMap(BaseModel):
    """Backing-track alignment.

    ``points`` are the source timestamps (Songsterr video points), one per
    measure, in seconds. ``anchors`` are the user's taps, keyed by measure
    index. Playback uses anchors when present, otherwise points.
    """

    video_id: str | None = None
    points: list[float] = Field(default_factory=list)
    anchors: dict[str, float] = Field(default_factory=dict)


class ScoreDocument(BaseModel):
    version: int = 1
    bpm: float = Field(default=120, gt=0, lt=400)
    tempos: list[TempoMark] = Field(default_factory=list)
    tracks: list[Track] = Field(min_length=1)
    sync: SyncMap = Field(default_factory=SyncMap)

    @model_validator(mode="after")
    def check_notes_fit_strings(self) -> ScoreDocument:
        for track in self.tracks:
            count = len(track.tuning_midi)
            for measure_index, measure in enumerate(track.measures):
                numerator, denominator = measure.signature
                if numerator < 1 or denominator < 1:
                    raise ValueError(f"invalid time signature in measure {measure_index + 1}")
                for voice in measure.voices:
                    for beat in voice.beats:
                        for note in beat.notes:
                            if note.string >= count:
                                raise ValueError(
                                    f"string {note.string} is outside 0..{count - 1} "
                                    f"on {track.name}, measure {measure_index + 1}"
                                )
        return self


def preferred_track(document: ScoreDocument) -> Track:
    for track in document.tracks:
        if track.preferred:
            return track
    return document.tracks[0]


def summary_fields(document: ScoreDocument) -> dict[str, Any]:
    track = preferred_track(document)
    points = document.sync.points
    anchors = document.sync.anchors
    return {
        "bpm": document.bpm,
        "measure_count": len(track.measures),
        "track_count": len(document.tracks),
        "string_count": len(track.tuning_midi),
        "preferred_instrument": track.instrument,
        "has_sync": bool(points or anchors),
        "duration": points[-1] if points else None,
    }
