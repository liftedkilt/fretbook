from __future__ import annotations

from fastapi import HTTPException, Request

from fretbook.auth.base import Principal
from fretbook.context import AppContext


def context(request: Request) -> AppContext:
    return request.app.state.ctx


def principal(request: Request) -> Principal:
    return context(request).auth.authenticate(request)


def require_song(ctx: AppContext, owner_id: str, song_id: str) -> dict:
    song = ctx.songs.get_song(owner_id, song_id)
    if song is None:
        raise HTTPException(status_code=404, detail="song not found")
    return song
