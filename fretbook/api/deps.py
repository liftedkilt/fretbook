from __future__ import annotations

from fastapi import Request

from fretbook.api.errors import api_error
from fretbook.auth.base import Principal
from fretbook.context import AppContext
from fretbook.storage.users import TOKEN_PREFIX


def context(request: Request) -> AppContext:
    return request.app.state.ctx


def bearer_token(request: Request) -> str | None:
    """The Fretbook token in an ``Authorization: Bearer`` header, or ``None`` when there is none.

    Only ``fb_`` credentials count: an auth proxy may forward its own bearer token on every request.
    """
    scheme, _, credential = request.headers.get("authorization", "").partition(" ")
    credential = credential.strip()
    return credential if scheme.lower() == "bearer" and credential.startswith(TOKEN_PREFIX) else None


def principal(request: Request) -> Principal:
    """The caller: the owner of a personal API token if the request carries one, else the auth backend's user.

    A bad bearer token is refused outright rather than falling back to a cookie.
    """
    ctx = context(request)
    token = bearer_token(request)
    if token is None:
        return ctx.auth.authenticate(request)
    owner = ctx.users.find_token_owner(token)
    if owner is None:
        raise api_error(401, "auth.invalidToken", "the API token is invalid, expired, or revoked")
    return Principal(
        user_id=owner["user_id"],
        display_name=owner["display_name"],
        authenticated=ctx.settings.oidc_enabled,
        # Single-user mode has no admin, whatever the stored role.
        role=owner["role"] if ctx.settings.oidc_enabled else "user",
        email=owner["email"],
        via_token=True,
    )


def admin(request: Request) -> Principal:
    user = principal(request)
    if not user.is_admin:
        raise api_error(403, "auth.adminOnly", "only administrators can do this")
    return user


def require_song(ctx: AppContext, owner_id: str, song_id: str, *, write: bool = False) -> dict:
    song = ctx.songs.get_song(owner_id, song_id)
    if song is None:
        raise api_error(404, "song.notFound", "song not found")
    if write and song.get("library_role") != "edit":
        raise api_error(403, "library.readOnly", "you can view this song but not change it")
    return song


def require_library(ctx: AppContext, user_id: str, library_id: str | None, *, write: bool = False) -> str:
    """The library to list or create in. Empty means the caller's personal library.

    A library the caller is not in, and one that does not exist, are both 404.
    """
    target = (library_id or "").strip() or user_id
    if ctx.libraries is None:
        raise api_error(404, "library.notFound", "that library was not found")
    ctx.libraries.require(user_id, target, write=write)
    return target
