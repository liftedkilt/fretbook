"""The ``audio.youtube`` job: replace an existing song's audio with a YouTube video's audio track."""

from __future__ import annotations

import uuid
from typing import Any

from fretbook.audio.ytdlp import AudioDownloadError, download_audio
from fretbook.importers import remote
from fretbook.importers.base import ImportError
from fretbook.jobs.runner import JobRunner
from fretbook.storage.media import MediaStore
from fretbook.storage.repository import SongRepository

KIND = "audio.youtube"


def register_youtube_audio(runner: JobRunner, songs: SongRepository, media: MediaStore) -> None:
    settings = songs.settings

    def attach(job: dict[str, Any], progress: Any) -> dict[str, Any]:
        owner_id = job["owner_id"]
        payload = job["payload"]
        song_id = str(payload["song_id"])
        if not settings.download_audio:
            raise ImportError("audio downloads are turned off on this server", "import.audioDisabled")
        if songs.get_song(owner_id, song_id) is None:
            raise AudioDownloadError("song not found", "song.notFound")
        video_id = remote.youtube_video_id(str(payload.get("url") or ""))
        if video_id is None:
            raise AudioDownloadError("not a YouTube link", "audio.badVideo")
        tmp = settings.inbox_dir / f"audio-{uuid.uuid4().hex}.mp3"
        try:
            download_audio(
                video_id,
                tmp,
                progress,
                timeout_seconds=settings.audio_timeout_seconds,
                settings=settings,
            )
            media.save_file(
                owner_id,
                song_id,
                kind="audio",
                filename="audio.mp3",
                content_type="audio/mpeg",
                source=tmp,
                replace_kind=True,
            )
        finally:
            tmp.unlink(missing_ok=True)
        # Stems were cut from the old recording; they would not line up with the new one.
        media.delete_stems(owner_id, song_id)
        progress("Ready", "import.ready")
        return {"song_id": song_id, "video_id": video_id}

    runner.register(KIND, attach)
