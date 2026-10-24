"""HTTP API. UI strings live in the frontend catalogs; errors and progress carry keys."""

from __future__ import annotations

import base64
import json
import re
import uuid
from dataclasses import asdict
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from fretbook import __version__
from fretbook.api.deps import admin, context, principal, require_song
from fretbook.api.errors import api_error
from fretbook.api.schemas import (
    ADMIN_RESPONSES,
    AUTH_RESPONSES,
    AdminUser,
    Health,
    ImportPreview,
    Job,
    JobAccepted,
    Me,
    Meta,
    SessionsEnded,
    Settings,
    SongDetail,
    SongExport,
    SongPage,
    SongsMoved,
)
from fretbook.audio.ytdlp_health import status as ytdlp_status
from fretbook.auth.base import Principal
from fretbook.buildinfo import git_sha
from fretbook.chords import chordpro
from fretbook.context import AppContext
from fretbook.export.musicxml import to_musicxml
from fretbook.importers.base import ImportError, ImportRequest
from fretbook.importers.registry import resolve_importer
from fretbook.score.instruments import family, get_preset, is_preset, presets_payload
from fretbook.score.model import ScoreDocument, content_hash
from fretbook.storage.media import AUDIO_TYPES
from fretbook.storage.repository import RevisionConflict
from fretbook.tags import suggest_tags

router = APIRouter()

_AUDIO_SCHEMA: dict[str, dict[str, dict[str, str]]] = {
    media: {"schema": {"type": "string", "format": "binary"}}
    for media in ("audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4", "audio/flac", "audio/webm")
}

_AUDIO_TYPES = AUDIO_TYPES
_CHUNK = 1024 * 1024


class _Body(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)


class CreateSongBody(_Body):
    content_kind: Literal["tab", "chords"] = "tab"
    title: str = Field(default="Untitled", max_length=300)
    artist: str = Field(default="", max_length=300)
    preset: str | None = None
    """Instrument preset for a tab. Defaults to the user's default instrument."""
    bpm: float = Field(default=120, gt=0, lt=400)
    measures: int = Field(default=4, ge=1, le=500)
    signature: tuple[int, int] = (4, 4)
    chordpro: str | None = Field(default=None, max_length=chordpro.MAX_CHARS)
    """ChordPro or chords-over-lyrics text for a chord sheet."""


class UpdateSongBody(_Body):
    title: str = Field(max_length=300)
    artist: str = Field(default="", max_length=300)
    revision: int
    """The revision the client loaded. A stale one is refused with 409."""
    document: ScoreDocument | None = None
    chordpro: str | None = Field(default=None, max_length=chordpro.MAX_CHARS)


class SyncBody(_Body):
    bpm: float = Field(gt=0, lt=400)
    anchors: dict[str, float] = Field(default_factory=dict)


class ImportUrlBody(_Body):
    url: str = Field(max_length=2000)
    video_id: str | None = Field(default=None, max_length=11)
    slug: str | None = Field(default=None, max_length=60)
    part_ids: list[int] | None = None
    kind: str | None = None


class PreviewBody(_Body):
    url: str = Field(max_length=2000)


class ImportDocumentBody(_Body):
    title: str = Field(default="Untitled", max_length=300)
    artist: str = Field(default="", max_length=300)
    source_kind: Literal["file", "guitarpro", "musicxml", "fretbook-json", "manual"] = "file"
    slug: str | None = Field(default=None, max_length=60)
    document: ScoreDocument
    on_duplicate: Literal["skip", "keep_both", "replace"] = "keep_both"
    tags: list[str] = Field(default_factory=list)


class SettingsBody(_Body):
    default_instrument: str


def _ctx(ctx: AppContext = Depends(context)) -> AppContext:
    return ctx


def _user(user: Principal = Depends(principal)) -> Principal:
    return user


def _prefer(ctx: AppContext, user: Principal) -> str:
    preset = get_preset(ctx.songs.get_settings(user.user_id)["default_instrument"])
    return family(preset.instrument)


def _import_error(exc: Exception) -> Exception:
    if isinstance(exc, ImportError):
        return api_error(400, exc.key, str(exc), **exc.params)
    return api_error(400, "import.failed", str(exc))


async def _spool(file: UploadFile, dest: Path, limit: int) -> int:
    """Copy an upload to ``dest`` in chunks, stopping at ``limit`` bytes."""
    size = 0
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        with dest.open("wb") as out:
            while chunk := await file.read(_CHUNK):
                size += len(chunk)
                if size > limit:
                    raise api_error(413, "upload.tooLarge", "file is too large", limit=limit)
                out.write(chunk)
    except BaseException:
        dest.unlink(missing_ok=True)
        raise
    if size == 0:
        dest.unlink(missing_ok=True)
        raise api_error(400, "upload.empty", "empty file")
    return size


def _safe_name(filename: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", Path(filename).name)[:80] or "upload"


def _json(payload: object, status_code: int = 200) -> JSONResponse:
    """Return ``payload`` unchanged.

    ``response_model`` documents the body in OpenAPI. Returning a
    ``JSONResponse`` skips the response-model serializer, so the bytes stay
    the ones the handlers already produced.
    """
    return JSONResponse(payload, status_code=status_code)


@router.get("/api/health", response_model=Health, tags=["meta"])
def health() -> JSONResponse:
    """Liveness. No authentication."""
    return _json({"ok": True, "name": "Fretbook", "version": __version__})


@router.get("/api/meta", response_model=Meta, tags=["meta"])
def meta(ctx: AppContext = Depends(_ctx), _user: Principal = Depends(_user)) -> JSONResponse:
    """Name, version, build commit, auth mode, exporters, instrument presets, and the yt-dlp version."""
    return _json(
        {
            "name": "Fretbook",
            "tagline": "Self-hosted tabs, chord sheets, and sheet music for bass and guitar.",
            "version": __version__,
            "commit": git_sha(),
            "auth_mode": ctx.settings.auth_mode,
            "exporters": ["json", "musicxml", "midi", "chordpro", "pdf"],
            "instruments": presets_payload(),
            "ytdlp": asdict(ytdlp_status(ctx.settings)),
            "worker_kinds": ctx.jobs.live_worker_kinds(),
        }
    )


@router.get("/api/me", response_model=Me, tags=["auth"], responses=AUTH_RESPONSES)
def me(ctx: AppContext = Depends(_ctx), user: Principal = Depends(_user)) -> JSONResponse:
    """The caller and their settings."""
    return _json(
        {
            "user_id": user.user_id,
            "display_name": user.display_name,
            "email": user.email,
            "authenticated": user.authenticated,
            "role": user.role,
            "settings": ctx.songs.get_settings(user.user_id),
        }
    )


@router.put("/api/me/settings", response_model=Settings, tags=["auth"], responses=AUTH_RESPONSES)
def update_settings(
    body: SettingsBody, ctx: AppContext = Depends(_ctx), user: Principal = Depends(_user)
) -> JSONResponse:
    """Replace the caller's default instrument preset."""
    if not is_preset(body.default_instrument):
        raise api_error(400, "settings.unknownInstrument", "unknown instrument preset", preset=body.default_instrument)
    return _json(ctx.songs.update_settings(user.user_id, default_instrument=body.default_instrument))


@router.get("/api/songs", response_model=SongPage, tags=["songs"], responses=AUTH_RESPONSES)
def list_songs(
    q: str = Query("", max_length=200, description="Words matched as prefixes against title and artist."),
    sort: Literal["title", "artist", "added", "updated", "opened", "difficulty"] = "updated",
    order: Literal["asc", "desc"] | None = Query(None, description="Defaults to the natural order of `sort`."),
    instrument: Literal["all", "bass", "electric", "acoustic", "chords"] = "all",
    tag: list[str] = Query([], max_length=10, description="Repeat to require several tags; a song needs all of them."),
    favourite: bool = Query(False, description="Only starred songs."),
    difficulty_min: int | None = Query(None, ge=1, le=10, description="Tabs at or above this level (1 to 10)."),
    difficulty_max: int | None = Query(None, ge=1, le=10, description="Tabs at or below this level (1 to 10)."),
    limit: int = Query(50, ge=1, le=200),
    cursor: str = Query("", max_length=64),
    ctx: AppContext = Depends(_ctx),
    user: Principal = Depends(_user),
) -> JSONResponse:
    """One page of the caller's songs. Summaries omit the score and ChordPro text.

    `sort` defaults to the last edit, newest first; `opened` puts never-opened songs last, and `difficulty`
    (easiest first) puts chord sheets, which have no level, last.
    """
    start = _decode_cursor(cursor)
    page = ctx.songs.list_songs(
        user.user_id,
        q=q,
        sort=sort,
        order=order,
        instrument=instrument,
        tags=tag,
        favourite=favourite,
        difficulty_min=difficulty_min,
        difficulty_max=difficulty_max,
        limit=limit,
        offset=start,
    )
    end = start + len(page["items"])
    page["next_cursor"] = _encode_cursor(end) if end < page["total"] else None
    return _json(page)


def _encode_cursor(offset: int) -> str:
    return base64.urlsafe_b64encode(f"o{offset}".encode()).decode().rstrip("=")


def _decode_cursor(cursor: str) -> int:
    if not cursor:
        return 0
    try:
        text = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
        if text.startswith("o") and text[1:].isdigit():
            return int(text[1:])
    except ValueError:
        pass
    raise api_error(400, "songs.badCursor", "unrecognised page cursor")


@router.post(
    "/api/songs/{song_id}/opened",
    status_code=204,
    response_model=None,
    tags=["songs"],
    responses=AUTH_RESPONSES,
)
def mark_song_opened(song_id: str, ctx: AppContext = Depends(_ctx), user: Principal = Depends(_user)) -> Response:
    """Record that the caller opened the song, for the "last opened" sort."""
    require_song(ctx, user.user_id, song_id)
    ctx.songs.mark_opened(user.user_id, song_id)
    return Response(status_code=204)


@router.post("/api/songs", status_code=201, response_model=SongDetail, tags=["songs"], responses=AUTH_RESPONSES)
def create_song(
    body: CreateSongBody, ctx: AppContext = Depends(_ctx), user: Principal = Depends(_user)
) -> JSONResponse:
    title = body.title.strip() or "Untitled"
    artist = body.artist.strip()
    if body.content_kind == "chords":
        try:
            text = chordpro.normalize(body.chordpro or "", title=title, artist=artist)
        except ValueError as exc:
            raise api_error(400, "chords.tooLong", str(exc), limit=chordpro.MAX_CHARS) from exc
        found = chordpro.metadata(text)
        return _json(
            ctx.songs.create_song(
                user.user_id,
                title=title if body.title.strip() else found.get("title", title),
                artist=artist or found.get("artist", ""),
                chordpro=text,
                source_kind="manual",
            ),
            status_code=201,
        )
    preset = body.preset or ctx.songs.get_settings(user.user_id)["default_instrument"]
    if not is_preset(preset):
        raise api_error(400, "settings.unknownInstrument", "unknown instrument preset", preset=preset)
    numerator, denominator = body.signature
    if not 1 <= numerator <= 32 or denominator not in {1, 2, 4, 8, 16, 32}:
        raise api_error(400, "song.badSignature", "invalid time signature")
    return _json(
        ctx.songs.create_blank(
            user.user_id,
            title=title,
            artist=artist,
            preset_id=preset,
            bpm=body.bpm,
            measures=body.measures,
            signature=(numerator, denominator),
        ),
        status_code=201,
    )


@router.get("/api/songs/{song_id}", response_model=SongDetail, tags=["songs"], responses=AUTH_RESPONSES)
def get_song(song_id: str, ctx: AppContext = Depends(_ctx), user: Principal = Depends(_user)) -> JSONResponse:
    """One song, including its score document or ChordPro text."""
    return _json(require_song(ctx, user.user_id, song_id))


@router.put("/api/songs/{song_id}", response_model=SongDetail, tags=["songs"], responses=AUTH_RESPONSES)
def update_song(
    song_id: str,
    body: UpdateSongBody,
    ctx: AppContext = Depends(_ctx),
    user: Principal = Depends(_user),
) -> JSONResponse:
    """Replace title, artist, and content. Send the revision you loaded; a stale one is 409."""
    song = require_song(ctx, user.user_id, song_id)
    chordpro_text: str | None = None
    if song["content_kind"] == "tab":
        if body.document is None:
            raise api_error(400, "song.needsDocument", "a tab update needs a score document")
    else:
        if body.chordpro is None:
            raise api_error(400, "song.needsChordPro", "a chord sheet update needs ChordPro text")
        chordpro_text = chordpro.normalize(body.chordpro)
    try:
        updated = ctx.songs.update_song(
            user.user_id,
            song_id,
            title=body.title.strip() or "Untitled",
            artist=body.artist.strip(),
            revision=body.revision,
            document=body.document if song["content_kind"] == "tab" else None,
            chordpro=chordpro_text,
        )
    except RevisionConflict as exc:
        raise api_error(409, "song.conflict", "this song changed since you opened it", current=exc.current) from exc
    if updated is None:
        raise api_error(404, "song.notFound", "song not found")
    return _json(updated)


@router.patch("/api/songs/{song_id}/sync", response_model=SongDetail, tags=["songs"], responses=AUTH_RESPONSES)
def update_sync(
    song_id: str,
    body: SyncBody,
    ctx: AppContext = Depends(_ctx),
    user: Principal = Depends(_user),
) -> JSONResponse:
    """Set the opening tempo and tapped bar anchors on a tab."""
    require_song(ctx, user.user_id, song_id)
    try:
        updated = ctx.songs.update_sync(user.user_id, song_id, bpm=body.bpm, anchors=body.anchors)
    except ValidationError as exc:
        raise api_error(400, "sync.badAnchor", "anchor keys must be bar indexes of this song") from exc
    if updated is None:
        raise api_error(400, "sync.notTab", "only tabs have sync marks")
    return _json(updated)


@router.delete(
    "/api/songs/{song_id}",
    status_code=204,
    response_model=None,
    tags=["songs"],
    responses=AUTH_RESPONSES,
)
def delete_song(song_id: str, ctx: AppContext = Depends(_ctx), user: Principal = Depends(_user)) -> Response:
    require_song(ctx, user.user_id, song_id)
    ctx.media.delete_song_files(user.user_id, song_id)
    ctx.songs.delete_song(user.user_id, song_id)
    return Response(status_code=204)


@router.post(
    "/api/songs/{song_id}/audio",
    response_model=SongDetail,
    tags=["songs"],
    responses=AUTH_RESPONSES,
)
async def upload_audio(
    song_id: str,
    file: UploadFile = File(...),
    ctx: AppContext = Depends(_ctx),
    user: Principal = Depends(_user),
) -> JSONResponse:
    """Replace the song's audio. The extension picks the content type, not the client."""
    require_song(ctx, user.user_id, song_id)
    filename = file.filename or "audio.mp3"
    suffix = Path(filename).suffix.lower()
    if suffix not in _AUDIO_TYPES:
        raise api_error(400, "upload.notAudio", "upload an mp3, wav, ogg, m4a, flac, or webm file")
    staging = ctx.settings.inbox_dir / f"upload-{uuid.uuid4().hex}{suffix}"
    await _spool(file, staging, ctx.settings.max_upload_bytes)
    try:
        ctx.media.save_file(
            user.user_id,
            song_id,
            kind="audio",
            filename=filename,
            # The type comes from the extension we accepted, not from the client.
            content_type=_AUDIO_TYPES[suffix],
            source=staging,
            replace_kind=True,
        )
    finally:
        staging.unlink(missing_ok=True)
    # Stems were cut from the old recording; they would not line up with the new one.
    ctx.media.delete_stems(user.user_id, song_id)
    return _json(require_song(ctx, user.user_id, song_id))


@router.get(
    "/api/songs/{song_id}/audio",
    tags=["songs"],
    responses={
        **AUTH_RESPONSES,
        200: {"description": "The song's audio file.", "content": _AUDIO_SCHEMA},
    },
)
def download_audio(song_id: str, ctx: AppContext = Depends(_ctx), user: Principal = Depends(_user)) -> FileResponse:
    require_song(ctx, user.user_id, song_id)
    row = ctx.media.audio_for(user.user_id, song_id)
    if row is None:
        raise api_error(404, "audio.none", "this song has no audio")
    path = ctx.media.path_for(row)
    if not path.is_file():
        raise api_error(404, "audio.missing", "audio file is missing")
    return FileResponse(path, media_type=row["content_type"], filename=row["filename"])


@router.get(
    "/api/songs/{song_id}/export.json",
    response_model=SongExport,
    tags=["songs"],
    responses=AUTH_RESPONSES,
)
def export_json(song_id: str, ctx: AppContext = Depends(_ctx), user: Principal = Depends(_user)) -> Response:
    """Download the song as Fretbook JSON. Returned as written, with a Content-Disposition filename."""
    song = require_song(ctx, user.user_id, song_id)
    payload = {
        "format": "fretbook-song",
        "format_version": 1,
        "content_kind": song["content_kind"],
        "title": song["title"],
        "artist": song["artist"],
    }
    if song["content_kind"] == "tab":
        payload["document"] = song["document"]
    else:
        payload["chordpro"] = song["chordpro"]
    return Response(
        json.dumps(payload, ensure_ascii=False, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{song["slug"]}.json"'},
    )


@router.get(
    "/api/songs/{song_id}/export.musicxml",
    tags=["songs"],
    responses={
        **AUTH_RESPONSES,
        200: {
            "description": "MusicXML for a tab, as an attachment.",
            "content": {"application/vnd.recordare.musicxml+xml": {"schema": {"type": "string"}}},
        },
    },
)
def export_musicxml(song_id: str, ctx: AppContext = Depends(_ctx), user: Principal = Depends(_user)) -> Response:
    song = require_song(ctx, user.user_id, song_id)
    if song["content_kind"] != "tab":
        raise api_error(400, "export.notTab", "only tabs export as MusicXML")
    document = ScoreDocument.model_validate(song["document"])
    return Response(
        to_musicxml(document, title=song["title"], artist=song["artist"]),
        media_type="application/vnd.recordare.musicxml+xml",
        headers={"Content-Disposition": f'attachment; filename="{song["slug"]}.musicxml"'},
    )


@router.get(
    "/api/songs/{song_id}/export.cho",
    tags=["songs"],
    responses={
        **AUTH_RESPONSES,
        200: {
            "description": "ChordPro text for a chord sheet, as an attachment.",
            "content": {"text/plain": {"schema": {"type": "string"}}},
        },
    },
)
def export_chordpro(song_id: str, ctx: AppContext = Depends(_ctx), user: Principal = Depends(_user)) -> Response:
    song = require_song(ctx, user.user_id, song_id)
    if song["content_kind"] != "chords":
        raise api_error(400, "export.notChords", "only chord sheets export as ChordPro")
    return Response(
        song["chordpro"] or "",
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{song["slug"]}.cho"'},
    )


@router.post("/api/imports/preview", response_model=ImportPreview, tags=["imports"], responses=AUTH_RESPONSES)
def preview_import(body: PreviewBody, user: Principal = Depends(_user)) -> JSONResponse:
    """Fretted tracks on a link, so the library can ask which ones to import.

    Songsterr is the importer that has a preview. Others are refused with the
    same error a direct import would use.
    """
    url = body.url.strip()
    request = ImportRequest(owner_id=user.user_id, url=url)
    try:
        importer = resolve_importer(request)
    except ImportError as exc:
        raise _import_error(exc) from exc
    preview = getattr(importer, "preview", None)
    if not callable(preview):
        raise api_error(400, "import.noPreview", "this import has no track list")
    try:
        return _json(preview(request))
    except ImportError as exc:
        raise _import_error(exc) from exc


@router.post(
    "/api/imports",
    status_code=202,
    response_model=JobAccepted,
    tags=["imports"],
    responses=AUTH_RESPONSES,
)
def import_url(body: ImportUrlBody, ctx: AppContext = Depends(_ctx), user: Principal = Depends(_user)) -> JSONResponse:
    """Queue a Songsterr or YouTube-frame import. Returns a job id."""
    url = body.url.strip()
    request = ImportRequest(owner_id=user.user_id, url=url, kind=body.kind)
    try:
        importer = resolve_importer(request)
    except ImportError as exc:
        raise _import_error(exc) from exc
    kind = importer.kind
    if kind not in {"songsterr", "youtube-frames"}:
        raise api_error(400, "import.notUrl", f"{kind} is not a URL import", kind=kind)
    if kind == "songsterr" and not importer.can_handle(request):
        raise api_error(400, "songsterr.badUrl", "URL must look like https://www.songsterr.com/a/wsa/<name>-s<digits>")
    job_kind = "import.youtube_frames" if kind == "youtube-frames" else "import.songsterr"
    job_id = ctx.jobs.enqueue(
        user.user_id,
        job_kind,
        {
            "url": url,
            "video_id": body.video_id,
            "slug": body.slug,
            "part_ids": body.part_ids,
            "kind": kind,
            "prefer": _prefer(ctx, user),
        },
    )
    return _json({"job_id": job_id}, status_code=202)


@router.post(
    "/api/imports/file",
    status_code=202,
    response_model=JobAccepted,
    tags=["imports"],
    responses=AUTH_RESPONSES,
)
async def import_file(
    file: UploadFile = File(...),
    kind: str | None = Form(default=None),
    ctx: AppContext = Depends(_ctx),
    user: Principal = Depends(_user),
) -> JSONResponse:
    """Queue a Guitar Pro, MusicXML, ChordPro, or Fretbook JSON upload."""
    filename = file.filename or "upload"
    request = ImportRequest(owner_id=user.user_id, filename=filename, kind=kind)
    try:
        resolve_importer(request)
    except ImportError as exc:
        raise _import_error(exc) from exc
    # A unique name per upload: two files called song.xml must not overwrite each other in the inbox.
    path = ctx.settings.inbox_dir / f"{uuid.uuid4().hex}-{_safe_name(filename)}"
    await _spool(file, path, ctx.settings.max_upload_bytes)
    job_id = ctx.jobs.enqueue(
        user.user_id,
        "import.file",
        {"path": str(path), "filename": filename, "kind": kind, "prefer": _prefer(ctx, user)},
    )
    return _json({"job_id": job_id}, status_code=202)


@router.post(
    "/api/songs/import-document",
    status_code=201,
    response_model=SongDetail,
    tags=["imports"],
    responses=AUTH_RESPONSES,
)
def import_document(
    body: ImportDocumentBody, ctx: AppContext = Depends(_ctx), user: Principal = Depends(_user)
) -> JSONResponse:
    """Save a document the browser built (the browser reads Guitar Pro with alphaTab)."""
    title = body.title.strip() or "Untitled"
    hash_val = content_hash(body.document)
    source_ref: dict[str, Any] = {"content_hash": hash_val}
    if body.tags:
        source_ref["tags"] = body.tags

    duplicate = ctx.songs.find_existing_duplicate(
        user.user_id, content_hash=hash_val, title=title, artist=body.artist.strip()
    )
    if duplicate is not None:
        if body.on_duplicate == "skip":
            return _json(require_song(ctx, user.user_id, duplicate["id"]), status_code=200)
        if body.on_duplicate == "replace":
            updated = ctx.songs.update_song(
                user.user_id,
                duplicate["id"],
                title=title,
                artist=body.artist.strip(),
                revision=duplicate["revision"],
                document=body.document,
                source_ref=source_ref,
            )
            if updated is not None:
                if body.tags:
                    ctx.songs.add_tags(user.user_id, [duplicate["id"]], body.tags)
                return _json(require_song(ctx, user.user_id, duplicate["id"]), status_code=200)

    song = ctx.songs.create_song(
        user.user_id,
        title=title,
        artist=body.artist.strip(),
        document=body.document,
        source_kind=body.source_kind,
        source_ref=source_ref,
        slug=body.slug or title,
    )
    tags_to_add = suggest_tags(song)
    if body.tags:
        tags_to_add = list(dict.fromkeys([*tags_to_add, *body.tags]))
    if tags_to_add:
        ctx.songs.add_tags(user.user_id, [song["id"]], tags_to_add)
    return _json(require_song(ctx, user.user_id, song["id"]), status_code=201)


def _job_label(job: dict[str, Any]) -> str:
    payload = job.get("payload") or {}
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except Exception:
            payload = {}
    return (
        payload.get("filename")
        or payload.get("title")
        or payload.get("slug")
        or payload.get("url")
        or job.get("kind", "")
    )


@router.get("/api/jobs", response_model=list[Job], tags=["jobs"], responses=AUTH_RESPONSES)
def list_jobs(
    status: Literal["queued", "running", "done", "error"] | None = None,
    ctx: AppContext = Depends(_ctx),
    user: Principal = Depends(_user),
) -> JSONResponse:
    """Recent jobs for the current user."""
    jobs = ctx.jobs.list_jobs(user.user_id, status=status)
    for job in jobs:
        job["label"] = _job_label(job)
        for private in ("owner_id", "payload", "attempts", "worker_id"):
            job.pop(private, None)
    return _json(jobs)


@router.get("/api/jobs/{job_id}", response_model=Job, tags=["jobs"], responses=AUTH_RESPONSES)
def get_job(job_id: str, ctx: AppContext = Depends(_ctx), user: Principal = Depends(_user)) -> JSONResponse:
    """Job status. `owner_id`, `payload`, `attempts`, and `worker_id` are not returned."""
    job = ctx.jobs.get(user.user_id, job_id)
    if job is None:
        raise api_error(404, "job.notFound", "job not found")
    job["label"] = _job_label(job)
    for private in ("owner_id", "payload", "attempts", "worker_id"):
        job.pop(private, None)
    return _json(job)


@router.post(
    "/api/jobs/{job_id}/retry",
    status_code=202,
    response_model=JobAccepted,
    tags=["jobs"],
    responses=AUTH_RESPONSES,
)
def retry_job(
    job_id: str,
    ctx: AppContext = Depends(_ctx),
    user: Principal = Depends(_user),
) -> JSONResponse:
    """Retry a failed background import."""
    job = ctx.jobs.get(user.user_id, job_id)
    if job is None:
        raise api_error(404, "job.notFound", "job not found")
    if job["status"] != "error":
        raise api_error(400, "job.notFailed", "only failed jobs can be retried")
    try:
        retried = ctx.jobs.retry(user.user_id, job_id)
    except FileNotFoundError:
        raise api_error(
            410,
            "job.uploadExpired",
            "the uploaded file is no longer available; please upload it again",
        )
    except ValueError as exc:
        raise api_error(400, "job.cannotRetry", str(exc))
    if retried is None:
        raise api_error(404, "job.notFound", "job not found")
    return _json({"job_id": job_id}, status_code=202)


@router.delete(
    "/api/jobs/{job_id}",
    status_code=204,
    tags=["jobs"],
    responses=AUTH_RESPONSES,
)
def delete_job(
    job_id: str,
    ctx: AppContext = Depends(_ctx),
    user: Principal = Depends(_user),
) -> Response:
    """Dismiss a job."""
    if not ctx.jobs.dismiss(user.user_id, job_id):
        raise api_error(404, "job.notFound", "job not found")
    return Response(status_code=204)


@router.post(
    "/api/jobs/{job_id}/dismiss",
    status_code=204,
    tags=["jobs"],
    responses=AUTH_RESPONSES,
)
def dismiss_job(
    job_id: str,
    ctx: AppContext = Depends(_ctx),
    user: Principal = Depends(_user),
) -> Response:
    """Dismiss a job."""
    return delete_job(job_id, ctx, user)


# --- administration (OIDC mode; admins come from FRETBOOK_OIDC_ADMIN_GROUP) ---


@router.get("/api/admin/users", response_model=list[AdminUser], tags=["admin"], responses=ADMIN_RESPONSES)
def admin_users(ctx: AppContext = Depends(_ctx), _admin: Principal = Depends(admin)) -> JSONResponse:
    """Every account, with role, song count, last sign-in and live sessions. The ``local`` row holds
    songs from single-user mode."""
    return _json(ctx.users.list_users())


@router.post(
    "/api/admin/users/{user_id}/sign-out", response_model=SessionsEnded, tags=["admin"], responses=ADMIN_RESPONSES
)
def admin_sign_out(user_id: str, ctx: AppContext = Depends(_ctx), _admin: Principal = Depends(admin)) -> JSONResponse:
    """End every session of a user. Their next visit signs in again and re-reads their groups."""
    if not ctx.users.exists(user_id):
        raise api_error(404, "user.notFound", "user not found")
    return _json({"ended": ctx.users.revoke_sessions(user_id)})


@router.post("/api/admin/adopt-local", response_model=SongsMoved, tags=["admin"], responses=ADMIN_RESPONSES)
def admin_adopt_local(ctx: AppContext = Depends(_ctx), user: Principal = Depends(admin)) -> JSONResponse:
    """Move the songs from single-user mode into the calling admin's library."""
    return _json({"moved": ctx.users.adopt_local(user.user_id)})
