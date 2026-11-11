"""Admin routes for the server's own snapshots: the schedule's status and **Back up now**."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from fretbook.api.deps import admin, context
from fretbook.api.errors import api_error
from fretbook.api.schemas import ADMIN_RESPONSES
from fretbook.auth.base import Principal
from fretbook.backup.schedule import BackupBusy, BackupScheduler
from fretbook.context import AppContext

router = APIRouter()


class LastSnapshot(BaseModel):
    path: str
    created_at: str
    bytes: int


class BackupSchedule(BaseModel):
    schedule: Literal["off", "daily", "weekly"]
    """`FRETBOOK_BACKUP_SCHEDULE`. Always `off` in demo mode."""
    directory: str
    """`FRETBOOK_BACKUP_DIR`."""
    keep: int
    """`FRETBOOK_BACKUP_KEEP`."""
    last_snapshot: LastSnapshot | None
    """The newest snapshot in the directory, whoever took it; null when there is none."""
    next_due_at: str | None
    """When the schedule takes the next one; null when the schedule is off."""
    last_error: str | None
    """Why the last attempt since the server started failed; null after a success."""
    last_error_at: str | None
    running: bool


def _scheduler(ctx: AppContext) -> BackupScheduler:
    if ctx.backups is None:
        ctx.backups = BackupScheduler(ctx.settings)
    return ctx.backups


@router.get("/api/admin/backups", response_model=BackupSchedule, tags=["admin"], responses=ADMIN_RESPONSES)
def admin_backups(ctx: AppContext = Depends(context), _admin: Principal = Depends(admin)) -> JSONResponse:
    """The snapshot schedule, the newest snapshot and the last error."""
    return JSONResponse(_scheduler(ctx).status())


@router.post("/api/admin/backups", response_model=BackupSchedule, tags=["admin"], responses=ADMIN_RESPONSES)
def admin_backup_now(ctx: AppContext = Depends(context), _admin: Principal = Depends(admin)) -> JSONResponse:
    """Take a snapshot now and prune to `FRETBOOK_BACKUP_KEEP`. Answers when it is written.

    400 `backupSchedule.demoMode` in demo mode, 409 `backupSchedule.busy` while one is being written,
    500 `backupSchedule.failed` (with the reason) when it could not be written.
    """
    if ctx.settings.demo_mode:
        raise api_error(400, "backupSchedule.demoMode", "the demo does not take backups")
    scheduler = _scheduler(ctx)
    try:
        scheduler.run_now()
    except BackupBusy as exc:
        raise api_error(409, "backupSchedule.busy", "a backup is already being written") from exc
    except Exception as exc:  # noqa: BLE001 - reported to the admin, never fatal
        raise api_error(
            500, "backupSchedule.failed", f"the backup failed: {scheduler.last_error}", reason=scheduler.last_error
        ) from exc
    return JSONResponse(scheduler.status())
