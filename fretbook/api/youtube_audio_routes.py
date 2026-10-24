"""Attach a YouTube link's audio to a song that already exists."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from fretbook.api.deps import context, principal, require_song
from fretbook.api.errors import api_error
from fretbook.api.schemas import AUTH_RESPONSES, JobAccepted, YouTubeAudioRequest
from fretbook.auth.base import Principal
from fretbook.context import AppContext
from fretbook.importers import remote
from fretbook.jobs.youtube_audio import KIND

router = APIRouter()


@router.post(
    "/api/songs/{song_id}/audio/youtube",
    status_code=202,
    response_model=JobAccepted,
    tags=["songs"],
    responses=AUTH_RESPONSES,
)
def start_youtube_audio(
    song_id: str,
    body: YouTubeAudioRequest,
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
) -> JSONResponse:
    """Queue a download of a YouTube video's audio, which replaces the song's audio (and its stems).

    Poll the job; when it is done, read the song again to get the new ``audio_url``.
    """
    require_song(ctx, user.user_id, song_id, write=True)
    if not ctx.settings.download_audio:
        raise api_error(400, "import.audioDisabled", "audio downloads are turned off on this server")
    url = body.url.strip()
    if remote.youtube_video_id(url) is None:
        raise api_error(400, "audio.notYoutube", "paste a YouTube video link")
    job_id = ctx.jobs.enqueue(user.user_id, KIND, {"song_id": song_id, "url": url})
    return JSONResponse({"job_id": job_id}, status_code=202)
