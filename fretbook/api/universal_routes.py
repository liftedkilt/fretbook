"""One entry point for "add something": a dropped file, pasted text, or a pasted link.

The server decides what it is from the content (see :mod:`fretbook.importers.sniff`)
and queues the same jobs the format-specific endpoints use. Guitar Pro is the
exception: alphaTab reads it in the browser, so the browser checks for it first
(``web/src/lib/sniff.ts``) and a Guitar Pro upload that reaches here is refused.
"""

from __future__ import annotations

import re
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse

from fretbook.api.deps import context, principal
from fretbook.api.errors import api_error
from fretbook.api.routes import _prefer, _safe_name, _spool, import_job_kind
from fretbook.api.schemas import AUTH_RESPONSES, JobAccepted
from fretbook.auth.base import Principal
from fretbook.context import AppContext
from fretbook.importers import remote, sniff
from fretbook.importers.base import ImportError, ImportRequest
from fretbook.importers.registry import refuse_by_content, resolve_importer
from fretbook.importers.zip_safety import safe_extract_zip

router = APIRouter()

MAX_URL_CHARS = 2000
_SINGLE_URL = re.compile(r"^https?://\S+$", re.IGNORECASE)
_TEXT_SUFFIX = {
    sniff.MUSICXML: ".musicxml",
    sniff.FRETBOOK_JSON: ".json",
    sniff.CHORDPRO: ".cho",
    sniff.CHORDS_OVER_LYRICS: ".txt",
    sniff.ASCII_TAB: ".tab",
}


class AutoImportAccepted(JobAccepted):
    """Queued import.

    ``detected`` is what the server took the input for: an importer kind,
    or ``songsterr``, ``youtube``, ``ultimate-guitar`` or ``web`` for a link.
    """

    detected: str


def _fail(exc: ImportError) -> Exception:
    return api_error(400, exc.key, str(exc), **exc.params)


@router.post(
    "/api/imports/auto",
    status_code=202,
    response_model=AutoImportAccepted,
    tags=["imports"],
    responses=AUTH_RESPONSES,
)
async def import_auto(
    file: UploadFile | None = File(default=None),
    text: str | None = Form(default=None, max_length=sniff.MAX_TEXT_CHARS),
    url: str | None = Form(default=None, max_length=MAX_URL_CHARS),
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
) -> JSONResponse:
    """Work out what a dropped file, pasted text, or a pasted link is, and queue its import.

    Send exactly one of ``file``, ``text`` or ``url``. Text that is a single link is treated as a link.
    Input that matches no supported format is refused with `import.noFileImporter`.
    """
    pasted = (text or "").strip()
    link = (url or "").strip()
    if sum(bool(item) for item in (file, pasted, link)) != 1:
        raise api_error(400, "import.chooseOne", "send one file, one block of text, or one link")
    if pasted and _SINGLE_URL.match(pasted):
        pasted, link = "", pasted
    if file is not None:
        return await _from_file(file, ctx, user)
    if pasted:
        return _from_text(pasted, ctx, user)
    return _from_link(link, ctx, user)


async def _from_file(file: UploadFile, ctx: AppContext, user: Principal) -> JSONResponse:
    filename = file.filename or "upload"
    path = ctx.settings.inbox_dir / f"{uuid.uuid4().hex}-{_safe_name(filename)}"
    await _spool(file, path, ctx.settings.max_upload_bytes)

    if filename.lower().endswith(".zip"):
        sniffed = sniff.sniff_path(path, filename).kind
        if sniffed not in (sniff.GUITAR_PRO, sniff.MXL, sniff.FRETBOOK_ARCHIVE):
            dest_dir = ctx.settings.inbox_dir / f"bulk-unpacked-{uuid.uuid4().hex}"
            try:
                extracted = safe_extract_zip(path, dest_dir)
            except ImportError as exc:
                path.unlink(missing_ok=True)
                raise _fail(exc) from exc
            finally:
                path.unlink(missing_ok=True)

            if not extracted:
                raise api_error(400, "import.emptyZip", "Zip archive contains no files")

            zip_stem = Path(filename).stem
            first_job_id = None
            for item in extracted:
                job_id = ctx.jobs.enqueue(
                    user.user_id,
                    "import.file",
                    {
                        "path": str(item.path),
                        "filename": item.filename,
                        "kind": None,
                        "prefer": _prefer(ctx, user),
                        "tags": [zip_stem],
                    },
                )
                if first_job_id is None:
                    first_job_id = job_id
            return JSONResponse({"job_id": first_job_id, "detected": "zip"}, status_code=202)

    try:
        importer = resolve_importer(ImportRequest(owner_id=user.user_id, filename=filename, file_path=path))
    except ImportError as exc:
        path.unlink(missing_ok=True)
        raise _fail(exc) from exc
    return _queue_file(ctx, user, path, filename, importer.kind)


def _from_text(text: str, ctx: AppContext, user: Principal) -> JSONResponse:
    kind = sniff.sniff_text(text)
    try:
        refuse_by_content(kind)
    except ImportError as exc:
        raise _fail(exc) from exc
    if kind not in _TEXT_SUFFIX:
        raise api_error(
            400,
            "import.noFileImporter",
            "Couldn't recognise this text. Fretbook reads " + "; ".join(sniff.SUPPORTED_LABELS) + ".",
        )
    filename = f"Untitled{_TEXT_SUFFIX[kind]}"
    path = ctx.settings.inbox_dir / f"{uuid.uuid4().hex}-{filename}"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    try:
        importer = resolve_importer(ImportRequest(owner_id=user.user_id, filename=filename, file_path=path))
    except ImportError as exc:
        path.unlink(missing_ok=True)
        raise _fail(exc) from exc
    return _queue_file(ctx, user, path, filename, importer.kind)


def _queue_file(ctx: AppContext, user: Principal, path: Path, filename: str, kind: str) -> JSONResponse:
    try:
        job_kind = import_job_kind(ctx, kind)
    except Exception:
        path.unlink(missing_ok=True)
        raise
    job_id = ctx.jobs.enqueue(
        user.user_id,
        job_kind,
        {"path": str(path), "filename": filename, "kind": None, "prefer": _prefer(ctx, user)},
    )
    return JSONResponse({"job_id": job_id, "detected": kind}, status_code=202)


def _from_link(link: str, ctx: AppContext, user: Principal) -> JSONResponse:
    if not re.match(r"^https?://[^\s/]+", link, re.IGNORECASE) or re.search(r"\s", link):
        raise api_error(400, "import.badUrl", "paste a web link that starts with http:// or https://")
    provider = remote.provider_for(link)
    if provider == "songsterr":
        job_id = ctx.jobs.enqueue(
            user.user_id,
            "import.songsterr",
            {
                "url": link,
                "video_id": None,
                "slug": None,
                "part_ids": None,
                "kind": "songsterr",
                "prefer": _prefer(ctx, user),
            },
        )
    else:
        job_id = ctx.jobs.enqueue(user.user_id, "import.url", {"url": link, "prefer": _prefer(ctx, user)})
    return JSONResponse({"job_id": job_id, "detected": provider}, status_code=202)
