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


class YtDlpStatus(BaseModel):
    """The yt-dlp that downloads audio. ``stale`` means its release is more than 30 days old."""

    version: str | None
    released: str | None
    age_days: int | None
    stale: bool
    auto_update: bool
    cookies: bool


class Meta(BaseModel):
    """Server identity. ``auth_mode`` is ``single`` or ``oidc``.

    ``commit`` is the git SHA of a non-release image build. It is ``null`` for a release (``v*`` tag) or a
    source checkout.
    """

    name: str
    tagline: str
    version: str
    commit: str | None
    auth_mode: str
    exporters: list[str]
    instruments: list[InstrumentPreset]
    ytdlp: YtDlpStatus
    worker_kinds: list[str]
    """Job kinds that a separate worker process is claiming right now. Hide features whose kind is missing."""


class Settings(BaseModel):
    """Per-user preferences. ``default_instrument`` is a preset id from ``GET /api/meta``."""

    default_instrument: str


class AudioCalibration(BaseModel):
    """Measured or manual audio latency calibration for an output/input device pair."""

    output_device: str
    input_device: str
    offset_ms: float
    jitter_ms: float | None = None
    updated_at: str


class AudioCalibrationBody(BaseModel):
    """Request body to record or update an audio latency calibration."""

    output_device: str = "default"
    input_device: str = "default"
    offset_ms: float
    jitter_ms: float | None = None


class Me(BaseModel):
    """The caller. In single-user mode this is the ``local`` user and ``authenticated`` is false.

    ``role`` comes from the provider's groups at sign-in; it is always ``user`` in single-user mode.
    """

    user_id: str
    display_name: str
    email: str
    authenticated: bool
    role: Literal["user", "admin"]
    settings: Settings


class ApiToken(BaseModel):
    """A personal API token. The secret is only in the response that creates it."""

    id: str
    name: str
    prefix: str
    created_at: str
    expires_at: str | None
    last_used_at: str | None


class ApiTokenCreated(ApiToken):
    """A new token. ``token`` is the secret to send as `Authorization: Bearer`; it is shown once."""

    token: str


class AdminUser(BaseModel):
    """An account as an admin sees it. ``local`` marks the owner of songs from single-user mode."""

    id: str
    display_name: str
    email: str
    role: Literal["user", "admin"]
    local: bool
    created_at: str
    last_login_at: str | None
    song_count: int
    session_count: int


class SessionsEnded(BaseModel):
    ended: int


class SongsMoved(BaseModel):
    moved: int


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
    favourite: bool
    # The caller's tags for this song, sorted A to Z ignoring case.
    tags: list[str]


class LibraryCounts(BaseModel):
    """Songs in the whole library per filter, unaffected by the search text."""

    all: int
    bass: int
    electric: int
    acoustic: int
    chords: int
    favourites: int


class TagCount(BaseModel):
    tag: str
    count: int


class SongTags(BaseModel):
    tags: list[str]


class TagsAdded(BaseModel):
    updated: int


class Favourite(BaseModel):
    favourite: bool


class SongPage(BaseModel):
    items: list[SongSummary]
    # Songs matching the search and instrument filter, across all pages.
    total: int
    # Opaque. Pass it back as `cursor` for the next page; null on the last page.
    next_cursor: str | None
    counts: LibraryCounts


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
    imported: int | None = None
    """Library restore only: songs added, skipped as duplicates, added as copies, and not restorable."""
    skipped: int | None = None
    copied: int | None = None
    failed: int | None = None


class Job(BaseModel):
    """Background import. ``error_key`` is an ``errors`` catalog key; ``progress_key`` is a catalog key."""

    id: str
    kind: str
    status: Literal["queued", "running", "done", "error"]
    label: str = ""
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

ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    400: {"model": ErrorBody, "description": _KEYED},
    404: {"model": ErrorBody, "description": _KEYED},
    409: {"model": ErrorBody, "description": _KEYED + " `params.current` is the stored revision."},
    413: {"model": ErrorBody, "description": _KEYED},
    422: {
        "model": ValidationBody,
        "description": "Validation failed. `detail` is a list of {type, loc, msg}, not a keyed error.",
    },
}

# With sign-in (OIDC mode), a request without a live session gets 401 ``auth.required``.
AUTH_RESPONSES: dict[int | str, dict[str, Any]] = {
    **ERROR_RESPONSES,
    401: {"model": ErrorBody, "description": _KEYED + " `auth.required`: no session; sign in at `/auth/login`."},
}

ADMIN_RESPONSES: dict[int | str, dict[str, Any]] = {
    **AUTH_RESPONSES,
    403: {"model": ErrorBody, "description": _KEYED + " `auth.adminOnly`: the caller is not an admin."},
}
