"""Response models for the OpenAPI contract.

Routes return the same dicts as before (see ``_json`` in ``routes``). These
models only describe those payloads so ``openapi.json`` is a usable frontend
reference. They are not a second validator on the way out.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from fretbook.score.model import ScoreDocument

ContentKind = Literal["tab", "chords"]


class ErrorDetail(BaseModel):
    """Translatable message. Shape: ``{key, message, params}``.

    The UI looks ``key`` up under ``errors`` in its catalogs and falls back to
    the English ``message``. ``params`` fills ``{name}`` placeholders.
    """

    key: str
    message: str
    params: dict[str, Any] = Field(default_factory=dict)


class ErrorBody(BaseModel):
    """Error response. ``detail`` is ``{key, message, params}``."""

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "detail": {
                        "key": "song.notFound",
                        "message": "song not found",
                        "params": {},
                    }
                }
            ]
        }
    )

    detail: ErrorDetail


class ValidationIssue(BaseModel):
    """One rejected field. The handler omits the submitted value."""

    type: str | None = None
    loc: list[str | int] = Field(default_factory=list)
    msg: str | None = None


class ValidationBody(BaseModel):
    """Request validation failed (HTTP 422). ``detail`` is a list of issues, not a keyed error."""

    detail: list[ValidationIssue]


class PlainErrorBody(BaseModel):
    """An error whose ``detail`` is a plain string (OIDC is not implemented, HTTP 501)."""

    detail: str


class Health(BaseModel):
    ok: bool
    name: str
    version: str


class InstrumentPreset(BaseModel):
    id: str
    label_key: str
    label: str
    instrument: str
    name: str
    tuning_midi: list[int]
    string_count: int
    family: Literal["bass", "guitar"]


class Meta(BaseModel):
    """Server identity. ``auth_mode`` is ``single`` or ``oidc``."""

    name: str
    tagline: str
    version: str
    auth_mode: str
    exporters: list[str]
    instruments: list[InstrumentPreset]


class Settings(BaseModel):
    """Per-user preferences. ``default_instrument`` is a preset id from ``GET /api/meta``."""

    default_instrument: str


class Me(BaseModel):
    """The caller. In single-user mode this is the ``local`` user and ``authenticated`` is false."""

    user_id: str
    display_name: str
    authenticated: bool
    settings: Settings


class SongSummary(BaseModel):
    id: str
    slug: str
    title: str
    artist: str
    content_kind: ContentKind
    source_kind: str
    revision: int
    bpm: float
    measure_count: int
    track_count: int
    string_count: int
    preferred_instrument: str
    has_sync: bool
    has_audio: bool
    # Null when the song has no published sync points. Always present in the JSON.
    duration: float | None
    updated_at: str


class SongDetail(SongSummary):
    source_ref: dict[str, Any]
    # A tab has a document and a null chordpro; a chord sheet is the opposite. Both keys are present.
    document: ScoreDocument | None
    chordpro: str | None
    created_at: str
    audio_url: str | None
    preferred_track_id: str


class SongExport(BaseModel):
    """Attachment from ``GET /api/songs/{song_id}/export.json``.

    A tab includes ``document`` and omits ``chordpro``. A chord sheet does the opposite.
    """

    format: Literal["fretbook-song"]
    format_version: Literal[1]
    content_kind: ContentKind
    title: str
    artist: str
    document: ScoreDocument | None = None
    chordpro: str | None = None


class JobResult(BaseModel):
    model_config = ConfigDict(extra="allow")

    song_id: str | None = None
    slug: str | None = None
    content_kind: ContentKind | None = None
    warnings: list[ErrorDetail] = Field(default_factory=list)


class Job(BaseModel):
    """Background import. ``error_key`` is an ``errors`` catalog key; ``progress_key`` is a catalog key."""

    id: str
    kind: str
    status: Literal["queued", "running", "done", "error"]
    # Null until the job finishes successfully. The key is always present.
    result: JobResult | None
    error: str | None
    error_key: str
    error_params: dict[str, Any]
    progress: str
    progress_key: str
    created_at: str
    updated_at: str


class JobAccepted(BaseModel):
    """Accepted import. Poll ``GET /api/jobs/{job_id}``."""

    job_id: str


class SongsterrTrackChoice(BaseModel):
    """One fretted Songsterr part from ``POST /api/imports/preview``."""

    part_id: int
    name: str
    instrument: str
    canonical_instrument: str
    is_bass: bool
    is_guitar: bool
    tuning: list[int]
    string_count: int
    capo: int


class ImportPreview(BaseModel):
    """Fretted tracks on a Songsterr link, before the import is queued."""

    title: str
    artist: str
    song_id: int
    tracks: list[SongsterrTrackChoice]


_KEYED = "Keyed error. `detail` is {key, message, params}."

ERROR_RESPONSES: dict[int, dict[str, Any]] = {
    400: {"model": ErrorBody, "description": _KEYED},
    404: {"model": ErrorBody, "description": _KEYED},
    409: {"model": ErrorBody, "description": _KEYED + " `params.current` is the stored revision."},
    413: {"model": ErrorBody, "description": _KEYED},
    422: {
        "model": ValidationBody,
        "description": "Validation failed. `detail` is a list of {type, loc, msg}, not a keyed error.",
    },
}

# Authenticated routes raise this when FRETBOOK_AUTH_MODE=oidc and sign-in is not built.
AUTH_RESPONSES: dict[int, dict[str, Any]] = {
    **ERROR_RESPONSES,
    501: {
        "model": PlainErrorBody,
        "description": (
            "OIDC sign-in is not implemented. `detail` is a string. "
            "Unset FRETBOOK_AUTH_MODE to use single-user mode."
        ),
    },
}
