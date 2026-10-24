"""Restore a library archive into the caller's library, as a background job.

The archive is untrusted. Nothing is extracted by name: only members the
manifest lists are read, each into a fresh temporary file, and media is stored
through :class:`MediaStore`, which picks its own paths. Entry counts, declared
and actual sizes, and compression ratios are limited before and while reading.
"""

from __future__ import annotations

import json
import logging
import re
import sqlite3
import uuid
import zipfile
from pathlib import Path
from typing import IO, Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from fretbook.backup.archive import FORMAT, FORMAT_VERSION, MANIFEST
from fretbook.chords import chordpro
from fretbook.config import Settings
from fretbook.importers.base import Notice
from fretbook.jobs.runner import JobRunner, Progress
from fretbook.score.model import ScoreDocument
from fretbook.storage.lessons import LessonProgressRepository
from fretbook.storage.media import AUDIO_TYPES, MediaStore
from fretbook.storage.practice import (
    MAX_DAILY_MINUTES,
    MAX_SECONDS,
    ExerciseInput,
    PracticeRepository,
    SessionInput,
)
from fretbook.storage.repository import SongRepository
from fretbook.storage.setlists import (
    MAX_ENTRIES as MAX_SETLIST_ENTRIES,
)
from fretbook.storage.setlists import (
    EntryInput,
    SetlistRepository,
    TooManyEntries,
    UnknownSongs,
)

logger = logging.getLogger(__name__)

JOB_KIND = "library.import"
MAX_ENTRIES = 200_000
MAX_JSON_BYTES = 64 * 1024 * 1024
# Deflate cannot beat roughly 1000:1, so anything above this on a big member is a bomb, not a library.
MAX_RATIO = 200
RATIO_FLOOR = 8 * 1024 * 1024
_CHUNK = 1024 * 1024
_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
_KINDS = {"audio", "import"}

Mode = Literal["skip", "copy"]


class BackupError(Exception):
    """A refused archive. ``key`` is an ``errors`` catalog key."""

    def __init__(self, key: str, message: str, **params: Any) -> None:
        super().__init__(message)
        self.key = key
        self.params = params


class _Media(BaseModel):
    model_config = ConfigDict(extra="ignore")

    kind: str = Field(max_length=64)
    filename: str = Field(max_length=300)
    path: str = Field(max_length=500)


class _Song(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    title: str = Field(max_length=300)
    artist: str = Field(default="", max_length=300)
    content_kind: Literal["tab", "chords"]
    source_kind: str = Field(default="file", max_length=64)
    source_ref: dict[str, Any] = Field(default_factory=dict)
    file: str = Field(max_length=500)
    media: list[_Media] = Field(default_factory=list)
    # Untrusted like the rest: the repository cleans, dedupes and caps tags before storing them.
    tags: list[Annotated[str, Field(max_length=200)]] = Field(default_factory=list, max_length=1000)
    favourite: bool = False


class _SetlistEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")

    song_id: str = Field(max_length=64)
    note: str = Field(default="", max_length=2000)
    transpose: int = 0


class _Setlist(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    name: str = Field(max_length=300)
    entries: list[_SetlistEntry] = Field(default_factory=list, max_length=100_000)


class _PracticeSession(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    song_id: str = Field(max_length=64)
    day: str = Field(min_length=10, max_length=10)
    duration_seconds: int = Field(ge=1, le=MAX_SECONDS)
    track_id: str = Field(default="", max_length=64)
    loop_name: str = Field(default="", max_length=200)
    loop_start: int | None = Field(default=None, ge=0, le=100_000)
    loop_end: int | None = Field(default=None, ge=0, le=100_000)
    started_at: str | None = Field(default=None, max_length=40)
    speed: float = Field(default=1.0, gt=0, le=4, allow_inf_nan=False)
    mode: Literal["free", "wait", "scored"] = "free"
    score: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)


class _PracticeExercise(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    kind: Literal["fretboard", "interval", "chord"]
    day: str = Field(min_length=10, max_length=10)
    duration_seconds: int = Field(ge=1, le=MAX_SECONDS)
    rounds: int = Field(default=0, ge=0, le=1_000_000)
    correct: int = Field(default=0, ge=0, le=1_000_000)
    score: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    started_at: str | None = Field(default=None, max_length=40)


class _PracticeGoal(BaseModel):
    model_config = ConfigDict(extra="ignore")

    daily_minutes: int = Field(ge=0, le=MAX_DAILY_MINUTES)
    weekly_summary: bool = True


class _Practice(BaseModel):
    model_config = ConfigDict(extra="ignore")

    sessions: list[Any] = Field(default_factory=list, max_length=1_000_000)
    """Validated one by one on restore, so one bad session does not refuse the whole archive."""
    exercises: list[Any] = Field(default_factory=list, max_length=1_000_000)
    """Trainer games, validated one by one like sessions. Archives from before they were saved have none."""
    goal: _PracticeGoal | None = None


_LESSON_ID = r"^[a-z0-9][a-z0-9-]{0,63}$"


class _LessonProgress(BaseModel):
    model_config = ConfigDict(extra="ignore")

    course_id: str = Field(pattern=_LESSON_ID)
    lesson_id: str = Field(pattern=_LESSON_ID)
    first_opened_at: str = Field(max_length=40)
    last_opened_at: str = Field(max_length=40)
    completed_at: str | None = Field(default=None, max_length=40)
    attempts: int = Field(default=0, ge=0, le=1_000_000)
    best_score: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    best_bpm: float | None = Field(default=None, gt=0, le=1000, allow_inf_nan=False)


class _Lessons(BaseModel):
    model_config = ConfigDict(extra="ignore")

    progress: list[Any] = Field(default_factory=list, max_length=100_000)
    """Validated one by one on restore, like practice sessions."""


class Manifest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    format: str
    format_version: int
    songs: list[_Song]
    setlists: list[_Setlist] = Field(default_factory=list, max_length=100_000)
    practice: _Practice = Field(default_factory=_Practice)
    lessons: _Lessons = Field(default_factory=_Lessons)


def _unsafe(name: str) -> bool:
    parts = name.split("/")
    return (
        not name
        or name.startswith("/")
        or "\\" in name
        or ":" in name
        or any(ord(char) < 32 for char in name)
        or any(part in {"", ".", ".."} for part in (parts[:-1] if name.endswith("/") else parts))
    )


def inspect_archive(path: Path, settings: Settings) -> Manifest:
    """Check a zip's structure and limits and return its manifest, or raise :class:`BackupError`."""
    try:
        archive = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError) as exc:
        raise BackupError("backup.notArchive", "this is not a Fretbook library archive") from exc
    with archive:
        infos = archive.infolist()
        if len(infos) > MAX_ENTRIES:
            raise BackupError("backup.tooManyFiles", "the archive has too many files", limit=MAX_ENTRIES)
        total = 0
        for info in infos:
            if _unsafe(info.filename):
                raise BackupError("backup.unsafePath", "the archive contains an unsafe file name")
            if info.flag_bits & 0x1:
                raise BackupError("backup.encrypted", "encrypted archives are not supported")
            total += info.file_size
            if info.file_size > RATIO_FLOOR and info.file_size > MAX_RATIO * max(info.compress_size, 1):
                raise BackupError("backup.suspicious", "the archive looks like a zip bomb")
        if total > settings.max_restore_unpacked_bytes:
            raise BackupError(
                "backup.tooLarge", "the archive is too large when unpacked", limit=settings.max_restore_unpacked_bytes
            )
        try:
            info = archive.getinfo(MANIFEST)
        except KeyError as exc:
            raise BackupError("backup.noManifest", "this archive has no manifest.json") from exc
        if info.file_size > MAX_JSON_BYTES:
            raise BackupError("backup.suspicious", "the manifest is too large")
        try:
            manifest = Manifest.model_validate(json.loads(_read_member(archive, info.filename, MAX_JSON_BYTES)))
        except (ValueError, ValidationError) as exc:
            raise BackupError("backup.badManifest", "manifest.json is not valid") from exc
        if manifest.format != FORMAT:
            raise BackupError("backup.notArchive", "this is not a Fretbook library archive")
        if manifest.format_version > FORMAT_VERSION:
            raise BackupError(
                "backup.newerFormat", "this archive was made by a newer Fretbook", version=manifest.format_version
            )
        if any(not _ID.fullmatch(setlist.id) for setlist in manifest.setlists):
            raise BackupError("backup.badManifest", "manifest.json is not valid")
        for song in manifest.songs:
            if not _ID.fullmatch(song.id) or _unsafe(song.file):
                raise BackupError("backup.badManifest", "manifest.json is not valid")
            if any(_unsafe(item.path) for item in song.media):
                raise BackupError("backup.unsafePath", "the archive contains an unsafe file name")
        return manifest


def _read_member(archive: zipfile.ZipFile, name: str, limit: int) -> bytes:
    with archive.open(name) as source:
        data = source.read(limit + 1)
    if len(data) > limit:
        raise BackupError("backup.suspicious", "a file in the archive is larger than it says")
    return data


def _copy_limited(source: IO[bytes], dest: Path, limit: int) -> None:
    size = 0
    with dest.open("wb") as out:
        while chunk := source.read(_CHUNK):
            size += len(chunk)
            if size > limit:
                raise BackupError("backup.suspicious", "a file in the archive is larger than it says")
            out.write(chunk)


def restore_archive(
    settings: Settings,
    songs: SongRepository,
    media: MediaStore,
    owner_id: str,
    path: Path,
    mode: Mode,
    progress: Progress,
) -> dict[str, Any]:
    manifest = inspect_archive(path, settings)
    counts = {"imported": 0, "skipped": 0, "copied": 0, "failed": 0}
    # Archive song id -> id in this library, for setlists. A song kept as a copy may get a new id.
    song_ids: dict[str, str] = {}
    warnings: list[Notice] = []
    total = len(manifest.songs)
    progress(f"Restoring {total} songs", "backup.restoring")
    with zipfile.ZipFile(path) as archive:
        for entry in manifest.songs:
            outcome: Literal["imported", "skipped", "copied", "failed"]
            try:
                outcome = _restore_song(settings, songs, media, owner_id, archive, entry, mode, warnings, song_ids)
            except (
                BackupError,
                ValueError,
                ValidationError,
                KeyError,
                OSError,
                sqlite3.Error,
                zipfile.BadZipFile,
            ) as exc:
                logger.warning("could not restore %s: %s", entry.id, exc)
                warnings.append(Notice("backup.songFailed", f"could not restore {entry.title}", {"title": entry.title}))
                outcome = "failed"
            counts[outcome] += 1
    setlists = _restore_setlists(SetlistRepository(settings), owner_id, manifest.setlists, song_ids, mode, warnings)
    sessions, exercises = _restore_practice(
        PracticeRepository(settings), owner_id, manifest.practice, song_ids, warnings
    )
    lesson_progress = _restore_lesson_progress(LessonProgressRepository(settings), owner_id, manifest.lessons, warnings)
    progress("Ready", "import.ready")
    return {
        **counts,
        "lesson_progress": lesson_progress,
        "setlists": setlists,
        "practice_sessions": sessions,
        "practice_exercises": exercises,
        "warnings": [warning.as_dict() for warning in warnings],
    }


def _restore_lesson_progress(
    repo: LessonProgressRepository, owner_id: str, lessons: _Lessons, warnings: list[Notice]
) -> int:
    """Put back lesson progress; rows the user already has are left alone, so restoring twice adds nothing."""
    added = dropped = 0
    for raw in lessons.progress:
        try:
            added += repo.restore(owner_id, _LessonProgress.model_validate(raw).model_dump())
        except (ValueError, ValidationError, TypeError, sqlite3.Error):
            dropped += 1
    if dropped:
        warnings.append(
            Notice(
                "backup.lessonProgressDropped",
                f"{dropped} lesson results could not be put back",
                {"count": dropped},
            )
        )
    return added


def _restore_practice(
    repo: PracticeRepository,
    owner_id: str,
    practice: _Practice,
    song_ids: dict[str, str],
    warnings: list[Notice],
) -> tuple[int, int]:
    """Put back the practice log, pointing sessions at the songs as they now are.

    Returns how many sessions and trainer games were added. One whose id is already in the library is left alone,
    so restoring the same archive twice adds nothing.
    """
    added = dropped = exercises = lost = 0
    for raw in practice.sessions:
        try:
            item = _PracticeSession.model_validate(raw)
            song_id = song_ids.get(item.song_id)
            if song_id is None:
                dropped += 1
                continue
            fields = item.model_dump()
            fields["song_id"] = song_id
            added += repo.restore_session(owner_id, SessionInput(**fields))
        except (ValueError, ValidationError, TypeError, sqlite3.Error):
            dropped += 1
    for raw in practice.exercises:
        try:
            game = _PracticeExercise.model_validate(raw)
            exercises += repo.restore_exercise(owner_id, ExerciseInput(**game.model_dump()))
        except (ValueError, ValidationError, TypeError, sqlite3.Error):
            lost += 1
    if practice.goal:
        try:
            repo.restore_goal(owner_id, practice.goal.daily_minutes, practice.goal.weekly_summary)
        except sqlite3.Error:
            warnings.append(Notice("backup.practiceGoalFailed", "could not restore the daily practice goal"))
    if dropped:
        warnings.append(
            Notice(
                "backup.practiceDropped",
                f"{dropped} practice sessions could not be put back",
                {"count": dropped},
            )
        )
    if lost:
        warnings.append(
            Notice(
                "backup.exercisesDropped",
                f"{lost} trainer games could not be put back",
                {"count": lost},
            )
        )
    return added, exercises


def _restore_setlists(
    repo: SetlistRepository,
    owner_id: str,
    setlists: list[_Setlist],
    song_ids: dict[str, str],
    mode: Mode,
    warnings: list[Notice],
) -> int:
    """Recreate the archive's setlists, pointing entries at the songs as they now are. Returns how many were added."""
    added = 0
    for setlist in setlists:
        name = setlist.name.strip() or "Untitled"
        try:
            mine = repo.get_setlist(owner_id, setlist.id) is not None
            if mine and mode == "skip":
                continue
            entries = [
                EntryInput(song_ids[item.song_id], item.note, item.transpose)
                for item in setlist.entries
                if item.song_id in song_ids
            ]
            dropped = len(setlist.entries) - len(entries)
            if dropped:
                warnings.append(
                    Notice(
                        "backup.setlistEntriesDropped",
                        f"{dropped} songs of {name} could not be put back in the setlist",
                        {"name": name, "count": dropped},
                    )
                )
            repo.create_setlist(
                owner_id,
                name,
                entries[:MAX_SETLIST_ENTRIES],
                setlist_id=None if repo.id_taken(setlist.id) else setlist.id,
            )
            added += 1
        except (ValueError, KeyError, OSError, sqlite3.Error, ValidationError, UnknownSongs, TooManyEntries):
            warnings.append(Notice("backup.setlistFailed", f"could not restore the setlist {name}", {"name": name}))
    return added


def _restore_song(
    settings: Settings,
    songs: SongRepository,
    media: MediaStore,
    owner_id: str,
    archive: zipfile.ZipFile,
    entry: _Song,
    mode: Mode,
    warnings: list[Notice],
    song_ids: dict[str, str],
) -> Literal["imported", "skipped", "copied"]:
    existing_id = (
        entry.id
        if songs.get_song(owner_id, entry.id) is not None
        else songs.find_duplicate_id(owner_id, entry.title, entry.artist, entry.source_kind)
    )
    existing = existing_id is not None
    if existing_id and mode == "skip":
        song_ids[entry.id] = existing_id
        return "skipped"

    document: ScoreDocument | None = None
    text: str | None = None
    raw = _read_member(archive, entry.file, MAX_JSON_BYTES)
    if entry.content_kind == "tab":
        document = ScoreDocument.model_validate(json.loads(raw)["document"])
    else:
        text = chordpro.normalize(raw.decode("utf-8"))
    # Keep the original id when nothing else uses it; ids are global, so another user's song may.
    keep_id = entry.id if not songs.id_taken(entry.id) else None
    song = songs.create_song(
        owner_id,
        title=entry.title.strip() or "Untitled",
        artist=entry.artist.strip(),
        source_kind=entry.source_kind,
        source_ref=entry.source_ref,
        document=document,
        chordpro=text,
        song_id=keep_id,
    )
    songs.set_tags(owner_id, song["id"], entry.tags)
    songs.set_favourite(owner_id, song["id"], entry.favourite)
    song_ids[entry.id] = song["id"]
    for item in entry.media:
        try:
            _restore_media(settings, media, owner_id, song["id"], archive, item)
        except (BackupError, ValueError, KeyError, OSError, sqlite3.Error, zipfile.BadZipFile):
            warnings.append(
                Notice("backup.mediaFailed", f"could not restore a file of {entry.title}", {"title": entry.title})
            )
    return "copied" if existing else "imported"


def _restore_media(
    settings: Settings, media: MediaStore, owner_id: str, song_id: str, archive: zipfile.ZipFile, item: _Media
) -> None:
    if item.kind not in _KINDS:
        raise ValueError("unknown media kind")
    filename = Path(item.filename).name or "file"
    content_type = "application/octet-stream"
    if item.kind == "audio":
        # The type is served back to the browser, so it comes from the extension, never from the archive.
        content_type = AUDIO_TYPES.get(Path(filename).suffix.lower(), "")
        if not content_type:
            raise ValueError("not an audio file")
    info = archive.getinfo(item.path)
    staging = settings.inbox_dir / f"restore-{uuid.uuid4().hex}"
    staging.parent.mkdir(parents=True, exist_ok=True)
    try:
        with archive.open(info) as source:
            _copy_limited(source, staging, info.file_size)
        media.save_file(owner_id, song_id, kind=item.kind, filename=filename, content_type=content_type, source=staging)
    finally:
        staging.unlink(missing_ok=True)


def register_restore_handler(runner: JobRunner, songs: SongRepository, media: MediaStore) -> None:
    def handler(job: dict[str, Any], progress: Progress) -> dict[str, Any]:
        payload = job["payload"]
        path = Path(payload["path"])
        try:
            return restore_archive(
                songs.settings, songs, media, job["owner_id"], path, payload.get("mode", "skip"), progress
            )
        finally:
            path.unlink(missing_ok=True)

    runner.register(JOB_KIND, handler)
