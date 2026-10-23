"""Tags and favourites. They are the caller's own and never change a song's revision."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from fretbook.api.deps import context, principal, require_song
from fretbook.api.errors import api_error
from fretbook.api.schemas import AUTH_RESPONSES, Favourite, SongTags, TagCount, TagsAdded
from fretbook.auth.base import Principal
from fretbook.context import AppContext

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


class FavouriteBody(_Body):
    favourite: bool


@router.get("/api/tags", response_model=list[TagCount], tags=["tags"], responses=AUTH_RESPONSES)
def list_tags(ctx: AppContext = Depends(context), user: Principal = Depends(principal)) -> JSONResponse:
    """Every tag on the caller's songs with how many songs use it, most used first."""
    return JSONResponse(ctx.songs.list_tags(user.user_id))


@router.put("/api/songs/{song_id}/tags", response_model=SongTags, tags=["tags"], responses=AUTH_RESPONSES)
def set_song_tags(
    song_id: str, body: SetTagsBody, ctx: AppContext = Depends(context), user: Principal = Depends(principal)
) -> JSONResponse:
    """Replace the song's tags."""
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
    require_song(ctx, user.user_id, song_id)
    ctx.songs.set_favourite(user.user_id, song_id, body.favourite)
    return JSONResponse({"favourite": body.favourite})
