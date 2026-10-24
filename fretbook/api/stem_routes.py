"""Stem separation: queue the worker job and serve the stems it stored."""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends, Response
from fastapi.responses import FileResponse, JSONResponse

from fretbook.api.deps import context, principal, require_song
from fretbook.api.errors import api_error
from fretbook.api.schemas import AUTH_RESPONSES, JobAccepted, StemList, StemRequest
from fretbook.audio.stems import STEM_NAMES
from fretbook.auth.base import Principal
from fretbook.context import AppContext
from fretbook.jobs.stems import KIND

router = APIRouter()

_PREFIX = "stem-"


@router.get("/api/songs/{song_id}/stems", response_model=StemList, tags=["songs"], responses=AUTH_RESPONSES)
def list_stems(song_id: str, ctx: AppContext = Depends(context), user: Principal = Depends(principal)) -> StemList:
    """The stems stored for the song, and whether a worker is running that could make them."""
    require_song(ctx, user.user_id, song_id)
    rows = [row for row in ctx.media.stems_for(user.user_id, song_id) if row["kind"][len(_PREFIX) :] in STEM_NAMES]
    stems = [
        {
            "name": row["kind"][len(_PREFIX) :],
            "url": f"api/songs/{song_id}/stems/{row['kind'][len(_PREFIX) :]}?v={row['id']}",
            "byte_size": int(row["byte_size"]),
        }
        for row in rows
    ]
    return StemList.model_validate({"stems": stems, "available": KIND in ctx.jobs.live_worker_kinds()})


@router.post(
    "/api/songs/{song_id}/stems",
    status_code=202,
    response_model=JobAccepted,
    tags=["songs"],
    responses=AUTH_RESPONSES,
)
def start_stems(
    song_id: str,
    body: StemRequest = Body(default_factory=StemRequest),
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
) -> JSONResponse:
    """Queue a separation of the song's audio into stems. Needs a worker that advertises ``audio.stems``.

    Poll the job; the finished job's ``result.stems`` lists the stems, which ``GET /api/songs/{song_id}/stems``
    serves. A new run replaces the old stems.
    """
    require_song(ctx, user.user_id, song_id)
    if ctx.media.audio_for(user.user_id, song_id) is None:
        raise api_error(400, "audio.none", "this song has no audio")
    if KIND not in ctx.jobs.live_worker_kinds():
        raise api_error(409, "stems.noWorker", "no worker is running that can separate stems")
    job_id = ctx.jobs.enqueue(user.user_id, KIND, {"song_id": song_id, "model": body.model})
    return JSONResponse({"job_id": job_id}, status_code=202)


@router.get(
    "/api/songs/{song_id}/stems/{name}",
    tags=["songs"],
    responses={**AUTH_RESPONSES, 200: {"description": "One stem as audio.", "content": {"audio/mpeg": {}}}},
)
def download_stem(
    song_id: str, name: str, ctx: AppContext = Depends(context), user: Principal = Depends(principal)
) -> FileResponse:
    require_song(ctx, user.user_id, song_id)
    row = next((r for r in ctx.media.stems_for(user.user_id, song_id) if r["kind"] == f"{_PREFIX}{name}"), None)
    if name not in STEM_NAMES or row is None:
        raise api_error(404, "stems.none", "this song has no such stem")
    path = ctx.media.path_for(row)
    if not path.is_file():
        raise api_error(404, "audio.missing", "audio file is missing")
    return FileResponse(path, media_type=row["content_type"], filename=row["filename"])


@router.delete("/api/songs/{song_id}/stems", status_code=204, tags=["songs"], responses=AUTH_RESPONSES)
def delete_stems(song_id: str, ctx: AppContext = Depends(context), user: Principal = Depends(principal)) -> Response:
    """Remove the song's stems to free the space; the recording itself stays."""
    require_song(ctx, user.user_id, song_id)
    ctx.media.delete_stems(user.user_id, song_id)
    return Response(status_code=204)
