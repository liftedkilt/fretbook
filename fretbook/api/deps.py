from __future__ import annotations

from fastapi import Request

from fretbook.api.errors import api_error
from fretbook.auth.base import Principal
from fretbook.context import AppContext


def context(request: Request) -> AppContext:
    return request.app.state.ctx


def principal(request: Request) -> Principal:
    return context(request).auth.authenticate(request)


def admin(request: Request) -> Principal:
    user = principal(request)
    if not user.is_admin:
        raise api_error(403, "auth.adminOnly", "only administrators can do this")
    return user


def require_song(ctx: AppContext, owner_id: str, song_id: str) -> dict:
    song = ctx.songs.get_song(owner_id, song_id)
    if song is None:
        raise api_error(404, "song.notFound", "song not found")
    return song
