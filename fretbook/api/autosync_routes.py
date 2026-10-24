"""Automatic sync: queue the job that estimates a tab's bar marks from its audio."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from fretbook.api.deps import context, principal, require_song
from fretbook.api.errors import api_error
from fretbook.api.schemas import AUTH_RESPONSES, JobAccepted
from fretbook.auth.base import Principal
from fretbook.context import AppContext
from fretbook.jobs.autosync import KIND

router = APIRouter()


@router.post(
    "/api/songs/{song_id}/autosync",
    status_code=202,
    response_model=JobAccepted,
    tags=["songs"],
    responses=AUTH_RESPONSES,
)
def start_autosync(
    song_id: str, ctx: AppContext = Depends(context), user: Principal = Depends(principal)
) -> JSONResponse:
    """Queue an estimate of the bar marks from the song's audio.

    The finished job's ``result.autosync`` holds the proposed anchors and a confidence for each. Nothing is
    saved: accept a proposal by sending its anchors to ``PATCH /api/songs/{song_id}/sync``.
    """
    song = require_song(ctx, user.user_id, song_id)
    if song["content_kind"] != "tab":
        raise api_error(400, "sync.notTab", "only tabs have sync marks")
    if ctx.media.audio_for(user.user_id, song_id) is None:
        raise api_error(400, "audio.none", "this song has no audio")
    job_id = ctx.jobs.enqueue(user.user_id, KIND, {"song_id": song_id})
    return JSONResponse({"job_id": job_id}, status_code=202)
