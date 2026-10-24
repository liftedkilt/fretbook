"""Job handlers for imports."""

from __future__ import annotations

import hashlib
import json
import logging
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fretbook.audio.ytdlp import AudioDownloadError, download_audio
from fretbook.importers import remote, ultimate_guitar
from fretbook.importers.audio_only import blank_document, song_slug
from fretbook.importers.base import AudioFetch, ImportError, ImportRequest, ImportResult, Notice
from fretbook.importers.registry import resolve_importer
from fretbook.importers.safe_fetch import SafeFetcher
from fretbook.importers.youtube_frames import YouTubeFrameImporter
from fretbook.jobs.autosync import register_autosync
from fretbook.jobs.runner import JobRunner, Progress
from fretbook.jobs.stems import register_stems
from fretbook.jobs.youtube_audio import register_youtube_audio
from fretbook.score.model import ScoreDocument, content_hash
from fretbook.score.playback import played_bars
from fretbook.storage.media import AUDIO_TYPES, MediaStore
from fretbook.storage.repository import SongRepository
from fretbook.tags import suggest_tags

logger = logging.getLogger(__name__)


# Sources whose links refresh a song in place, and the ``source_ref`` key that identifies the song on the site.
_REIMPORT_KEY = {"songsterr": "song_id", "ultimate-guitar": "tab_id"}


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
    register_autosync(runner, songs, media)
    register_stems(runner, songs, media)
    register_youtube_audio(runner, songs, media)


def _options(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "video_id": payload.get("video_id"),
        "slug": payload.get("slug"),
        "part_ids": payload.get("part_ids"),
        "prefer": payload.get("prefer"),
        "midi": payload.get("midi"),
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
        title, artist, warnings = "YouTube video", "", []
        try:
            title, artist = _youtube_names(video_id, fetcher)
        except ImportError as exc:
            logger.info("could not read the title of YouTube video %s: %s", video_id, exc)
            warnings.append(Notice("import.youtubeTitleUnavailable", "could not read the video's title"))
        result = ImportResult(
            title=title,
            artist=artist,
            slug=song_slug(title),
            document=blank_document(payload.get("prefer")),
            source_kind="youtube",
            source_ref={"url": url, "video_id": video_id},
            audio=AudioFetch(video_id=video_id),
            warnings=warnings,
        )
        return _store_result(job, result, songs, media, progress)
    if provider == "ultimate-guitar":
        progress("Downloading the link", "import.fetching")
        fetched = fetcher.fetch(url)
        result = ultimate_guitar.parse_page(fetched.content.decode("utf-8", errors="replace"), url)
        progress("Ready", "import.tabReady")
        return _store_result(job, result, songs, media, progress)
    staged = remote.fetch_importable(url, fetcher, songs.settings.inbox_dir, progress)
    job = {
        **job,
        "payload": {**payload, "path": str(staged.path), "filename": staged.filename, "source_url": staged.url},
    }
    return _import_file(job, progress, songs, media)


def _youtube_names(video_id: str, fetcher: SafeFetcher) -> tuple[str, str]:
    """The video's title and channel (as the artist), from YouTube's oEmbed endpoint."""
    watch = quote(f"https://www.youtube.com/watch?v={video_id}", safe="")
    fetched = fetcher.fetch(f"https://www.youtube.com/oembed?format=json&url={watch}")
    try:
        data = json.loads(fetched.content.decode("utf-8", errors="replace"))
    except ValueError as exc:
        raise ImportError("YouTube answered with something unreadable", "import.fetchFailed") from exc
    title = str(data.get("title") or "").strip() if isinstance(data, dict) else ""
    if not title:
        raise ImportError("YouTube did not name the video", "import.fetchFailed")
    artist = str(data.get("author_name") or "").strip()
    return title[:200], artist.removesuffix(" - Topic").strip()[:200]


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


def import_local_file(
    owner_id: str,
    path: Path,
    songs: SongRepository,
    media: MediaStore,
    *,
    prefer: str | None = None,
    on_duplicate: str = "skip",
    replace_song_id: str | None = None,
    progress: Progress | None = None,
) -> dict[str, Any]:
    """Run the ``import.file`` path on ``path`` now, without a queued job. ``path`` is deleted afterwards."""
    job = {
        "owner_id": owner_id,
        "payload": {
            "path": str(path),
            "filename": path.name,
            "kind": None,
            "prefer": prefer,
            "on_duplicate": on_duplicate,
            "replace_song_id": replace_song_id,
        },
    }

    def quiet(_message: str, _key: str = "") -> None:
        return None

    return _import_file(job, progress or quiet, songs, media)


def _reimport(
    existing: dict[str, Any], result: ImportResult, songs: SongRepository, owner_id: str, warnings: list[Notice]
) -> dict[str, Any] | None:
    """Refresh an untouched import in place, keeping the user's taps. ``None`` means "make a new song"."""
    imported_hash = existing["source_ref"].get("content_hash")
    if result.chordpro is not None:
        current = hashlib.sha256((existing.get("chordpro") or "").strip().encode("utf-8")).hexdigest()
    else:
        current = content_hash(ScoreDocument.model_validate(existing["document"]))
    if imported_hash != current:
        warnings.append(
            Notice(
                "import.keptEditedCopy",
                "this song was edited since it was imported, so the new import was saved as a separate song",
                {"title": existing["title"]},
            )
        )
        return None
    if result.chordpro is not None:
        source_ref = {
            **result.source_ref,
            "content_hash": hashlib.sha256(result.chordpro.strip().encode("utf-8")).hexdigest(),
        }
        return songs.update_song(
            owner_id,
            existing["id"],
            title=result.title,
            artist=result.artist,
            revision=existing["revision"],
            chordpro=result.chordpro,
            source_ref=source_ref,
        )
    assert result.document is not None
    stored = ScoreDocument.model_validate(existing["document"])
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
    payload = job.get("payload") or {}
    on_duplicate = payload.get("on_duplicate") or "keep_both"
    tags = payload.get("tags") or []
    if isinstance(tags, str):
        tags = [tags]

    warnings = list(result.warnings)
    saved: dict[str, Any] | None = None
    ref_key = _REIMPORT_KEY.get(result.source_kind)
    if ref_key is not None and (result.document is not None or result.chordpro is not None):
        ref_value = result.source_ref.get(ref_key)
        existing = (
            songs.find_by_source(owner_id, result.source_kind, **{ref_key: ref_value})
            if ref_value not in (None, "")
            else None
        )
        if existing and existing["content_kind"] == result.content_kind:
            saved = _reimport(existing, result, songs, owner_id, warnings)

    if saved is None:
        source_ref = dict(result.source_ref)
        hash_val: str | None = None
        if result.document is not None:
            hash_val = content_hash(result.document)
        elif result.chordpro is not None:
            hash_val = hashlib.sha256(result.chordpro.strip().encode("utf-8")).hexdigest()

        if hash_val is not None:
            source_ref["content_hash"] = hash_val
        if tags:
            source_ref["tags"] = tags

        # A re-import that names the song it came from (the watched inbox in library mode) replaces that song.
        replace_id = payload.get("replace_song_id")
        duplicate = songs.get_song(owner_id, replace_id) if replace_id else None
        if duplicate is not None:
            on_duplicate = "replace"
        else:
            duplicate = songs.find_existing_duplicate(
                owner_id, content_hash=hash_val, title=result.title, artist=result.artist
            )
        if duplicate is not None:
            if on_duplicate == "skip":
                warnings.append(
                    Notice(
                        "import.skippedDuplicate",
                        "Skipped duplicate of '{title}'",
                        {"title": duplicate["title"]},
                    )
                )
                progress("Skipped duplicate", "import.skippedDuplicate")
                return {
                    "song_id": duplicate["id"],
                    "slug": duplicate["slug"],
                    "content_kind": duplicate["content_kind"],
                    "skipped": True,
                    "duplicate_of": duplicate["id"],
                    "warnings": [warning.as_dict() for warning in warnings],
                }
            if on_duplicate == "replace":
                saved = songs.update_song(
                    owner_id,
                    duplicate["id"],
                    title=result.title,
                    artist=result.artist,
                    revision=duplicate["revision"],
                    document=result.document,
                    chordpro=result.chordpro,
                    source_ref=source_ref,
                )
                if tags and saved is not None:
                    songs.add_tags(owner_id, [duplicate["id"]], tags)
                    saved = songs.get_song(owner_id, duplicate["id"]) or saved
                warnings.append(
                    Notice(
                        "import.replacedDuplicate",
                        "Replaced existing song '{title}'",
                        {"title": duplicate["title"]},
                    )
                )

        if saved is None:
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
            # A new song starts with what the import knows + any batch tags; a re-import keeps the tags the user edited.
            tags_to_add = suggest_tags(saved)
            if tags:
                tags_to_add = list(dict.fromkeys([*tags_to_add, *tags]))
            if tags_to_add:
                songs.add_tags(owner_id, [saved["id"]], tags_to_add)
            saved = songs.get_song(owner_id, saved["id"]) or saved
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
