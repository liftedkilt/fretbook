"""Read-only share links. The public routes do not require a session.

A missing, revoked, expired, or disabled link all answer 404 with the same error, so trying tokens
does not reveal which songs exist. The payload has no real song id, library id, notes, tags, or
source reference, and it cannot be written back.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from fretbook.api.deps import context, principal
from fretbook.api.errors import api_error
from fretbook.api.schemas import AUTH_RESPONSES, ShareCreated, ShareLink, SongDetail
from fretbook.auth.base import Principal
from fretbook.context import AppContext

router = APIRouter()

_NO_STORE = {"Cache-Control": "private, no-store", "X-Robots-Tag": "noindex"}

_AUDIO: dict[int | str, dict[str, Any]] = {
    200: {
        "description": "The shared song's audio file.",
        "content": {"audio/*": {"schema": {"type": "string", "format": "binary"}}},
        "headers": {
            "Cache-Control": {"schema": {"type": "string"}},
            "X-Robots-Tag": {"schema": {"type": "string"}},
        },
    }
}


class ShareBody(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    expires_in_days: int | None = Field(default=None, ge=1, le=3650)
    """Days until the link stops working. Omit it for a link that lasts until it is revoked."""


def _stores(ctx: AppContext):
    if ctx.libraries is None:
        raise api_error(404, "library.notFound", "that library was not found")
    return ctx.libraries


def _missing() -> None:
    raise api_error(404, "share.notFound", "that link is not available")


@router.get(
    "/api/songs/{song_id}/shares",
    response_model=list[ShareLink],
    tags=["sharing"],
    responses=AUTH_RESPONSES,
)
def list_shares(song_id: str, ctx: AppContext = Depends(context), user: Principal = Depends(principal)) -> JSONResponse:
    """Live links for a song the caller can edit. Revoked links are left out. The secret is not included."""
    return JSONResponse(_stores(ctx).list_shares(user.user_id, song_id))


@router.post(
    "/api/songs/{song_id}/shares",
    status_code=201,
    response_model=ShareCreated,
    tags=["sharing"],
    responses=AUTH_RESPONSES,
)
def create_share(
    song_id: str,
    body: ShareBody,
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
) -> JSONResponse:
    """Create a read-only link. The token is returned once. Refused when share links are turned off."""
    return JSONResponse(
        _stores(ctx).create_share(user.user_id, song_id, body.expires_in_days),
        status_code=201,
    )


@router.delete(
    "/api/songs/{song_id}/shares/{share_id}",
    status_code=204,
    response_model=None,
    tags=["sharing"],
    responses=AUTH_RESPONSES,
)
def revoke_share(
    song_id: str,
    share_id: str,
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
) -> Response:
    """Revoke a link. The row stays so the token cannot be issued again."""
    if not _stores(ctx).revoke_share(user.user_id, song_id, share_id):
        raise api_error(404, "share.notFound", "that link is not available")
    return Response(status_code=204)


@router.get("/api/share/{token}", response_model=SongDetail, tags=["sharing"])
def open_share(token: str, ctx: AppContext = Depends(context)) -> JSONResponse:
    """The song a link points at, without signing in. Nothing on this route changes the song."""
    opened = _stores(ctx).open_share(token)
    if opened is None:
        _missing()
    return JSONResponse(opened["song"], headers=_NO_STORE)


@router.get("/api/share/{token}/audio", tags=["sharing"], responses=_AUDIO)
def share_audio(token: str, ctx: AppContext = Depends(context)) -> FileResponse:
    """Audio for a live link. A bad link and a song with no audio use the same not-found error when the link is dead."""
    opened = _stores(ctx).open_share(token)
    if opened is None:
        _missing()
    row = ctx.media.file_for_song(opened["song_id"], "audio")
    if row is None:
        raise api_error(404, "audio.none", "this song has no audio")
    path = ctx.media.path_for(row)
    if not path.is_file():
        raise api_error(404, "audio.missing", "audio file is missing")
    return FileResponse(
        path,
        media_type=row["content_type"],
        filename=row["filename"],
        headers=_NO_STORE,
    )
