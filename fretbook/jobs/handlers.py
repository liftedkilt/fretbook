"""Job handlers for imports."""

from __future__ import annotations

import logging
import uuid
from pathlib import Path
from typing import Any

from fretbook.audio.ytdlp import AudioDownloadError, download_audio
from fretbook.importers import remote
from fretbook.importers.audio_only import blank_document
from fretbook.importers.base import AudioFetch, ImportError, ImportRequest, ImportResult, Notice
from fretbook.importers.registry import resolve_importer
from fretbook.importers.safe_fetch import SafeFetcher
from fretbook.importers.youtube_frames import YouTubeFrameImporter
from fretbook.jobs.runner import JobRunner, Progress
from fretbook.score.model import ScoreDocument, content_hash
from fretbook.score.playback import played_bars
from fretbook.storage.media import AUDIO_TYPES, MediaStore
from fretbook.storage.repository import SongRepository

logger = logging.getLogger(__name__)


def register_handlers(
    runner: JobRunner, songs: SongRepository, media: MediaStore, fetcher: SafeFetcher | None = None
) -> None:
    settings = songs.settings
    safe_fetcher = fetcher or SafeFetcher(
        allow_private=settings.allow_private_urls,
        max_bytes=settings.fetch_max_bytes,
        timeout=settings.fetch_timeout_seconds,
    )

    def songsterr(job: dict[str, Any], progress: Progress) -> dict[str, Any]:
        return _import_url(job, progress, songs, media)

    def file_import(job: dict[str, Any], progress: Progress) -> dict[str, Any]:
        return _import_file(job, progress, songs, media)

    def youtube(job: dict[str, Any], progress: Progress) -> dict[str, Any]:
        payload = job["payload"]
        local = payload.get("frames_dir") or payload.get("video_path")
        if local:
            request = ImportRequest(
                owner_id=job["owner_id"],
                file_path=Path(local),
                filename=Path(local).name,
                kind="youtube-frames",
                options={
                    "title": payload.get("title") or "",
                    "artist": payload.get("artist") or "",
                    "video_id": payload.get("video_id"),
                },
            )
            result = YouTubeFrameImporter().import_score(request, progress)
            return _store_result(job, result, songs, media, progress)
        # A watch URL is still the rest of issue #6 (download, review screen).
        progress("YouTube import is not available yet", "import.youtubeUnavailable")
        YouTubeFrameImporter().import_score(ImportRequest(owner_id="", kind="youtube-frames"), progress)
        return {}

    def link(job: dict[str, Any], progress: Progress) -> dict[str, Any]:
        return _import_link(job, progress, songs, media, safe_fetcher)

    runner.register("import.songsterr", songsterr)
    runner.register("import.url", link)
    runner.register("import.file", file_import)
    runner.register("import.youtube_frames", youtube)


def _options(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "video_id": payload.get("video_id"),
        "slug": payload.get("slug"),
        "part_ids": payload.get("part_ids"),
        "prefer": payload.get("prefer"),
    }


def _import_url(job: dict[str, Any], progress: Progress, songs: SongRepository, media: MediaStore) -> dict[str, Any]:
    payload = job["payload"]
    request = ImportRequest(
        owner_id=job["owner_id"],
        url=payload.get("url"),
        kind=payload.get("kind") or "songsterr",
        options=_options(payload),
    )
    result = resolve_importer(request).import_score(request, progress)
    return _store_result(job, result, songs, media, progress)


def _import_link(
    job: dict[str, Any], progress: Progress, songs: SongRepository, media: MediaStore, fetcher: SafeFetcher
) -> dict[str, Any]:
    """Import whatever a pasted link points to (see :mod:`fretbook.importers.remote`)."""
    payload = job["payload"]
    url = str(payload["url"]).strip()
    provider = remote.provider_for(url)
    if provider == "songsterr":
        return _import_url(job, progress, songs, media)
    if provider == "youtube":
        if not songs.settings.download_audio:
            raise ImportError("audio downloads are turned off on this server", "import.audioDisabled")
        video_id = remote.youtube_video_id(url) or ""
        result = ImportResult(
            title="YouTube video",
            artist="",
            slug="youtube-video",
            document=blank_document(payload.get("prefer")),
            source_kind="youtube",
            source_ref={"url": url, "video_id": video_id},
            audio=AudioFetch(video_id=video_id),
        )
        return _store_result(job, result, songs, media, progress)
    staged = remote.fetch_importable(url, fetcher, songs.settings.inbox_dir, progress)
    job = {
        **job,
        "payload": {**payload, "path": str(staged.path), "filename": staged.filename, "source_url": staged.url},
    }
    return _import_file(job, progress, songs, media)


def _import_file(job: dict[str, Any], progress: Progress, songs: SongRepository, media: MediaStore) -> dict[str, Any]:
    payload = job["payload"]
    path = Path(payload["path"])
    request = ImportRequest(
        owner_id=job["owner_id"],
        filename=payload.get("filename") or path.name,
        file_path=path,
        kind=payload.get("kind"),
        options=_options(payload),
    )
    result = resolve_importer(request).import_score(request, progress)
    if payload.get("source_url"):
        result.source_ref.setdefault("url", payload["source_url"])
    stored = _store_result(job, result, songs, media, progress)
    if result.audio_file is None:
        try:
            # Keep the original upload next to the song.
            media.save_file(
                job["owner_id"],
                stored["song_id"],
                kind="import",
                filename=payload.get("filename") or path.name,
                content_type="application/octet-stream",
                source=path,
            )
        except (OSError, ValueError):
            logger.warning("could not keep the uploaded file for %s", stored["song_id"])
    path.unlink(missing_ok=True)
    return stored


def _reimport(
    existing: dict[str, Any], result: ImportResult, songs: SongRepository, owner_id: str, warnings: list[Notice]
) -> dict[str, Any] | None:
    """Refresh an untouched Songsterr import in place, keeping the user's taps. ``None`` means "make a new song"."""
    assert result.document is not None
    stored = ScoreDocument.model_validate(existing["document"])
    imported_hash = existing["source_ref"].get("content_hash")
    if imported_hash != content_hash(stored):
        warnings.append(
            Notice(
                "import.keptEditedCopy",
                "this song was edited since it was imported, so the new import was saved as a separate song",
                {"title": existing["title"]},
            )
        )
        return None
    document = result.document
    played = len(played_bars(document.bars))
    anchors = {key: value for key, value in stored.sync.anchors.items() if int(key) <= played}
    if len(anchors) != len(stored.sync.anchors):
        warnings.append(
            Notice("import.anchorsDropped", "the new import has fewer bars, so some sync marks were dropped")
        )
    document.sync.anchors = anchors
    # The player's BPM field is a sync adjustment; keep it along with the taps.
    document.bpm = stored.bpm
    document = ScoreDocument.model_validate(document.model_dump())
    source_ref = {**result.source_ref, "content_hash": content_hash(document)}
    saved = songs.update_song(
        owner_id,
        existing["id"],
        title=result.title,
        artist=result.artist,
        revision=existing["revision"],
        document=document,
        source_ref=source_ref,
    )
    return saved


def _store_result(
    job: dict[str, Any], result: ImportResult, songs: SongRepository, media: MediaStore, progress: Progress
) -> dict[str, Any]:
    owner_id = job["owner_id"]
    warnings = list(result.warnings)
    saved: dict[str, Any] | None = None
    if result.source_kind == "songsterr" and result.document is not None:
        song_id = result.source_ref.get("song_id")
        existing = songs.find_by_source(owner_id, "songsterr", song_id=song_id) if song_id is not None else None
        if existing:
            saved = _reimport(existing, result, songs, owner_id, warnings)
    if saved is None:
        source_ref = dict(result.source_ref)
        if result.document is not None:
            source_ref["content_hash"] = content_hash(result.document)
        saved = songs.create_song(
            owner_id,
            title=result.title,
            artist=result.artist,
            document=result.document,
            chordpro=result.chordpro,
            source_kind=result.source_kind,
            source_ref=source_ref,
            slug=result.slug,
        )
    if result.audio_file is not None:
        suffix = next((ext for ext, kind in AUDIO_TYPES.items() if kind == result.audio_content_type), ".mp3")
        media.save_file(
            owner_id,
            saved["id"],
            kind="audio",
            filename=f"audio{suffix}",
            content_type=result.audio_content_type,
            source=result.audio_file,
            replace_kind=True,
        )
    if result.audio and songs.settings.download_audio:
        tmp = songs.settings.inbox_dir / f"audio-{uuid.uuid4().hex}.mp3"
        try:
            download_audio(
                result.audio.video_id,
                tmp,
                progress,
                timeout_seconds=songs.settings.audio_timeout_seconds,
                settings=songs.settings,
            )
            media.save_file(
                owner_id,
                saved["id"],
                kind="audio",
                filename="audio.mp3",
                content_type="audio/mpeg",
                source=tmp,
                replace_kind=True,
            )
        except AudioDownloadError as exc:
            warnings.append(Notice(exc.key, str(exc), exc.params))
        finally:
            tmp.unlink(missing_ok=True)
    progress("Ready", "import.ready")
    return {
        "song_id": saved["id"],
        "slug": saved["slug"],
        "content_kind": saved["content_kind"],
        "warnings": [warning.as_dict() for warning in warnings],
    }
