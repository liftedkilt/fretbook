"""The trash: list deleted songs, restore one, delete one for good, empty it.

A song in the trash answers 404 on every other route. These routes are for whoever may delete from the
library: its owner, or a band member who can edit.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from fretbook.api.deps import context, principal, require_library, require_song
from fretbook.api.errors import api_error
from fretbook.api.schemas import AUTH_RESPONSES, SongDetail
from fretbook.auth.base import Principal
from fretbook.context import AppContext
from fretbook.storage.trash import TrashStore

router = APIRouter()

_LIBRARY = Query(None, max_length=64, description="Library whose trash to use. Omit it for the caller's own.")


class TrashedSong(BaseModel):
    id: str
    title: str
    artist: str
    content_kind: str
    deleted_at: str
    purge_at: str
    """When the server removes the song for good."""
    media_bytes: int
    """Bytes of audio and other files the song still holds. They count towards the storage quota."""


class TrashList(BaseModel):
    retention_days: int
    """`FRETBOOK_TRASH_DAYS`. `0` means there is no trash: a delete is final and this list is always empty."""
    items: list[TrashedSong]


class TrashEmptied(BaseModel):
    deleted: int


def _store(ctx: AppContext) -> TrashStore:
    return TrashStore(ctx.settings, ctx.media)


@router.get("/api/trash", response_model=TrashList, tags=["songs"], responses=AUTH_RESPONSES)
def list_trash(
    library: str | None = _LIBRARY, ctx: AppContext = Depends(context), user: Principal = Depends(principal)
) -> TrashList:
    """Deleted songs that can still be restored, newest first."""
    store = _store(ctx)
    target = require_library(ctx, user.user_id, library, write=True)
    return TrashList(retention_days=store.days, items=[TrashedSong(**item) for item in store.list(target)])


@router.post("/api/trash/{song_id}/restore", response_model=SongDetail, tags=["songs"], responses=AUTH_RESPONSES)
def restore_song(
    song_id: str, ctx: AppContext = Depends(context), user: Principal = Depends(principal)
) -> JSONResponse:
    """Put a deleted song back with its audio, sync, tags, setlist entries and practice history."""
    if not _store(ctx).restore(user.user_id, song_id):
        raise api_error(404, "song.notFound", "song not found")
    return JSONResponse(require_song(ctx, user.user_id, song_id))


@router.delete("/api/trash/{song_id}", status_code=204, response_model=None, tags=["songs"], responses=AUTH_RESPONSES)
def delete_for_good(song_id: str, ctx: AppContext = Depends(context), user: Principal = Depends(principal)) -> Response:
    """Remove one song in the trash, and its files, for good."""
    if not _store(ctx).delete(user.user_id, song_id):
        raise api_error(404, "song.notFound", "song not found")
    return Response(status_code=204)


@router.delete("/api/trash", response_model=TrashEmptied, tags=["songs"], responses=AUTH_RESPONSES)
def empty_trash(
    library: str | None = _LIBRARY, ctx: AppContext = Depends(context), user: Principal = Depends(principal)
) -> TrashEmptied:
    """Remove every song in the library's trash, and their files, for good."""
    target = require_library(ctx, user.user_id, library, write=True)
    return TrashEmptied(deleted=_store(ctx).empty(target))
