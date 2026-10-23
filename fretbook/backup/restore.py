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
from typing import IO, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from fretbook.backup.archive import FORMAT, FORMAT_VERSION, MANIFEST
from fretbook.chords import chordpro
from fretbook.config import Settings
from fretbook.importers.base import Notice
from fretbook.jobs.runner import JobRunner, Progress
from fretbook.score.model import ScoreDocument
from fretbook.storage.media import AUDIO_TYPES, MediaStore
from fretbook.storage.repository import SongRepository

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


class Manifest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    format: str
    format_version: int
    songs: list[_Song]


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
    warnings: list[Notice] = []
    total = len(manifest.songs)
    progress(f"Restoring {total} songs", "backup.restoring")
    with zipfile.ZipFile(path) as archive:
        for entry in manifest.songs:
            outcome: Literal["imported", "skipped", "copied", "failed"]
            try:
                outcome = _restore_song(settings, songs, media, owner_id, archive, entry, mode, warnings)
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
    progress("Ready", "import.ready")
    return {**counts, "warnings": [warning.as_dict() for warning in warnings]}


def _restore_song(
    settings: Settings,
    songs: SongRepository,
    media: MediaStore,
    owner_id: str,
    archive: zipfile.ZipFile,
    entry: _Song,
    mode: Mode,
    warnings: list[Notice],
) -> Literal["imported", "skipped", "copied"]:
    existing = songs.get_song(owner_id, entry.id) is not None or songs.find_duplicate(
        owner_id, entry.title, entry.artist, entry.source_kind
    )
    if existing and mode == "skip":
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
