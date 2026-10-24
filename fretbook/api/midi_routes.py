"""MIDI: look inside a file before importing it, import chosen tracks, and export a tab as MIDI.

The browser sends the file to ``inspect`` first to list its tracks, then sends it again to the import endpoint with
the tracks, instruments and grid the reader chose. MIDI files are small, so uploading twice keeps the server free of
temporary state. Anything that skips the dialog (bulk imports, `/api/imports/auto`) takes the importer's defaults
instead.
"""

from __future__ import annotations

import json
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from fretbook.api.deps import context, principal, require_song
from fretbook.api.errors import api_error
from fretbook.api.routes import _safe_name, _spool
from fretbook.api.schemas import AUTH_RESPONSES, JobAccepted
from fretbook.auth.base import Principal
from fretbook.context import AppContext
from fretbook.export.midi import to_midi
from fretbook.importers import midi
from fretbook.importers.base import ImportError
from fretbook.score.model import ScoreDocument

router = APIRouter()


class MidiTrackInfo(BaseModel):
    id: str
    """Pass this in ``tracks`` to import the part. It is ``<midi track>:<channel>``."""
    name: str
    channel: int
    """1 to 16."""
    program: int | None
    notes: int
    lowest: int
    highest: int
    in_range: bool
    """Most of its notes lie within the reach of a guitar or bass."""
    suggested_preset: str
    selected: bool
    """Whether the importer picks this part when no tracks are chosen."""


class MidiInspection(BaseModel):
    title: str
    bpm: float
    signature: tuple[int, int]
    drum_notes: int
    """Notes on the drum channel, which are never imported."""
    tracks: list[MidiTrackInfo]


class MidiImportOptions(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    tracks: list[str] | None = Field(default=None, max_length=64)
    """Parts to import, by ``MidiTrackInfo.id``. Left out, the parts marked ``selected`` are imported."""
    preset: str | None = None
    """One instrument preset id for every chosen part. Left out, each part gets its ``suggested_preset``."""
    presets: dict[str, str] = Field(default_factory=dict, max_length=64)
    """Instrument preset per part id, overriding ``preset``."""
    capo: int = Field(default=0, ge=0, le=24)
    grid: Literal[4, 8, 16, 32] = 16
    """Note value positions snap to: 4 = quarter, 16 = sixteenth."""


@router.post(
    "/api/imports/midi/inspect",
    response_model=MidiInspection,
    tags=["imports"],
    responses=AUTH_RESPONSES,
)
async def inspect_midi(file: UploadFile = File(...), _user: Principal = Depends(principal)) -> MidiInspection:
    """List the parts of a MIDI file (name, channel, notes, pitch range, suggested instrument) without saving it."""
    data = await file.read(midi.MAX_BYTES + 1)
    if not data:
        raise api_error(400, "upload.empty", "empty file")
    try:
        parsed = midi.read_midi(data=data, filename=file.filename or "")
    except ImportError as exc:
        raise api_error(400, exc.key, str(exc), **exc.params) from exc
    selected = set(parsed.default_selection())
    return MidiInspection(
        title=parsed.title,
        bpm=parsed.opening_bpm,
        signature=parsed.opening_signature,
        drum_notes=parsed.drum_notes,
        tracks=[
            MidiTrackInfo(
                id=source.id,
                name=source.name,
                channel=source.channel + 1,
                program=source.program,
                notes=len(source.notes),
                lowest=source.lowest,
                highest=source.highest,
                in_range=source.in_range,
                suggested_preset=source.suggested_preset,
                selected=source.id in selected,
            )
            for source in parsed.sources
        ],
    )


@router.post(
    "/api/imports/midi",
    status_code=202,
    response_model=JobAccepted,
    tags=["imports"],
    responses=AUTH_RESPONSES,
)
async def import_midi(
    file: UploadFile = File(...),
    options: str = Form(default="{}", max_length=20_000),
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
) -> JSONResponse:
    """Queue the import of a MIDI file with the chosen parts, instruments and grid.

    `options` is a JSON object (see `MidiImportOptions`). Frets are assigned automatically from the instrument's
    tuning and the capo, keeping the hand close to where it was.
    """
    try:
        chosen = MidiImportOptions.model_validate(json.loads(options or "{}"))
    except (ValueError, ValidationError) as exc:
        raise api_error(400, "midi.badOptions", "the MIDI import options are not valid") from exc
    filename = file.filename or "upload.mid"
    path = ctx.settings.inbox_dir / f"{uuid.uuid4().hex}-{_safe_name(filename)}"
    await _spool(file, path, min(ctx.settings.max_upload_bytes, midi.MAX_BYTES))
    job_id = ctx.jobs.enqueue(
        user.user_id,
        "import.file",
        {
            "path": str(path),
            "filename": filename,
            "kind": "midi",
            "midi": chosen.model_dump(exclude_none=True),
        },
    )
    return JSONResponse({"job_id": job_id}, status_code=202)


@router.get(
    "/api/songs/{song_id}/export.mid",
    tags=["songs"],
    responses={
        **AUTH_RESPONSES,
        200: {
            "description": "A Standard MIDI File for a tab, as an attachment.",
            "content": {"audio/midi": {"schema": {"type": "string", "format": "binary"}}},
        },
    },
)
def export_midi(song_id: str, ctx: AppContext = Depends(context), user: Principal = Depends(principal)) -> Response:
    """Download a tab as a Standard MIDI File, with repeats expanded. Chord sheets cannot be exported."""
    song = require_song(ctx, user.user_id, song_id)
    if song["content_kind"] != "tab":
        raise api_error(400, "export.notTab", "only tabs export as MIDI")
    document = ScoreDocument.model_validate(song["document"])
    return Response(
        to_midi(document, title=song["title"]),
        media_type="audio/midi",
        headers={"Content-Disposition": f'attachment; filename="{song["slug"]}.mid"'},
    )
