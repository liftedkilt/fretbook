"""A song's metadata (key, genre, year, album, notes) and cover art. Like tags, none of it changes the revision."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from fretbook import metadata as song_metadata
from fretbook.api.deps import context, principal, require_song
from fretbook.api.errors import api_error
from fretbook.api.schemas import AUTH_RESPONSES, LibraryFacets, SongDetail
from fretbook.auth.base import Principal
from fretbook.context import AppContext
from fretbook.importers.base import ImportError
from fretbook.storage.repository import METADATA_TEXT_LIMITS, YEAR_RANGE

router = APIRouter()

_COVER_RESPONSE: dict[int | str, dict[str, Any]] = {
    200: {
        "description": "The song's cover image.",
        "content": {
            kind: {"schema": {"type": "string", "format": "binary"}}
            for kind in ("image/png", "image/jpeg", "image/webp")
        },
    }
}


class MetadataBody(BaseModel):
    """Fields left out stay as they are. Send an empty string (or `null` for `year`) to clear one."""

    model_config = ConfigDict(allow_inf_nan=False)

    key: str | None = Field(default=None, max_length=40)
    """A key such as `C`, `F#m`, `Bb minor`. Empty falls back to the key detected from the score."""
    genre: str | None = Field(default=None, max_length=500)
    album: str | None = Field(default=None, max_length=1000)
    year: int | None = None
    notes: str | None = Field(default=None, max_length=100_000)
    """Personal notes as Markdown."""


@router.patch("/api/songs/{song_id}/metadata", response_model=SongDetail, tags=["songs"], responses=AUTH_RESPONSES)
def update_metadata(
    song_id: str, body: MetadataBody, ctx: AppContext = Depends(context), user: Principal = Depends(principal)
) -> JSONResponse:
    """Set the song's key, genre, year, album and notes. Leaves the revision alone, so it never conflicts."""
    require_song(ctx, user.user_id, song_id)
    sent = {name: getattr(body, name) for name in body.model_fields_set}
    try:
        changes = song_metadata.clean_metadata(sent, METADATA_TEXT_LIMITS, YEAR_RANGE)
    except song_metadata.MetadataError as exc:
        raise api_error(422, "metadata.invalid", str(exc), field=exc.field) from exc
    ctx.songs.set_metadata(user.user_id, song_id, changes)
    return JSONResponse(require_song(ctx, user.user_id, song_id))


@router.get("/api/library/facets", response_model=LibraryFacets, tags=["songs"], responses=AUTH_RESPONSES)
def library_facets(ctx: AppContext = Depends(context), user: Principal = Depends(principal)) -> JSONResponse:
    """The keys and genres in the caller's library with how many songs have each, for the library filters."""
    return JSONResponse(ctx.songs.facets(user.user_id))


@router.post("/api/songs/{song_id}/cover", response_model=SongDetail, tags=["songs"], responses=AUTH_RESPONSES)
async def upload_cover(
    song_id: str,
    file: UploadFile = File(...),
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
) -> JSONResponse:
    """Replace the song's cover art with a PNG, JPEG or WebP image of at most 5 MB. SVG is refused."""
    require_song(ctx, user.user_id, song_id)
    data = await file.read(song_metadata.MAX_COVER_BYTES + 1)
    if len(data) > song_metadata.MAX_COVER_BYTES:
        raise api_error(413, "upload.tooLarge", "file is too large", limit=song_metadata.MAX_COVER_BYTES)
    kind = song_metadata.sniff_cover(data)
    if kind is None:
        raise api_error(400, "cover.notImage", "upload a png, jpeg or webp image")
    suffix, content_type = kind
    ctx.media.save(
        user.user_id,
        song_id,
        kind="cover",
        filename=f"cover{suffix}",
        content_type=content_type,
        data=data,
        replace_kind=True,
    )
    return JSONResponse(require_song(ctx, user.user_id, song_id))


@router.get("/api/songs/{song_id}/cover", tags=["songs"], responses={**AUTH_RESPONSES, **_COVER_RESPONSE})
def download_cover(
    song_id: str, ctx: AppContext = Depends(context), user: Principal = Depends(principal)
) -> FileResponse:
    require_song(ctx, user.user_id, song_id)
    row = ctx.media.latest_of_kind(user.user_id, song_id, "cover")
    if row is None:
        raise api_error(404, "cover.none", "this song has no cover art")
    path = ctx.media.path_for(row)
    if not path.is_file():
        raise api_error(404, "cover.missing", "cover file is missing")
    return FileResponse(
        path,
        media_type=row["content_type"],
        headers={"Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"},
    )


@router.delete("/api/songs/{song_id}/cover", response_model=SongDetail, tags=["songs"], responses=AUTH_RESPONSES)
def delete_cover(
    song_id: str, ctx: AppContext = Depends(context), user: Principal = Depends(principal)
) -> JSONResponse:
    """Remove the uploaded cover art; the song goes back to its generated cover."""
    require_song(ctx, user.user_id, song_id)
    ctx.media.delete_kind(user.user_id, song_id, "cover")
    return JSONResponse(require_song(ctx, user.user_id, song_id))


@router.post(
    "/api/songs/{song_id}/metadata/lookup", response_model=SongDetail, tags=["songs"], responses=AUTH_RESPONSES
)
def lookup_metadata(
    song_id: str, ctx: AppContext = Depends(context), user: Principal = Depends(principal)
) -> JSONResponse:
    """Fill in the album, year and cover art from MusicBrainz and the Cover Art Archive, by artist and title.

    Only empty fields are filled; what the caller set stays. A 404 `metadata.lookupDisabled` means
    `FRETBOOK_METADATA_LOOKUP` is off, and `metadata.notFound` that nothing matched.
    """
    song = require_song(ctx, user.user_id, song_id)
    if not ctx.settings.metadata_lookup or ctx.fetcher is None:
        raise api_error(404, "metadata.lookupDisabled", "online metadata lookup is turned off")
    try:
        found = song_metadata.lookup(ctx.fetcher, song["title"], song["artist"])
    except ImportError as exc:
        raise api_error(502, "metadata.lookupFailed", "could not reach the metadata service") from exc
    if found is None:
        raise api_error(404, "metadata.notFound", "no matching recording was found")
    changes: dict[str, object] = {}
    if found.album and not song["album"]:
        changes["album"] = found.album
    if found.year and not song["year"]:
        changes["year"] = found.year
    if changes:
        ctx.songs.set_metadata(user.user_id, song_id, changes)
    if found.cover and not song["cover_url"]:
        kind = song_metadata.sniff_cover(found.cover)
        if kind:
            ctx.media.save(
                user.user_id,
                song_id,
                kind="cover",
                filename=f"cover{kind[0]}",
                content_type=kind[1],
                data=found.cover,
                replace_kind=True,
            )
    return JSONResponse(require_song(ctx, user.user_id, song_id))
