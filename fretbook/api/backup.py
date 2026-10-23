"""Library export and restore. Registered beside ``routes`` so that file stays small."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask

from fretbook.api.deps import admin, context, principal
from fretbook.api.errors import api_error
from fretbook.api.routes import _spool
from fretbook.api.schemas import ADMIN_RESPONSES, AUTH_RESPONSES, JobAccepted
from fretbook.auth.base import Principal
from fretbook.backup.archive import write_archive
from fretbook.backup.restore import JOB_KIND, BackupError, inspect_archive
from fretbook.context import AppContext

router = APIRouter()

RESTORE_PATH = "/api/library/import"

_ZIP: dict[int | str, dict[str, Any]] = {
    200: {
        "description": "A zip archive of songs and media, as an attachment.",
        "content": {"application/zip": {"schema": {"type": "string", "format": "binary"}}},
    }
}


def _export(ctx: AppContext, owner_id: str | None, name: str) -> FileResponse:
    # Built on disk song by song, so a large library never sits in memory.
    staging = ctx.settings.inbox_dir / f"export-{uuid.uuid4().hex}.zip"
    staging.parent.mkdir(parents=True, exist_ok=True)
    try:
        write_archive(ctx.settings, ctx.songs, ctx.media, staging, owner_id=owner_id)
    except BaseException:
        staging.unlink(missing_ok=True)
        raise
    stamp = datetime.now(UTC).strftime("%Y%m%d")
    return FileResponse(
        staging,
        media_type="application/zip",
        filename=f"{name}-{stamp}.zip",
        background=BackgroundTask(lambda: staging.unlink(missing_ok=True)),
    )


@router.get("/api/library/export", tags=["library"], responses={**AUTH_RESPONSES, **_ZIP})
def export_library(ctx: AppContext = Depends(context), user: Principal = Depends(principal)) -> FileResponse:
    """Every song the caller owns, with its audio and kept uploads, as one zip."""
    return _export(ctx, user.user_id, "fretbook-library")


@router.get("/api/admin/library/export", tags=["admin"], responses={**ADMIN_RESPONSES, **_ZIP})
def export_everything(ctx: AppContext = Depends(context), _admin: Principal = Depends(admin)) -> FileResponse:
    """Every song of every user, for admins. Restoring it puts all songs in the restoring user's library."""
    return _export(ctx, None, "fretbook-all")


@router.post(
    RESTORE_PATH,
    status_code=202,
    response_model=JobAccepted,
    tags=["library"],
    responses=AUTH_RESPONSES,
)
async def import_library(
    file: UploadFile = File(...),
    mode: Literal["skip", "copy"] = Form(default="skip"),
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
) -> JSONResponse:
    """Queue a restore of an exported archive into the caller's library. Poll `GET /api/jobs/{job_id}`.

    A song already in the library (same id, or same title, artist and source) is left alone with
    `mode=skip` and added again as a copy with `mode=copy`. The archive is checked before the job is queued.
    """
    path = ctx.settings.inbox_dir / f"library-{uuid.uuid4().hex}.zip"
    await _spool(file, path, ctx.settings.max_restore_bytes)
    try:
        await run_in_threadpool(inspect_archive, path, ctx.settings)
    except BackupError as exc:
        path.unlink(missing_ok=True)
        raise api_error(400, exc.key, str(exc), **exc.params) from exc
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    job_id = ctx.jobs.enqueue(user.user_id, JOB_KIND, {"path": str(path), "mode": mode})
    return JSONResponse({"job_id": job_id}, status_code=202)
