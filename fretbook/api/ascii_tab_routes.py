"""Paste ASCII tab: a live preview, and saving the pasted text as a song.

The same text may be a tab or a chords-over-lyrics sheet, so both endpoints
decide with :func:`fretbook.importers.ascii_tab.looks_like_ascii_tab` and send a
chord sheet through the ChordPro conversion instead.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from fretbook.api.deps import context, principal
from fretbook.api.errors import api_error
from fretbook.api.schemas import AUTH_RESPONSES, ErrorDetail, SongDetail
from fretbook.auth.base import Principal
from fretbook.chords import chordpro
from fretbook.context import AppContext
from fretbook.importers import ascii_tab
from fretbook.importers.base import ImportError, Notice
from fretbook.score.model import ScoreDocument

router = APIRouter()


class AsciiTabBody(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    text: str = Field(max_length=ascii_tab.MAX_CHARS)
    title: str = Field(default="", max_length=300)
    artist: str = Field(default="", max_length=300)
    grid: Literal[4, 8, 16, 32] = 8
    """Note value positions snap to: 4 = quarter, 8 = eighth, 16 = sixteenth, 32 = thirty-second."""
    signature: tuple[int, int] = (4, 4)
    bpm: float | None = Field(default=None, gt=0, lt=400)
    """Tempo. A tempo written in the text is used when this is empty."""


class AsciiTabPreview(BaseModel):
    """What the pasted text becomes. A tab has ``document``; a chord sheet has ``chordpro``."""

    content_kind: Literal["tab", "chords"]
    title: str
    artist: str
    document: ScoreDocument | None
    chordpro: str | None
    rhythm_estimated: bool
    warnings: list[ErrorDetail]


@dataclass
class _Converted:
    content_kind: Literal["tab", "chords"]
    title: str
    artist: str
    document: ScoreDocument | None = None
    chordpro: str | None = None
    warnings: list[Notice] | None = None


def _convert(body: AsciiTabBody) -> _Converted:
    if not body.text.strip():
        raise api_error(400, "asciiTab.empty", "paste some tab first")
    numerator, denominator = body.signature
    if not 1 <= numerator <= 32 or denominator not in {1, 2, 4, 8, 16, 32}:
        raise api_error(400, "song.badSignature", "invalid time signature")
    if not ascii_tab.looks_like_ascii_tab(body.text):
        try:
            text = chordpro.normalize(body.text, title=body.title.strip(), artist=body.artist.strip())
        except ValueError as exc:
            raise api_error(400, "chords.tooLong", str(exc), limit=chordpro.MAX_CHARS) from exc
        found = chordpro.metadata(text)
        return _Converted(
            "chords",
            body.title.strip() or found.get("title", ""),
            body.artist.strip() or found.get("artist", ""),
            chordpro=text,
            warnings=[],
        )
    try:
        parsed = ascii_tab.parse(body.text, grid=body.grid, signature=body.signature, bpm=body.bpm)
    except ImportError as exc:
        raise api_error(400, exc.key, str(exc), **exc.params) from exc
    return _Converted(
        "tab",
        body.title.strip() or parsed.title,
        body.artist.strip() or parsed.artist,
        document=parsed.document,
        warnings=parsed.warnings,
    )


def _details(warnings: list[Notice] | None) -> list[dict[str, Any]]:
    return [warning.as_dict() for warning in warnings or []]


@router.post(
    "/api/imports/ascii-tab/preview",
    response_model=AsciiTabPreview,
    tags=["imports"],
    responses=AUTH_RESPONSES,
)
def preview_ascii_tab(body: AsciiTabBody, _user: Principal = Depends(principal)) -> JSONResponse:
    """Convert pasted ASCII tab without saving it, so the browser can draw it before the song is created.

    Text that is chords over lyrics comes back as a chord sheet. Rhythm in a tab is estimated from spacing.
    """
    converted = _convert(body)
    return JSONResponse(
        {
            "content_kind": converted.content_kind,
            "title": converted.title,
            "artist": converted.artist,
            "document": converted.document.model_dump(mode="json") if converted.document else None,
            "chordpro": converted.chordpro,
            "rhythm_estimated": converted.document is not None,
            "warnings": _details(converted.warnings),
        }
    )


@router.post(
    "/api/imports/ascii-tab",
    status_code=201,
    response_model=SongDetail,
    tags=["imports"],
    responses=AUTH_RESPONSES,
)
def import_ascii_tab(
    body: AsciiTabBody, ctx: AppContext = Depends(context), user: Principal = Depends(principal)
) -> JSONResponse:
    """Save pasted ASCII tab as a song (a chord sheet when the text is chords over lyrics).

    A tab is stored with ``source_ref.rhythm_estimated`` set, so the song page can say the timing is a guess.
    """
    converted = _convert(body)
    title = converted.title or "Untitled"
    if converted.content_kind == "chords":
        saved = ctx.songs.create_song(
            user.user_id,
            title=title,
            artist=converted.artist,
            chordpro=converted.chordpro,
            source_kind="manual",
        )
    else:
        saved = ctx.songs.create_song(
            user.user_id,
            title=title,
            artist=converted.artist,
            document=converted.document,
            source_kind="ascii-tab",
            source_ref={"rhythm_estimated": True, "grid": body.grid},
        )
    return JSONResponse(saved, status_code=201)
