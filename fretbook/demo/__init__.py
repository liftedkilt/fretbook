"""The bundled demo library and the public demo instance.

Three original songs (CC0, written for Fretbook) let a new install show a tab, a chord sheet and a tab with
audio and sync with one click. Their rows carry ``source_kind="demo"``, so they can be added once and removed
again without touching anything the user made. ``FRETBOOK_DEMO_MODE`` makes the instance read-only and resets it
every night (see :class:`DemoResetter`).
"""

from __future__ import annotations

import logging
import math
import struct
import threading
import uuid
import wave
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fretbook.context import AppContext
from fretbook.score.instruments import get_preset
from fretbook.score.model import (
    TICKS_PER_QUARTER,
    Bar,
    Beat,
    Note,
    ScoreDocument,
    SyncMap,
    Track,
    TrackBar,
    Voice,
)

logger = logging.getLogger("fretbook")

DEMO_KIND = "demo"
DEMO_DIR = Path(__file__).resolve().parent
RESET_HOUR_UTC = 3

# (string, fret) per beat: a quarter note each. String 0 is the highest-pitched.
_Line = list[list[tuple[int, int]]]


@dataclass(frozen=True)
class DemoSong:
    id: str
    title: str
    artist: str
    kind: str  # "bass", "guitar" or "chords"
    audio: bool = False


SONGS: tuple[DemoSong, ...] = (
    DemoSong("walking-home", "Walking Home", "Fretbook Demo", "bass", audio=True),
    DemoSong("open-string-riff", "Open String Riff", "Fretbook Demo", "guitar"),
    DemoSong("porch-light", "Porch Light", "Fretbook Demo", "chords"),
)

# Four bars of 4/4 at 120 bpm (two seconds a bar): a walking bass line on the A and D strings.
_WALKING_HOME: _Line = [
    [(2, 3), (2, 3), (2, 5), (1, 2)],
    [(1, 5), (1, 3), (1, 2), (2, 3)],
    [(2, 1), (2, 1), (1, 0), (1, 2)],
    [(1, 3), (1, 2), (1, 0), (2, 3)],
]
# Four bars of 4/4 at 90 bpm: an Em feel around the open strings.
_OPEN_STRING_RIFF: _Line = [
    [(5, 0), (4, 2), (3, 2), (2, 0)],
    [(5, 0), (3, 2), (4, 2), (5, 0)],
    [(4, 0), (3, 2), (2, 0), (1, 0)],
    [(5, 0), (4, 2), (3, 2), (5, 0)],
]


def _document(line: _Line, *, preset_id: str, bpm: float, sync: bool = False) -> ScoreDocument:
    preset = get_preset(preset_id)
    bars = [Bar() for _ in line]
    track_bars = [
        TrackBar(
            voices=[
                Voice(
                    beats=[
                        Beat(
                            position=index * TICKS_PER_QUARTER,
                            duration=TICKS_PER_QUARTER,
                            notes=[Note(string=s, fret=f)],
                        )
                        for index, (s, f) in enumerate(bar)
                    ]
                )
            ]
        )
        for bar in line
    ]
    seconds_per_bar = 4 * 60 / bpm
    return ScoreDocument(
        bpm=bpm,
        bars=bars,
        tracks=[
            Track(
                id="trk_demo",
                name=preset.name,
                instrument=preset.instrument,
                tuning_midi=list(preset.tuning_midi),
                preferred=True,
                bars=track_bars,
            )
        ],
        sync=SyncMap(points=[index * seconds_per_bar for index in range(len(line))]) if sync else SyncMap(),
    )


def build_document(song: DemoSong) -> ScoreDocument | None:
    if song.id == "walking-home":
        return _document(_WALKING_HOME, preset_id="bass-4", bpm=120, sync=True)
    if song.id == "open-string-riff":
        return _document(_OPEN_STRING_RIFF, preset_id="guitar-6", bpm=90)
    return None


def build_chordpro(song: DemoSong) -> str | None:
    if song.kind != "chords":
        return None
    return (DEMO_DIR / f"{song.id}.cho").read_text(encoding="utf-8")


def render_audio(document: ScoreDocument, dest: Path, *, sample_rate: int = 8000) -> None:
    """Write a quiet sine tone for every note of the preferred track, as a mono 16-bit WAV."""
    track = document.tracks[0]
    seconds_per_beat = 60 / document.bpm
    samples: list[int] = []
    for track_bar in track.bars:
        for beat in track_bar.voices[0].beats:
            midi = track.tuning_midi[beat.notes[0].string] + beat.notes[0].fret
            freq = 440 * 2 ** ((midi - 69) / 12)
            count = int(sample_rate * seconds_per_beat * beat.duration / TICKS_PER_QUARTER)
            for n in range(count):
                envelope = min(1.0, n / 80) * max(0.0, 1 - n / count) ** 0.5
                samples.append(int(9000 * envelope * math.sin(2 * math.pi * freq * n / sample_rate)))
    with wave.open(str(dest), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(b"".join(struct.pack("<h", value) for value in samples))


def _find(ctx: AppContext, owner: str, song: DemoSong) -> dict | None:
    return ctx.songs.find_by_source(owner, DEMO_KIND, demo=song.id)


def status(ctx: AppContext, owner: str) -> list[dict]:
    return [
        {
            "id": song.id,
            "title": song.title,
            "artist": song.artist,
            "kind": song.kind,
            "has_audio": song.audio,
            "song_id": (found["id"] if (found := _find(ctx, owner, song)) else None),
        }
        for song in SONGS
    ]


def install(ctx: AppContext, owner: str) -> int:
    """Add the demo songs the owner does not have yet. Returns how many were added."""
    added = 0
    for song in SONGS:
        if _find(ctx, owner, song):
            continue
        document = build_document(song)
        created = ctx.songs.create_song(
            owner,
            title=song.title,
            artist=song.artist,
            document=document,
            chordpro=build_chordpro(song),
            source_kind=DEMO_KIND,
            source_ref={"demo": song.id},
            slug=song.id,
        )
        if song.audio and document is not None:
            staging = ctx.settings.inbox_dir / f"demo-{uuid.uuid4().hex}.wav"
            staging.parent.mkdir(parents=True, exist_ok=True)
            render_audio(document, staging)
            ctx.media.save_file(
                owner,
                created["id"],
                kind="audio",
                filename=f"{song.id}.wav",
                content_type="audio/wav",
                source=staging,
            )
        added += 1
    return added


def remove(ctx: AppContext, owner: str) -> int:
    """Delete the owner's demo songs and their files. Songs the owner made or imported are left alone."""
    removed = 0
    for song in SONGS:
        found = _find(ctx, owner, song)
        if found:
            ctx.media.delete_song_files(owner, found["id"])
            ctx.songs.delete_song(owner, found["id"])
            removed += 1
    return removed


def reset(ctx: AppContext) -> None:
    """Return a demo instance to a fresh install: the demo songs, no practice or lesson progress, no settings."""
    owner = "local"
    page = ctx.songs.list_songs(owner, limit=200)
    while page["items"]:
        for item in page["items"]:
            ctx.media.delete_song_files(owner, item["id"])
            ctx.songs.delete_song(owner, item["id"])
        page = ctx.songs.list_songs(owner, limit=200)
    ctx.songs.reset_user_data(owner)
    install(ctx, owner)


def seconds_until_reset(now: datetime | None = None) -> float:
    now = now or datetime.now(UTC)
    target = now.replace(hour=RESET_HOUR_UTC, minute=0, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


class DemoResetter:
    """Resets a demo instance when the server starts and every night at 03:00 UTC, in a background thread."""

    def __init__(self, ctx: AppContext) -> None:
        self.ctx = ctx
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if not self.ctx.settings.demo_mode or self._thread is not None:
            return
        self._run_once()
        self._thread = threading.Thread(target=self._run, name="demo-reset", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _run_once(self) -> None:
        try:
            reset(self.ctx)
        except Exception:  # noqa: BLE001 - the loop must survive any failure
            logger.exception("demo reset failed")

    def _run(self) -> None:
        while not self._stop.wait(seconds_until_reset()):
            self._run_once()
