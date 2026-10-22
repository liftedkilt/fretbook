"""HTTP API. UI strings live in the frontend catalogs; progress uses keys."""

from __future__ import annotations

import re
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from fretbook import __version__
from fretbook.api.deps import context, principal, require_song
from fretbook.auth.base import Principal
from fretbook.context import AppContext
from fretbook.export.pdf import PdfExporter, PdfNotImplemented, available_exporters
from fretbook.importers.base import ImportRequest
from fretbook.importers.registry import resolve_importer
from fretbook.score.instruments import get_preset, presets_payload
from fretbook.score.model import ScoreDocument

router = APIRouter()

_AUDIO_TYPES = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
    ".flac": "audio/flac",
    ".webm": "audio/webm",
}


class CreateSongBody(BaseModel):
    title: str = "Untitled"
    artist: str = ""
    preset: str = "bass-4"
    bpm: float = Field(default=120, gt=0, lt=400)
    measures: int = Field(default=4, ge=1, le=500)
    signature: tuple[int, int] = (4, 4)


class UpdateSongBody(BaseModel):
    title: str
    artist: str = ""
    document: ScoreDocument


class SyncBody(BaseModel):
    bpm: float = Field(gt=0, lt=400)
    anchors: dict[str, float] = Field(default_factory=dict)


class ImportUrlBody(BaseModel):
    url: str
    video_id: str | None = None
    slug: str | None = None
    part_ids: list[int] | None = None
    kind: str | None = None


def _ctx(ctx: AppContext = Depends(context)) -> AppContext:
    return ctx


def _user(user: Principal = Depends(principal)) -> Principal:
    return user


@router.get("/api/health")
def health() -> dict[str, object]:
    return {"ok": True, "name": "Fretbook", "version": __version__}


@router.get("/api/meta")
def meta(ctx: AppContext = Depends(_ctx)) -> dict[str, object]:
    return {
        "name": "Fretbook",
        "tagline": "Self-hosted tabs and sheet music for bass and guitar.",
        "version": __version__,
        "auth_mode": ctx.settings.auth_mode,
        "exporters": available_exporters(),
        "instruments": presets_payload(),
    }


@router.get("/api/me")
def me(user: Principal = Depends(_user)) -> dict[str, object]:
    return {
        "user_id": user.user_id,
        "display_name": user.display_name,
        "authenticated": user.authenticated,
    }


@router.get("/api/songs")
def list_songs(ctx: AppContext = Depends(_ctx), user: Principal = Depends(_user)) -> list[dict]:
    return ctx.songs.list_songs(user.user_id)


@router.post("/api/songs", status_code=201)
def create_song(
    body: CreateSongBody,
    ctx: AppContext = Depends(_ctx),
    user: Principal = Depends(_user),
) -> dict:
    try:
        get_preset(body.preset)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    numerator, denominator = body.signature
    if numerator < 1 or denominator < 1:
        raise HTTPException(status_code=400, detail="invalid time signature")
    return ctx.songs.create_blank(
        user.user_id,
        title=body.title.strip() or "Untitled",
        artist=body.artist.strip(),
        preset_id=body.preset,
        bpm=body.bpm,
        measures=body.measures,
        signature=(numerator, denominator),
    )


@router.get("/api/songs/{song_id}")
def get_song(song_id: str, ctx: AppContext = Depends(_ctx), user: Principal = Depends(_user)) -> dict:
    return require_song(ctx, user.user_id, song_id)


@router.put("/api/songs/{song_id}")
def update_song(
    song_id: str,
    body: UpdateSongBody,
    ctx: AppContext = Depends(_ctx),
    user: Principal = Depends(_user),
) -> dict:
    require_song(ctx, user.user_id, song_id)
    updated = ctx.songs.update_song(
        user.user_id,
        song_id,
        title=body.title.strip() or "Untitled",
        artist=body.artist.strip(),
        document=body.document,
    )
    assert updated is not None
    return updated


@router.patch("/api/songs/{song_id}/sync")
def update_sync(
    song_id: str,
    body: SyncBody,
    ctx: AppContext = Depends(_ctx),
    user: Principal = Depends(_user),
) -> dict:
    require_song(ctx, user.user_id, song_id)
    for key in body.anchors:
        if not re.fullmatch(r"\d+", key):
            raise HTTPException(status_code=400, detail="anchor keys are measure indexes")
    updated = ctx.songs.update_sync(user.user_id, song_id, bpm=body.bpm, anchors=body.anchors)
    assert updated is not None
    return updated


@router.delete("/api/songs/{song_id}", status_code=204)
def delete_song(song_id: str, ctx: AppContext = Depends(_ctx), user: Principal = Depends(_user)) -> Response:
    require_song(ctx, user.user_id, song_id)
    ctx.media.delete_song_files(user.user_id, song_id)
    ctx.songs.delete_song(user.user_id, song_id)
    return Response(status_code=204)


@router.post("/api/songs/{song_id}/audio")
async def upload_audio(
    song_id: str,
    file: UploadFile = File(...),
    ctx: AppContext = Depends(_ctx),
    user: Principal = Depends(_user),
) -> dict:
    require_song(ctx, user.user_id, song_id)
    filename = file.filename or "audio.mp3"
    suffix = Path(filename).suffix.lower()
    if suffix not in _AUDIO_TYPES:
        raise HTTPException(status_code=400, detail="upload an mp3, wav, ogg, m4a, flac, or webm file")
    data = await file.read()
    if len(data) > ctx.settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="file is too large")
    if not data:
        raise HTTPException(status_code=400, detail="empty file")
    ctx.media.save(
        user.user_id,
        song_id,
        kind="audio",
        filename=filename,
        content_type=file.content_type or _AUDIO_TYPES[suffix],
        data=data,
        replace_kind=True,
    )
    song = require_song(ctx, user.user_id, song_id)
    return song


@router.get("/api/songs/{song_id}/audio")
def download_audio(
    song_id: str, ctx: AppContext = Depends(_ctx), user: Principal = Depends(_user)
) -> FileResponse:
    require_song(ctx, user.user_id, song_id)
    row = ctx.media.audio_for(user.user_id, song_id)
    if row is None:
        raise HTTPException(status_code=404, detail="this song has no audio")
    path = ctx.media.path_for(row)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="audio file is missing")
    return FileResponse(path, media_type=row["content_type"], filename=row["filename"])


@router.get("/api/songs/{song_id}/export.json")
def export_json(song_id: str, ctx: AppContext = Depends(_ctx), user: Principal = Depends(_user)) -> dict:
    song = require_song(ctx, user.user_id, song_id)
    return {
        "format": "fretbook-song",
        "format_version": 1,
        "title": song["title"],
        "artist": song["artist"],
        "document": song["document"],
    }


@router.get("/api/songs/{song_id}/export.pdf")
def export_pdf(song_id: str, ctx: AppContext = Depends(_ctx), user: Principal = Depends(_user)) -> Response:
    """Issue #3 registers a real PDF here. Until then this is a 501."""
    song = require_song(ctx, user.user_id, song_id)
    try:
        PdfExporter().export(
            ScoreDocument.model_validate(song["document"]),
            title=song["title"],
            artist=song["artist"],
            track_id=None,
        )
    except PdfNotImplemented as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc
    return Response(status_code=500)


@router.post("/api/imports", status_code=202)
def import_url(
    body: ImportUrlBody,
    ctx: AppContext = Depends(_ctx),
    user: Principal = Depends(_user),
) -> dict[str, str]:
    request = ImportRequest(
        owner_id=user.user_id,
        url=body.url.strip(),
        kind=body.kind,
        options={"video_id": body.video_id, "slug": body.slug, "part_ids": body.part_ids},
    )
    try:
        importer = resolve_importer(request)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    kind = importer.kind if body.kind is None else body.kind
    job_kind = "import.youtube_frames" if kind == "youtube-frames" else "import.songsterr"
    if kind not in {"songsterr", "youtube-frames"}:
        raise HTTPException(status_code=400, detail=f"{kind} is not a URL import")
    job_id = ctx.jobs.enqueue(
        user.user_id,
        job_kind,
        {
            "url": body.url.strip(),
            "video_id": body.video_id,
            "slug": body.slug,
            "part_ids": body.part_ids,
            "kind": kind,
        },
    )
    return {"job_id": job_id}


@router.post("/api/imports/file", status_code=202)
async def import_file(
    file: UploadFile = File(...),
    kind: str | None = Form(default=None),
    ctx: AppContext = Depends(_ctx),
    user: Principal = Depends(_user),
) -> dict[str, str]:
    filename = file.filename or "upload"
    suffix = Path(filename).suffix.lower()
    if suffix in {".gp", ".gp3", ".gp4", ".gp5", ".gpx"}:
        raise HTTPException(
            status_code=400,
            detail=(
                "Guitar Pro files are read in the browser by alphaTab. "
                "Use the import button in Fretbook rather than this endpoint."
            ),
        )
    data = await file.read()
    if len(data) > ctx.settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="file is too large")
    inbox = ctx.settings.inbox_dir
    inbox.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", Path(filename).name)[:80] or "upload"
    path = inbox / f"{user.user_id}-{safe}"
    path.write_bytes(data)
    request = ImportRequest(owner_id=user.user_id, filename=filename, file_path=path, kind=kind)
    try:
        resolve_importer(request)
    except Exception as exc:
        path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    job_id = ctx.jobs.enqueue(
        user.user_id,
        "import.file",
        {"path": str(path), "filename": filename, "kind": kind},
    )
    return {"job_id": job_id}


@router.post("/api/songs/import-document", status_code=201)
def import_document(
    payload: dict,
    ctx: AppContext = Depends(_ctx),
    user: Principal = Depends(_user),
) -> dict:
    """Save a document the browser built (Guitar Pro via alphaTab)."""
    try:
        document = ScoreDocument.model_validate(payload.get("document", payload))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    title = str(payload.get("title") or "Untitled")
    artist = str(payload.get("artist") or "")
    source_kind = str(payload.get("source_kind") or "file")
    if source_kind not in {"file", "guitarpro", "musicxml", "fretbook-json", "manual"}:
        source_kind = "file"
    source_ref = payload.get("source_ref") if isinstance(payload.get("source_ref"), dict) else {}
    return ctx.songs.create_song(
        user.user_id,
        title=title,
        artist=artist,
        document=document,
        source_kind=source_kind,
        source_ref=source_ref,
        slug=str(payload.get("slug") or title),
    )


@router.get("/api/jobs/{job_id}")
def get_job(job_id: str, ctx: AppContext = Depends(_ctx), user: Principal = Depends(_user)) -> dict:
    job = ctx.jobs.get(user.user_id, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    job.pop("owner_id", None)
    job.pop("payload", None)
    return job
