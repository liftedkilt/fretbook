"""Audio transcription: queue worker jobs to transcribe a song's audio or a newly uploaded file into a tab."""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Body, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse

from fretbook.api.deps import context, principal, require_song
from fretbook.api.errors import api_error
from fretbook.api.routes import _safe_name, _spool
from fretbook.api.schemas import AUTH_RESPONSES, JobAccepted, TranscribeInfo, TranscribeRequest
from fretbook.auth.base import Principal
from fretbook.context import AppContext
from fretbook.jobs.transcribe import KIND

router = APIRouter()


@router.get(
    "/api/songs/{song_id}/transcribe",
    response_model=TranscribeInfo,
    tags=["songs"],
    responses=AUTH_RESPONSES,
)
def get_transcribe_info(
    song_id: str,
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
) -> TranscribeInfo:
    """Whether a worker that transcribes audio is currently running."""
    require_song(ctx, user.user_id, song_id)
    return TranscribeInfo(available=KIND in ctx.jobs.live_worker_kinds())


@router.post(
    "/api/songs/{song_id}/transcribe",
    status_code=202,
    response_model=JobAccepted,
    tags=["songs"],
    responses=AUTH_RESPONSES,
)
def start_song_transcription(
    song_id: str,
    body: TranscribeRequest = Body(default_factory=TranscribeRequest),
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
) -> JSONResponse:
    """Queue transcription of a song's existing audio into a draft tab track.

    The job extracts polyphonic MIDI notes, tracks beats and tempo, and assigns frets.
    The resulting track is added to the song with sync anchors set from the beat grid.
    """
    require_song(ctx, user.user_id, song_id)
    if ctx.media.audio_for(user.user_id, song_id) is None:
        raise api_error(400, "audio.none", "this song has no audio")
    if KIND not in ctx.jobs.live_worker_kinds():
        raise api_error(409, "transcribe.noWorker", "no worker is running that can transcribe audio")
    job_id = ctx.jobs.enqueue(
        user.user_id,
        KIND,
        {
            "song_id": song_id,
            "stem": body.stem,
            "preset": body.preset,
            "grid": body.grid,
        },
    )
    return JSONResponse({"job_id": job_id}, status_code=202)


@router.post(
    "/api/imports/transcribe",
    status_code=202,
    response_model=JobAccepted,
    tags=["imports"],
    responses=AUTH_RESPONSES,
)
async def start_file_transcription(
    file: UploadFile = File(...),
    stem: Literal["mix", "bass", "guitar"] = Form("mix"),
    preset: str | None = Form(None),
    grid: Literal[4, 8, 16, 32] = Form(16),
    title: str | None = Form(None),
    artist: str | None = Form(None),
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
) -> JSONResponse:
    """Upload an audio file and transcribe it into a new song with draft tab and sync marks."""
    if KIND not in ctx.jobs.live_worker_kinds():
        raise api_error(409, "transcribe.noWorker", "no worker is running that can transcribe audio")
    filename = file.filename or "recording.mp3"
    path = ctx.settings.inbox_dir / f"transcribe-{uuid.uuid4().hex}-{_safe_name(filename)}"
    await _spool(file, path, ctx.settings.max_upload_bytes)
    job_id = ctx.jobs.enqueue(
        user.user_id,
        KIND,
        {
            "file_path": str(path),
            "filename": filename,
            "stem": stem,
            "preset": preset,
            "grid": grid,
            "title": title,
            "artist": artist,
        },
    )
    return JSONResponse({"job_id": job_id}, status_code=202)
