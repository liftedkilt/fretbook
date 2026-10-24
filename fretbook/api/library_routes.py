"""Band libraries: membership, and copying or moving a song between libraries."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from fretbook.api.deps import context, principal, require_song
from fretbook.api.errors import api_error
from fretbook.api.schemas import AUTH_RESPONSES, LibraryMember, LibrarySummary, SongDetail
from fretbook.auth.base import Principal
from fretbook.context import AppContext

router = APIRouter()


class _Body(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)


class LibraryNameBody(_Body):
    name: str = Field(max_length=80)


class MemberBody(_Body):
    email: str = Field(max_length=320)
    role: str = Field(pattern="^(view|edit)$")


class MemberRoleBody(_Body):
    role: str = Field(pattern="^(view|edit)$")


class LibraryTargetBody(_Body):
    library_id: str = Field(min_length=1, max_length=64)


def _libraries(ctx: AppContext):
    if ctx.libraries is None:
        raise api_error(404, "library.notFound", "that library was not found")
    return ctx.libraries


@router.get("/api/libraries", response_model=list[LibrarySummary], tags=["libraries"], responses=AUTH_RESPONSES)
def list_libraries(ctx: AppContext = Depends(context), user: Principal = Depends(principal)) -> JSONResponse:
    """Libraries the caller belongs to, personal library first."""
    return JSONResponse(_libraries(ctx).list_for(user.user_id))


@router.post(
    "/api/libraries",
    status_code=201,
    response_model=LibrarySummary,
    tags=["libraries"],
    responses=AUTH_RESPONSES,
)
def create_library(
    body: LibraryNameBody, ctx: AppContext = Depends(context), user: Principal = Depends(principal)
) -> JSONResponse:
    """Create a band library. The caller can edit it."""
    return JSONResponse(_libraries(ctx).create_band(user.user_id, body.name), status_code=201)


@router.patch(
    "/api/libraries/{library_id}",
    response_model=LibrarySummary,
    tags=["libraries"],
    responses=AUTH_RESPONSES,
)
def rename_library(
    library_id: str,
    body: LibraryNameBody,
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
) -> JSONResponse:
    """Rename a band. A personal library keeps the account's name."""
    return JSONResponse(_libraries(ctx).rename(user.user_id, library_id, body.name))


@router.delete(
    "/api/libraries/{library_id}",
    status_code=204,
    response_model=None,
    tags=["libraries"],
    responses=AUTH_RESPONSES,
)
def delete_library(
    library_id: str, ctx: AppContext = Depends(context), user: Principal = Depends(principal)
) -> Response:
    """Delete an empty band. A band that still has songs is refused."""
    _libraries(ctx).delete_band(user.user_id, library_id)
    return Response(status_code=204)


@router.get(
    "/api/libraries/{library_id}/members",
    response_model=list[LibraryMember],
    tags=["libraries"],
    responses=AUTH_RESPONSES,
)
def list_members(
    library_id: str, ctx: AppContext = Depends(context), user: Principal = Depends(principal)
) -> JSONResponse:
    """Members of a library the caller belongs to. Email addresses are not included."""
    return JSONResponse(_libraries(ctx).members(user.user_id, library_id))


@router.post(
    "/api/libraries/{library_id}/members",
    status_code=201,
    response_model=LibraryMember,
    tags=["libraries"],
    responses=AUTH_RESPONSES,
)
def add_member(
    library_id: str,
    body: MemberBody,
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
) -> JSONResponse:
    """Add someone by the email on their account. The address must match exactly one account."""
    return JSONResponse(
        _libraries(ctx).add_member(user.user_id, library_id, body.email, body.role),
        status_code=201,
    )


@router.patch(
    "/api/libraries/{library_id}/members/{member_id}",
    response_model=LibraryMember,
    tags=["libraries"],
    responses=AUTH_RESPONSES,
)
def set_member_role(
    library_id: str,
    member_id: str,
    body: MemberRoleBody,
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
) -> JSONResponse:
    """Change a member's role. The last person who can edit cannot be demoted."""
    return JSONResponse(_libraries(ctx).set_member_role(user.user_id, library_id, member_id, body.role))


@router.delete(
    "/api/libraries/{library_id}/members/{member_id}",
    status_code=204,
    response_model=None,
    tags=["libraries"],
    responses=AUTH_RESPONSES,
)
def remove_member(
    library_id: str,
    member_id: str,
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
) -> Response:
    """Remove a member. The last person who can edit cannot be removed."""
    _libraries(ctx).remove_member(user.user_id, library_id, member_id)
    return Response(status_code=204)


@router.post(
    "/api/songs/{song_id}/copy",
    status_code=201,
    response_model=SongDetail,
    tags=["libraries"],
    responses=AUTH_RESPONSES,
)
def copy_song(
    song_id: str,
    body: LibraryTargetBody,
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
) -> JSONResponse:
    """Copy a song the caller can read into a library they can edit, including its audio."""
    require_song(ctx, user.user_id, song_id)
    return JSONResponse(_libraries(ctx).copy_song(user.user_id, song_id, body.library_id), status_code=201)


@router.post(
    "/api/songs/{song_id}/move",
    response_model=SongDetail,
    tags=["libraries"],
    responses=AUTH_RESPONSES,
)
def move_song(
    song_id: str,
    body: LibraryTargetBody,
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
) -> JSONResponse:
    """Move a song into another library. The caller must be able to edit both."""
    require_song(ctx, user.user_id, song_id, write=True)
    return JSONResponse(_libraries(ctx).move_song(user.user_id, song_id, body.library_id))
