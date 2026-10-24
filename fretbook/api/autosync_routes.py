"""Automatic sync: queue the job that estimates a tab's bar marks from its audio."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from fretbook.api.deps import context, principal, require_song
from fretbook.api.errors import api_error
from fretbook.api.schemas import AUTH_RESPONSES, AutoSyncRequest, JobAccepted
from fretbook.auth.base import Principal
from fretbook.context import AppContext
from fretbook.jobs.autosync import KIND
from fretbook.score.model import ScoreDocument
from fretbook.score.playback import played_bars

router = APIRouter()


@router.post(
    "/api/songs/{song_id}/autosync",
    status_code=202,
    response_model=JobAccepted,
    tags=["songs"],
    responses=AUTH_RESPONSES,
)
def start_autosync(
    song_id: str,
    body: AutoSyncRequest | None = None,
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
) -> JSONResponse:
    """Queue an estimate of the bar marks from the song's audio.

    The finished job's ``result.autosync`` holds the proposed anchors and a confidence for each. Nothing is
    saved: accept a proposal by sending its anchors to ``PATCH /api/songs/{song_id}/sync``.

    The body is optional. By default the tab's first bar starts with the first sound in the audio; when the
    recording has an intro or count-in the tab lacks, give ``start_seconds`` (and ``start_bar`` if the audio
    begins partway through the tab).
    """
    song = require_song(ctx, user.user_id, song_id)
    if song["content_kind"] != "tab":
        raise api_error(400, "sync.notTab", "only tabs have sync marks")
    if ctx.media.audio_for(user.user_id, song_id) is None:
        raise api_error(400, "audio.none", "this song has no audio")
    request = body or AutoSyncRequest()
    if request.start_bar >= len(played_bars(ScoreDocument.model_validate(song["document"]).bars)):
        raise api_error(400, "autosync.badStart", "that bar is not in this tab")
    payload = {"song_id": song_id, "start_bar": request.start_bar, "start_seconds": request.start_seconds}
    job_id = ctx.jobs.enqueue(user.user_id, KIND, payload)
    return JSONResponse({"job_id": job_id}, status_code=202)
