"""Tags and favourites. They are the caller's own and never change a song's revision."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from fretbook.api.deps import context, principal, require_library, require_song
from fretbook.api.errors import api_error
from fretbook.api.schemas import AUTH_RESPONSES, Favourite, SongTags, TagCount, TagsAdded, TagsChanged
from fretbook.auth.base import Principal
from fretbook.context import AppContext
from fretbook.tags import clean_tag

router = APIRouter()


class _Body(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)


class SetTagsBody(_Body):
    tags: list[str] = Field(max_length=100)
    """The song's whole tag list.

    Tags are trimmed and cut to 40 characters, blanks and repeats (ignoring case) are dropped, and a song keeps
    its first 30.
    """


class AddTagsBody(_Body):
    song_ids: list[str] = Field(min_length=1, max_length=500)
    tags: list[str] = Field(min_length=1, max_length=50)


class RenameTagBody(_Body):
    name: str = Field(max_length=200)
    """The new name. Trimmed and cut to 40 characters. If another tag already has it (ignoring case), the two merge."""


class FavouriteBody(_Body):
    favourite: bool


@router.get("/api/tags", response_model=list[TagCount], tags=["tags"], responses=AUTH_RESPONSES)
def list_tags(
    library: str | None = Query(None, max_length=64, description="Library to read. Omit it for the personal library."),
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
) -> JSONResponse:
    """Every tag on a library's songs with how many songs use it, most used first."""
    return JSONResponse(ctx.songs.list_tags(require_library(ctx, user.user_id, library)))


@router.put("/api/songs/{song_id}/tags", response_model=SongTags, tags=["tags"], responses=AUTH_RESPONSES)
def set_song_tags(
    song_id: str, body: SetTagsBody, ctx: AppContext = Depends(context), user: Principal = Depends(principal)
) -> JSONResponse:
    """Replace the song's tags."""
    require_song(ctx, user.user_id, song_id, write=True)
    tags = ctx.songs.set_tags(user.user_id, song_id, body.tags)
    if tags is None:
        raise api_error(404, "song.notFound", "song not found")
    return JSONResponse({"tags": tags})


@router.post("/api/tags/add", response_model=TagsAdded, tags=["tags"], responses=AUTH_RESPONSES)
def add_tags(
    body: AddTagsBody, ctx: AppContext = Depends(context), user: Principal = Depends(principal)
) -> JSONResponse:
    """Add tags to many songs at once. Songs that are not the caller's are skipped."""
    return JSONResponse({"updated": ctx.songs.add_tags(user.user_id, body.song_ids, body.tags)})


@router.put("/api/songs/{song_id}/favourite", response_model=Favourite, tags=["tags"], responses=AUTH_RESPONSES)
def set_favourite(
    song_id: str, body: FavouriteBody, ctx: AppContext = Depends(context), user: Principal = Depends(principal)
) -> JSONResponse:
    """Star or unstar a song."""
    require_song(ctx, user.user_id, song_id, write=True)
    ctx.songs.set_favourite(user.user_id, song_id, body.favourite)
    return JSONResponse({"favourite": body.favourite})


@router.patch("/api/tags/{tag:path}", response_model=TagsChanged, tags=["tags"], responses=AUTH_RESPONSES)
def rename_tag(
    tag: str,
    body: RenameTagBody,
    library: str | None = Query(None, max_length=64),
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
) -> JSONResponse:
    """Rename a tag on all the caller's songs, or merge it into another tag that has the new name.

    The tag is matched ignoring case. A song that ends up with the tag twice keeps one.
    """
    name = clean_tag(body.name)
    if not name:
        raise api_error(422, "tag.nameEmpty", "tag name is empty")
    updated = ctx.songs.rename_tag(require_library(ctx, user.user_id, library, write=True), tag, name)
    if updated is None:
        raise api_error(404, "tag.notFound", "tag not found")
    return JSONResponse({"updated": updated})


@router.delete("/api/tags/{tag:path}", response_model=TagsChanged, tags=["tags"], responses=AUTH_RESPONSES)
def delete_tag(
    tag: str,
    library: str | None = Query(None, max_length=64),
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
) -> JSONResponse:
    """Remove a tag from all the songs in a library the caller can edit."""
    updated = ctx.songs.delete_tag(require_library(ctx, user.user_id, library, write=True), tag)
    if updated == 0:
        raise api_error(404, "tag.notFound", "tag not found")
    return JSONResponse({"updated": updated})
