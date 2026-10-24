"""Administration beyond user accounts: storage, the job queue, workers and system information.

Registered beside ``routes`` so that file stays small. Admins exist only with sign-in (OIDC).
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from fretbook import admin_stats
from fretbook.api.deps import admin, context
from fretbook.api.errors import api_error
from fretbook.api.routes import _job_label
from fretbook.api.schemas import ADMIN_RESPONSES, JobAccepted
from fretbook.auth.base import Principal
from fretbook.context import AppContext

router = APIRouter()


class UserStorage(BaseModel):
    user_id: str
    display_name: str
    local: bool
    song_count: int
    db_rows: int
    """Rows in the user's songs, setlists, practice log, lessons progress, calibrations and inbox."""
    media_files: int
    media_bytes: int
    quota_bytes: int | None
    """`FRETBOOK_USER_QUOTA_MB` in bytes, or null when there is no limit."""


class OrphanReport(BaseModel):
    files: int
    bytes: int
    empty_dirs: int


class Storage(BaseModel):
    users: list[UserStorage]
    orphans: OrphanReport
    """Files under the media folder no database row refers to. Files from the last hour are left out."""


class AdminJob(BaseModel):
    id: str
    kind: str
    status: Literal["queued", "running", "done", "error"]
    label: str
    owner_id: str
    owner_name: str
    worker_id: str
    attempts: int
    error: str | None
    error_key: str
    error_params: dict[str, Any]
    progress: str
    progress_key: str
    created_at: str
    updated_at: str


class JobCount(BaseModel):
    kind: str
    status: Literal["queued", "running", "done", "error"]
    count: int


class JobOverview(BaseModel):
    counts: list[JobCount]
    jobs: list[AdminJob]


class Worker(BaseModel):
    id: str
    kinds: list[str]
    host: str
    pid: int
    started_at: str
    heartbeat_at: str
    alive: bool
    """True when the last heartbeat is recent."""


class Workers(BaseModel):
    workers: list[Worker]
    local_kinds: list[str]
    """Kinds the web process runs itself."""


class SystemInfo(BaseModel):
    version: str
    commit: str | None
    schema_version: int
    ytdlp_version: str | None
    python_version: str
    disk_free_bytes: int
    disk_total_bytes: int
    database_bytes: int
    user_quota_mb: int
    """0 when there is no quota."""


def _json(payload: object) -> JSONResponse:
    return JSONResponse(payload)


@router.get("/api/admin/storage", response_model=Storage, tags=["admin"], responses=ADMIN_RESPONSES)
def admin_storage(ctx: AppContext = Depends(context), _admin: Principal = Depends(admin)) -> JSONResponse:
    """Database rows and media bytes per user, and the orphaned media files a cleanup would delete."""
    return _json(
        {"users": admin_stats.storage_by_user(ctx.settings), "orphans": admin_stats.orphan_report(ctx.settings)}
    )


@router.post("/api/admin/storage/cleanup", response_model=OrphanReport, tags=["admin"], responses=ADMIN_RESPONSES)
def admin_storage_cleanup(ctx: AppContext = Depends(context), _admin: Principal = Depends(admin)) -> JSONResponse:
    """Delete media files no database row refers to, and the folders left empty. Returns what was removed."""
    return _json(admin_stats.clean_orphans(ctx.settings))


@router.get("/api/admin/jobs", response_model=JobOverview, tags=["admin"], responses=ADMIN_RESPONSES)
def admin_jobs(
    status: Literal["queued", "running", "done", "error"] | None = None,
    kind: str | None = None,
    ctx: AppContext = Depends(context),
    _admin: Principal = Depends(admin),
) -> JSONResponse:
    """Job counts per kind and status, and the newest 100 jobs of every user (filter by `status` or `kind`)."""
    names = {user["id"]: user["display_name"] for user in ctx.users.list_users()}
    jobs = []
    for job in ctx.jobs.list_all(status=status, kind=kind):
        jobs.append(
            {
                **{key: job[key] for key in AdminJob.model_fields if key in job},
                "label": _job_label(job),
                "owner_name": names.get(job["owner_id"], ""),
            }
        )
    return _json({"counts": ctx.jobs.counts(), "jobs": jobs})


@router.post(
    "/api/admin/jobs/{job_id}/retry",
    status_code=202,
    response_model=JobAccepted,
    tags=["admin"],
    responses=ADMIN_RESPONSES,
)
def admin_retry_job(
    job_id: str, ctx: AppContext = Depends(context), _admin: Principal = Depends(admin)
) -> JSONResponse:
    """Queue a failed job again, whoever owns it."""
    job = ctx.jobs.get_any(job_id)
    if job is None:
        raise api_error(404, "job.notFound", "job not found")
    if job["status"] != "error":
        raise api_error(400, "job.notFailed", "only failed jobs can be retried")
    try:
        ctx.jobs.retry(job["owner_id"], job_id)
    except FileNotFoundError as exc:
        raise api_error(400, "job.uploadExpired", str(exc)) from exc
    return JSONResponse({"job_id": job_id}, status_code=202)


@router.post(
    "/api/admin/jobs/{job_id}/cancel",
    response_model=JobAccepted,
    tags=["admin"],
    responses=ADMIN_RESPONSES,
)
def admin_cancel_job(
    job_id: str, ctx: AppContext = Depends(context), _admin: Principal = Depends(admin)
) -> JSONResponse:
    """Cancel a job still waiting in the queue. A job a worker is already running cannot be stopped."""
    if ctx.jobs.get_any(job_id) is None:
        raise api_error(404, "job.notFound", "job not found")
    if not ctx.jobs.cancel(job_id):
        raise api_error(400, "job.notQueued", "only queued jobs can be cancelled")
    return _json({"job_id": job_id})


@router.get("/api/admin/workers", response_model=Workers, tags=["admin"], responses=ADMIN_RESPONSES)
def admin_workers(ctx: AppContext = Depends(context), _admin: Principal = Depends(admin)) -> JSONResponse:
    """Separate worker processes and their last heartbeat, and the kinds the web process runs itself."""
    return _json({"workers": ctx.jobs.list_workers(), "local_kinds": ctx.jobs.local_kinds()})


@router.get("/api/admin/system", response_model=SystemInfo, tags=["admin"], responses=ADMIN_RESPONSES)
def admin_system(ctx: AppContext = Depends(context), _admin: Principal = Depends(admin)) -> JSONResponse:
    """Version, schema version, yt-dlp and Python versions, disk space and the database size."""
    return _json(admin_stats.system_info(ctx.settings))
