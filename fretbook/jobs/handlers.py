"""Job handlers for imports."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from fretbook.audio.ytdlp import AudioDownloadError, download_audio
from fretbook.importers.base import ImportRequest, silent_progress
from fretbook.importers.registry import resolve_importer
from fretbook.importers.youtube_frames import YouTubeFrameImporter
from fretbook.jobs.runner import JobRunner, Progress
from fretbook.storage.media import MediaStore
from fretbook.storage.repository import SongRepository

logger = logging.getLogger(__name__)


def register_handlers(runner: JobRunner, songs: SongRepository, media: MediaStore) -> None:
    def songsterr(job: dict[str, Any], progress: Progress) -> dict[str, Any]:
        return _import_url(job, progress, songs, media)

    def file_import(job: dict[str, Any], progress: Progress) -> dict[str, Any]:
        return _import_file(job, progress, songs, media)

    def youtube(job: dict[str, Any], progress: Progress) -> dict[str, Any]:
        del job
        progress("YouTube import is not available yet", "import.youtubeUnavailable")
        YouTubeFrameImporter().import_score(
            ImportRequest(owner_id="", kind="youtube-frames"),
            progress,
        )
        return {}

    runner.register("import.songsterr", songsterr)
    runner.register("import.file", file_import)
    runner.register("import.youtube_frames", youtube)


def _import_url(
    job: dict[str, Any],
    progress: Progress,
    songs: SongRepository,
    media: MediaStore,
) -> dict[str, Any]:
    payload = job["payload"]
    request = ImportRequest(
        owner_id=job["owner_id"],
        url=payload.get("url"),
        kind=payload.get("kind") or "songsterr",
        options={
            "video_id": payload.get("video_id"),
            "slug": payload.get("slug"),
            "part_ids": payload.get("part_ids"),
        },
    )
    importer = resolve_importer(request)
    result = importer.import_score(request, progress)
    return _store_result(job, result, songs, media, progress)


def _import_file(
    job: dict[str, Any],
    progress: Progress,
    songs: SongRepository,
    media: MediaStore,
) -> dict[str, Any]:
    payload = job["payload"]
    path = Path(payload["path"])
    request = ImportRequest(
        owner_id=job["owner_id"],
        filename=payload.get("filename") or path.name,
        file_path=path,
        kind=payload.get("kind"),
    )
    importer = resolve_importer(request)
    result = importer.import_score(request, progress)
    stored = _store_result(job, result, songs, media, progress)
    try:
        data = path.read_bytes()
        media.save(
            job["owner_id"],
            stored["song_id"],
            kind="import",
            filename=path.name,
            content_type="application/octet-stream",
            data=data,
        )
    except OSError:
        logger.warning("could not keep the uploaded file for %s", stored["song_id"])
    return stored


def _store_result(job, result, songs: SongRepository, media: MediaStore, progress: Progress) -> dict[str, Any]:
    owner_id = job["owner_id"]
    existing = None
    if result.source_kind == "songsterr":
        song_id = result.source_ref.get("song_id")
        if song_id is not None:
            existing = songs.find_by_source(owner_id, "songsterr", song_id=song_id)
    if existing:
        saved = songs.update_song(
            owner_id,
            existing["id"],
            title=result.title,
            artist=result.artist,
            document=result.document,
        )
        assert saved is not None
    else:
        saved = songs.create_song(
            owner_id,
            title=result.title,
            artist=result.artist,
            document=result.document,
            source_kind=result.source_kind,
            source_ref=result.source_ref,
            slug=result.slug,
        )
    warnings = list(result.warnings)
    if result.audio and songs.settings.download_audio:
        tmp = songs.settings.inbox_dir / f"{saved['id']}-audio.mp3"
        try:
            download_audio(result.audio.video_id, tmp, progress)
            media.save(
                owner_id,
                saved["id"],
                kind="audio",
                filename="audio.mp3",
                content_type="audio/mpeg",
                data=tmp.read_bytes(),
                replace_kind=True,
            )
        except AudioDownloadError as exc:
            warnings.append(str(exc))
        finally:
            tmp.unlink(missing_ok=True)
    progress("Ready", "import.ready")
    return {
        "song_id": saved["id"],
        "slug": saved["slug"],
        "warnings": warnings,
    }


def noop_progress(message: str, key: str = "") -> None:
    silent_progress(message, key)
