"""Instrument-agnostic score document.

This JSON document is the source of truth stored in SQLite. alphaTab renders it
in the browser; importers (Songsterr, MusicXML, Guitar Pro via alphaTab, a
future YouTube pass) write it, and ``fretbook.export.musicxml`` writes it back
out as portable MusicXML.

Conventions:

* **Bars are song-level.** ``ScoreDocument.bars`` holds the time signature,
  tempo changes, repeats, and section names once per bar, like alphaTab's and
  Guitar Pro's master bars. Every track has exactly ``len(bars)`` entries in
  ``Track.bars`` with only its notes. Sync points and tapped anchors are keyed
  by bar index, so they line up with every track.
* **Time is integer ticks**, ``TICKS_PER_QUARTER`` (960, as in alphaTab) per
  quarter note. ``Beat.position`` is measured from the start of the bar.
* **String index 0 is the highest-pitched string**, matching Songsterr, MusicXML
  ``<string>``, and the first entry of ``tuning_midi``. alphaTab's
  ``note.string`` is the opposite (1 = lowest); the frontend converts.
* ``tuning_midi`` may be any length from 1 to 16 and keeps the octave, so drop
  D, 5-string bass, and 7-string guitar need no schema change.
* Techniques are typed fields. ``extras`` keeps unknown source fields only.

"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from fretbook.score.playback import first_played, played_bars

TICKS_PER_QUARTER = 960
VERSION: Literal[1] = 1

SlideKind = Literal["shift", "legato", "in_below", "in_above", "out_down", "out_up"]
HarmonicKind = Literal["natural", "artificial", "pinch", "tap", "semi"]
GraceKind = Literal["on_beat", "before_beat", "bend"]
DirectionKind = Literal[
    "fine",
    "segno",
    "segno_segno",
    "coda",
    "double_coda",
    "da_capo",
    "da_capo_al_coda",
    "da_capo_al_double_coda",
    "da_capo_al_fine",
    "dal_segno",
    "dal_segno_al_coda",
    "dal_segno_al_double_coda",
    "dal_segno_al_fine",
    "dal_segno_segno",
    "dal_segno_segno_al_coda",
    "dal_segno_segno_al_double_coda",
    "dal_segno_segno_al_fine",
    "da_coda",
    "da_double_coda",
]


class _Model(BaseModel):
    # JSON parsers accept NaN and Infinity. Stored, they serialize to null and
    # the row stops validating, so refuse them at the door.
    model_config = ConfigDict(allow_inf_nan=False)


class Note(_Model):
    string: int = Field(ge=0)
    fret: int = Field(ge=0, le=99)
    dead: bool = False
    tie: bool = False
    """Continues the previous note on this string."""
    ghost: bool = False
    hammer: bool = False
    """Hammer-on or pull-off into the next note on this string."""
    slide: SlideKind | None = None
    vibrato: bool = False
    harmonic: HarmonicKind | None = None
    bend: float | None = Field(default=None, gt=0, le=4)
    """Bend amount in semitones."""
    palm_mute: bool = False
    let_ring: bool = False
    staccato: bool = False
    extras: dict[str, Any] = Field(default_factory=dict)


class Beat(_Model):
    position: int = Field(ge=0)
    """Ticks from the start of the bar."""
    duration: int = Field(gt=0)
    """Ticks. A tuplet's duration is already scaled (an eighth-note triplet is 320)."""
    notes: list[Note] = Field(default_factory=list)
    grace: GraceKind | None = None
    """Grace beats take no time of their own; the next beat starts at the same position."""
    tuplet: int | None = Field(default=None, ge=2, le=16)
    """Notation hint (3 for a triplet). Rendering falls back to the duration."""
    extras: dict[str, Any] = Field(default_factory=dict)

    @property
    def rest(self) -> bool:
        return not self.notes


class Voice(_Model):
    beats: list[Beat] = Field(default_factory=list)


class Bar(_Model):
    """One song-level bar (alphaTab's master bar)."""

    signature: tuple[int, int] = (4, 4)
    tempo: float | None = Field(default=None, gt=0, lt=400)
    """A tempo change at the start of this bar. Bar 0 uses ``ScoreDocument.bpm``."""
    repeat_start: bool = False
    repeat_end: int = Field(default=0, ge=0, le=32)
    """How many times the repeated section plays, on its last bar. 0 means no repeat ends here."""
    alternate_endings: list[int] = Field(default_factory=list)
    """Volta: the passes (1-based) of the repeat this bar plays on. It holds until the next bar that sets its own."""
    directions: list[DirectionKind] = Field(default_factory=list)
    """Navigation marks on this bar: targets (segno, coda, fine) and jumps (D.C., D.S., to coda)."""
    section: str | None = None
    extras: dict[str, Any] = Field(default_factory=dict)

    @property
    def length_ticks(self) -> int:
        numerator, denominator = self.signature
        return 4 * TICKS_PER_QUARTER * numerator // denominator

    @property
    def length_quarters(self) -> float:
        numerator, denominator = self.signature
        return 4 * numerator / denominator


class TrackBar(_Model):
    """One track's content for one song-level bar. No voices, or empty voices, is a full-bar rest."""

    voices: list[Voice] = Field(default_factory=lambda: [Voice()])
    extras: dict[str, Any] = Field(default_factory=dict)


class Track(_Model):
    id: str = Field(min_length=1, max_length=64)
    name: str
    instrument: str
    capo: int = Field(default=0, ge=0, le=24)
    tuning_midi: list[int] = Field(min_length=1, max_length=16)
    preferred: bool = False
    bars: list[TrackBar] = Field(min_length=1)


class SyncMap(_Model):
    """Backing-track alignment, keyed by *played* bar index.

    The played order is the written bars expanded through repeats, voltas and
    D.S./D.C. jumps (``fretbook.score.playback``); with no repeats it is the
    written order. ``points`` are source timestamps in seconds (Songsterr video
    points), one per played bar; ``None`` means the source had none for that
    bar. ``anchors`` are the user's taps, keyed by played bar index. Playback
    uses anchors when present, otherwise points.

    ``keyed_by`` says which index the keys use. Documents saved before repeats
    were rendered are ``"written"`` (the field is absent, so it defaults to
    that): validating one converts the marks to the first play of each written
    bar and sets ``"played"``. That conversion is the migration of existing
    marks; it is exact because nothing used to render repeats.
    """

    video_id: str | None = None
    points: list[float | None] = Field(default_factory=list)
    anchors: dict[str, float] = Field(default_factory=dict)
    keyed_by: Literal["written", "played"] = "written"


class ScoreDocument(_Model):
    version: Literal[1] = VERSION
    bpm: float = Field(default=120, gt=0, lt=400)
    """Opening tempo."""
    bars: list[Bar] = Field(min_length=1)
    tracks: list[Track] = Field(min_length=1)
    sync: SyncMap = Field(default_factory=SyncMap)

    @model_validator(mode="after")
    def check(self) -> ScoreDocument:
        count = len(self.bars)
        if self.bars[0].tempo is not None:
            self.bpm = self.bars[0].tempo
            self.bars[0].tempo = None
        for index, bar in enumerate(self.bars):
            numerator, denominator = bar.signature
            if not 1 <= numerator <= 32 or denominator not in {1, 2, 4, 8, 16, 32}:
                raise ValueError(f"invalid time signature {numerator}/{denominator} in bar {index + 1}")
        seen: set[str] = set()
        for track in self.tracks:
            if track.id in seen:
                raise ValueError(f"duplicate track id {track.id}")
            seen.add(track.id)
            if len(track.bars) != count:
                raise ValueError(f"track {track.name} has {len(track.bars)} bars; the song has {count}")
            strings = len(track.tuning_midi)
            for index, track_bar in enumerate(track.bars):
                for voice in track_bar.voices:
                    for beat in voice.beats:
                        for note in beat.notes:
                            if note.string >= strings:
                                raise ValueError(
                                    f"string {note.string} is outside 0..{strings - 1} on {track.name}, bar {index + 1}"
                                )
        order = played_bars(self.bars)
        if self.sync.keyed_by == "written":
            self._convert_written_marks(order)
        for key in self.sync.anchors:
            if not key.isdigit() or int(key) > len(order):
                raise ValueError(f"sync anchor {key!r} is not a bar index")
        return self

    def _convert_written_marks(self, order: list[int]) -> None:
        """Re-key sync marks from written to played bar index (see :class:`SyncMap`)."""
        count = len(self.bars)
        sync = self.sync
        first = first_played(order, count)
        anchors: dict[str, float] = {}
        for key, value in sync.anchors.items():
            if not key.isdigit() or int(key) > count:
                raise ValueError(f"sync anchor {key!r} is not a bar index")
            index = int(key)
            anchors[str(len(order) if index == count else first[index])] = value
        points: list[float | None] = []
        if sync.points:
            points = [None] * len(order)
            for written, point in enumerate(sync.points[:count]):
                if first[written] < len(order):
                    points[first[written]] = point
        sync.anchors = anchors
        sync.points = points
        sync.keyed_by = "played"


def preferred_track(document: ScoreDocument) -> Track:
    for track in document.tracks:
        if track.preferred:
            return track
    return document.tracks[0]


def tempo_at(document: ScoreDocument, bar_index: int) -> float:
    tempo = document.bpm
    for bar in document.bars[1 : bar_index + 1]:
        if bar.tempo is not None:
            tempo = bar.tempo
    return tempo


def bar_seconds(document: ScoreDocument) -> list[float]:
    """Natural length of each bar in seconds from its signature and the tempo in force."""
    lengths: list[float] = []
    tempo = document.bpm
    for index, bar in enumerate(document.bars):
        if index and bar.tempo is not None:
            tempo = bar.tempo
        lengths.append(bar.length_quarters * 60 / tempo)
    return lengths


def played_bar_seconds(document: ScoreDocument) -> list[float]:
    """Length in seconds of each *played* bar: the written bars expanded through repeats and jumps.

    The tempo in force follows the playing order, and bar 0 always restarts at the opening tempo.
    """
    lengths: list[float] = []
    tempo = document.bpm
    for index in played_bars(document.bars):
        bar = document.bars[index]
        if index == 0:
            tempo = document.bpm
        elif bar.tempo is not None:
            tempo = bar.tempo
        lengths.append(bar.length_quarters * 60 / tempo)
    return lengths


def published_points(document: ScoreDocument) -> list[float]:
    return [point for point in document.sync.points if point is not None]


def summary_fields(document: ScoreDocument) -> dict[str, Any]:
    track = preferred_track(document)
    points = published_points(document)
    return {
        "bpm": document.bpm,
        "measure_count": len(document.bars),
        "track_count": len(document.tracks),
        "string_count": len(track.tuning_midi),
        "preferred_instrument": track.instrument,
        "preferred_track_id": track.id,
        "has_sync": bool(points or document.sync.anchors),
        "duration": points[-1] if points else None,
    }


def content_hash(document: ScoreDocument) -> str:
    """Hash of the bars and tracks, to tell an edited song from an untouched import.

    Sync and the opening tempo are left out: the player adjusts both while lining up audio.
    """
    payload = json.dumps(
        {
            "bars": [bar.model_dump() for bar in document.bars],
            "tracks": [track.model_dump() for track in document.tracks],
        },
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode()).hexdigest()
