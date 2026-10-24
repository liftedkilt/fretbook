"""The bundled demo library: list, add and remove the demo songs."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from fretbook import demo
from fretbook.api.deps import context, principal
from fretbook.api.schemas import AUTH_RESPONSES
from fretbook.auth.base import Principal
from fretbook.context import AppContext

router = APIRouter()


class DemoSongInfo(BaseModel):
    id: str
    title: str
    artist: str
    kind: str
    """``bass`` or ``guitar`` (a tab) or ``chords`` (a chord sheet)."""
    has_audio: bool
    """The song comes with audio and sync."""
    song_id: str | None
    """The library song, or ``null`` when it has not been added."""


class DemoLibrary(BaseModel):
    songs: list[DemoSongInfo]
    installed: int
    """How many of the demo songs are in the caller's library."""


class DemoChange(DemoLibrary):
    changed: int
    """Songs added or removed by this call."""


def _library(ctx: AppContext, user: Principal) -> dict:
    songs = demo.status(ctx, user.user_id)
    return {"songs": songs, "installed": sum(1 for song in songs if song["song_id"])}


@router.get("/api/demo", response_model=DemoLibrary, tags=["demo"], responses=AUTH_RESPONSES)
def get_demo(ctx: AppContext = Depends(context), user: Principal = Depends(principal)) -> JSONResponse:
    """The demo songs and which of them are in the caller's library."""
    return JSONResponse(_library(ctx, user))


@router.post("/api/demo", response_model=DemoChange, tags=["demo"], responses=AUTH_RESPONSES)
def add_demo(ctx: AppContext = Depends(context), user: Principal = Depends(principal)) -> JSONResponse:
    """Add the demo songs that are missing. Adding twice changes nothing."""
    changed = demo.install(ctx, user.user_id)
    return JSONResponse({**_library(ctx, user), "changed": changed})


@router.delete("/api/demo", response_model=DemoChange, tags=["demo"], responses=AUTH_RESPONSES)
def remove_demo(ctx: AppContext = Depends(context), user: Principal = Depends(principal)) -> JSONResponse:
    """Remove the demo songs and their audio. Songs the caller made or imported are kept."""
    changed = demo.remove(ctx, user.user_id)
    return JSONResponse({**_library(ctx, user), "changed": changed})
