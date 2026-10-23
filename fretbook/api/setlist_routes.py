"""Setlists: named, ordered lists of songs with a note and a chord-sheet transpose per entry."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from fretbook.api.deps import context, principal
from fretbook.api.errors import api_error
from fretbook.api.schemas import AUTH_RESPONSES, ContentKind
from fretbook.auth.base import Principal
from fretbook.context import AppContext
from fretbook.storage.setlists import (
    MAX_ENTRIES,
    MAX_NAME,
    MAX_NOTE,
    MAX_TRANSPOSE,
    EntryInput,
    SetlistRepository,
    TooManyEntries,
    UnknownSongs,
)

router = APIRouter()


class SetlistEntryBody(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    song_id: str = Field(max_length=64)
    note: str = Field(default="", max_length=MAX_NOTE)
    """Free text for the player: key, capo, "skip solo"."""
    transpose: int = Field(default=0, ge=-MAX_TRANSPOSE, le=MAX_TRANSPOSE)
    """Semitones, applied to a chord sheet when it is played from the setlist."""


class CreateSetlistBody(BaseModel):
    name: str = Field(min_length=1, max_length=MAX_NAME)
    entries: list[SetlistEntryBody] = Field(default_factory=list, max_length=MAX_ENTRIES)


class RenameSetlistBody(BaseModel):
    name: str = Field(min_length=1, max_length=MAX_NAME)


class ReplaceEntriesBody(BaseModel):
    entries: list[SetlistEntryBody] = Field(max_length=MAX_ENTRIES)


class SetlistSummary(BaseModel):
    id: str
    name: str
    entry_count: int
    created_at: str
    updated_at: str


class SetlistEntry(BaseModel):
    """One place in the running order. ``id`` changes whenever the entries are saved."""

    id: str
    song_id: str
    note: str
    transpose: int
    title: str
    artist: str
    content_kind: ContentKind
    preferred_instrument: str
    string_count: int


class SetlistDetail(SetlistSummary):
    entries: list[SetlistEntry]


def _repo(ctx: AppContext) -> SetlistRepository:
    return SetlistRepository(ctx.settings)


def _entries(body: list[SetlistEntryBody]) -> list[EntryInput]:
    return [EntryInput(item.song_id, item.note, item.transpose) for item in body]


def _not_found():
    return api_error(404, "setlist.notFound", "setlist not found")


def _entry_error(exc: Exception):
    if isinstance(exc, UnknownSongs):
        return api_error(400, "setlist.unknownSong", "a song in the setlist is not in your library")
    return api_error(400, "setlist.tooManyEntries", "a setlist can hold at most {limit} songs", limit=MAX_ENTRIES)


@router.get("/api/setlists", response_model=list[SetlistSummary], tags=["setlists"], responses=AUTH_RESPONSES)
def list_setlists(ctx: AppContext = Depends(context), user: Principal = Depends(principal)):
    return _repo(ctx).list_setlists(user.user_id)


@router.post(
    "/api/setlists", status_code=201, response_model=SetlistDetail, tags=["setlists"], responses=AUTH_RESPONSES
)
def create_setlist(body: CreateSetlistBody, ctx: AppContext = Depends(context), user: Principal = Depends(principal)):
    try:
        return _repo(ctx).create_setlist(user.user_id, body.name, _entries(body.entries))
    except (UnknownSongs, TooManyEntries) as exc:
        raise _entry_error(exc) from exc


@router.get("/api/setlists/{setlist_id}", response_model=SetlistDetail, tags=["setlists"], responses=AUTH_RESPONSES)
def get_setlist(setlist_id: str, ctx: AppContext = Depends(context), user: Principal = Depends(principal)):
    setlist = _repo(ctx).get_setlist(user.user_id, setlist_id)
    if setlist is None:
        raise _not_found()
    return setlist


@router.patch("/api/setlists/{setlist_id}", response_model=SetlistDetail, tags=["setlists"], responses=AUTH_RESPONSES)
def rename_setlist(
    setlist_id: str,
    body: RenameSetlistBody,
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
):
    setlist = _repo(ctx).rename(user.user_id, setlist_id, body.name)
    if setlist is None:
        raise _not_found()
    return setlist


@router.put(
    "/api/setlists/{setlist_id}/entries",
    response_model=SetlistDetail,
    tags=["setlists"],
    responses=AUTH_RESPONSES,
)
def replace_entries(
    setlist_id: str,
    body: ReplaceEntriesBody,
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
):
    """Replace the running order: the list sent is the whole list, in order. Used to reorder, remove and edit."""
    try:
        setlist = _repo(ctx).replace_entries(user.user_id, setlist_id, _entries(body.entries))
    except (UnknownSongs, TooManyEntries) as exc:
        raise _entry_error(exc) from exc
    if setlist is None:
        raise _not_found()
    return setlist


@router.post(
    "/api/setlists/{setlist_id}/entries",
    status_code=201,
    response_model=SetlistDetail,
    tags=["setlists"],
    responses=AUTH_RESPONSES,
)
def add_entry(
    setlist_id: str,
    body: SetlistEntryBody,
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
):
    """Add one song to the end of the setlist."""
    try:
        setlist = _repo(ctx).append_entry(user.user_id, setlist_id, EntryInput(body.song_id, body.note, body.transpose))
    except (UnknownSongs, TooManyEntries) as exc:
        raise _entry_error(exc) from exc
    if setlist is None:
        raise _not_found()
    return setlist


@router.delete(
    "/api/setlists/{setlist_id}", status_code=204, response_model=None, tags=["setlists"], responses=AUTH_RESPONSES
)
def delete_setlist(setlist_id: str, ctx: AppContext = Depends(context), user: Principal = Depends(principal)):
    if not _repo(ctx).delete_setlist(user.user_id, setlist_id):
        raise _not_found()
    return Response(status_code=204)
