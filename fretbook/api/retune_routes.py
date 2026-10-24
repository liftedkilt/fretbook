"""Transpose, retune and convert a tab's track: preview the result, then add it as a new track or replace the track.

The conversion itself is ``fretbook.score.retune``; this module is the thin, stateless wrapper. A preview saves
nothing. Saving needs the revision the client loaded, like any other edit, and a stale one is refused with 409.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from fretbook.api.deps import context, principal, require_song
from fretbook.api.errors import api_error
from fretbook.api.schemas import AUTH_RESPONSES, SongDetail
from fretbook.auth.base import Principal
from fretbook.context import AppContext
from fretbook.score.instruments import get_preset, is_preset
from fretbook.score.model import ScoreDocument, Track
from fretbook.score.retune import convert_track
from fretbook.storage.repository import RevisionConflict

router = APIRouter()


class ConvertBody(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    track_id: str = Field(max_length=64)
    """The track to convert."""
    mode: Literal["preview", "add", "replace"] = "preview"
    """``preview`` saves nothing; ``add`` saves a new track after the source; ``replace`` overwrites it."""
    revision: int | None = None
    """The revision the client loaded. Required for ``add`` and ``replace``."""
    semitones: int = Field(default=0, ge=-48, le=48)
    keep: Literal["pitch", "shape"] = "pitch"
    """``pitch``: sound the same on the new tuning or capo. ``shape``: keep the frets, so the pitch changes."""
    preset: str | None = None
    """Instrument preset to convert to (its tuning and instrument). Overridden by ``tuning_midi``."""
    tuning_midi: list[int] | None = Field(default=None, min_length=1, max_length=16)
    """New open-string pitches, highest string first."""
    capo: int | None = Field(default=None, ge=0, le=24)
    reduce: Literal["all", "lowest"] = "all"
    """``lowest`` keeps only the lowest note of each beat, a starting point for a bass line from a guitar part."""
    name: str | None = Field(default=None, max_length=80)
    instrument: str | None = Field(default=None, max_length=64)


class ConvertReport(BaseModel):
    notes: int
    refretted: int
    reduced: int
    shifted_bars: list[int]
    """Bars (1-based, at most 20) where the instrument cannot play a pitch, so it was moved by octaves."""
    dropped_bars: list[int]
    dropped: int
    techniques_dropped: int


class ConvertResult(BaseModel):
    track: Track
    """The converted track as it would be saved."""
    report: ConvertReport
    song: SongDetail | None = None
    """The saved song, for ``add`` and ``replace``."""


def _new_id(document: ScoreDocument, base: str) -> str:
    taken = {track.id for track in document.tracks}
    n = 2
    while f"{base}-{n}"[:64] in taken:
        n += 1
    return f"{base}-{n}"[:64]


@router.post(
    "/api/songs/{song_id}/convert",
    response_model=ConvertResult,
    tags=["songs"],
    responses=AUTH_RESPONSES,
)
def convert_song_track(
    song_id: str,
    body: ConvertBody,
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
) -> Any:
    """Transpose, retune or convert one track of a tab (see `ConvertBody`), optionally saving the result."""
    song = require_song(ctx, user.user_id, song_id)
    if song["content_kind"] != "tab":
        raise api_error(400, "convert.notTab", "only tabs can be converted")
    if body.mode != "preview" and body.revision is None:
        raise api_error(400, "convert.needsRevision", "send the revision you loaded to save a conversion")
    document = ScoreDocument.model_validate(song["document"])
    source = next((track for track in document.tracks if track.id == body.track_id), None)
    if source is None:
        raise api_error(404, "convert.noTrack", "track not found")

    tuning = body.tuning_midi
    instrument = body.instrument
    if body.preset is not None:
        if not is_preset(body.preset):
            raise api_error(400, "convert.badPreset", "unknown instrument preset")
        preset = get_preset(body.preset)
        tuning = tuning or list(preset.tuning_midi)
        instrument = instrument or preset.instrument
    if tuning is not None and any(not 0 <= pitch <= 127 for pitch in tuning):
        raise api_error(400, "convert.badTuning", "tuning pitches must be MIDI notes from 0 to 127")
    try:
        result = convert_track(
            source,
            semitones=body.semitones,
            tuning=tuning,
            capo=body.capo,
            keep=body.keep,
            reduce=body.reduce,
        )
    except ValueError as exc:
        raise api_error(400, "convert.invalid", str(exc)) from exc

    converted = result.track
    if instrument:
        converted.instrument = instrument
    saved: dict[str, Any] | None = None
    if body.mode == "replace":
        converted.name = body.name or source.name
        document.tracks[document.tracks.index(source)] = converted
    elif body.mode == "add":
        converted.id = _new_id(document, source.id)
        converted.name = body.name or f"{source.name} (converted)"
        converted.preferred = False
        document.tracks.insert(document.tracks.index(source) + 1, converted)
    else:
        converted.name = body.name or source.name
    if body.mode != "preview":
        try:
            saved = ctx.songs.update_song(
                user.user_id,
                song_id,
                title=song["title"],
                artist=song["artist"],
                revision=body.revision,
                document=document,
            )
        except RevisionConflict as exc:
            raise api_error(409, "song.conflict", "this song changed since you opened it", current=exc.current) from exc
        if saved is None:
            raise api_error(404, "song.notFound", "song not found")
    return {"track": converted, "report": result.report.__dict__, "song": saved}
