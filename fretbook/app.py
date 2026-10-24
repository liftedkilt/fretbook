"""FastAPI application."""

from __future__ import annotations

import logging
import mimetypes
import re
import shutil
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from starlette.responses import Response

from fretbook import __version__
from fretbook.api.ascii_tab_routes import router as ascii_tab_router
from fretbook.api.backup import RESTORE_PATH
from fretbook.api.backup import router as backup_router
from fretbook.api.bulk_routes import router as bulk_router
from fretbook.api.calibration_routes import router as calibration_router
from fretbook.api.middleware import BodyLimitMiddleware, SameOriginMiddleware
from fretbook.api.midi_routes import router as midi_router
from fretbook.api.practice_routes import router as practice_router
from fretbook.api.retune_routes import router as retune_router
from fretbook.api.routes import router
from fretbook.api.setlist_routes import router as setlist_router
from fretbook.api.tag_routes import router as tag_router
from fretbook.api.token_routes import router as token_router
from fretbook.api.universal_routes import router as universal_router
from fretbook.audio.ytdlp_health import AutoUpdater
from fretbook.auth import build_auth
from fretbook.backup.restore import register_restore_handler
from fretbook.config import Settings
from fretbook.context import AppContext
from fretbook.db.migrate import migrate
from fretbook.importers.safe_fetch import SafeFetcher
from fretbook.inbox import InboxWatcher
from fretbook.jobs.handlers import register_handlers
from fretbook.jobs.registry import register_kinds
from fretbook.jobs.runner import JobRunner
from fretbook.score.legacy import legacy_document, load_legacy_dir
from fretbook.storage.media import MediaStore
from fretbook.storage.repository import SongRepository
from fretbook.storage.users import UserStore

logger = logging.getLogger("fretbook")

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("font/woff", ".woff")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("application/octet-stream", ".sf2")
mimetypes.add_type("application/octet-stream", ".sf3")

_BASE_TAG = re.compile(r"<base\s+href=(['\"]).*?\1\s*/?>", re.IGNORECASE)

_PLACEHOLDER = """<!doctype html>
<meta charset="utf-8">
<title>Fretbook</title>
<p>Fretbook's API is up, but the web app has not been built.</p>
<p>From the repository root: <code>cd web && npm ci && npm run build</code>, then reload.</p>
"""


def resolve_static(settings: Settings) -> Path | None:
    candidates: list[Path] = []
    if settings.static_dir:
        candidates.append(settings.static_dir)
    package_static = Path(__file__).resolve().parent / "static"
    repo_dist = Path(__file__).resolve().parents[1] / "web" / "dist"
    candidates.extend([package_static, repo_dist])
    for candidate in candidates:
        if (candidate / "index.html").is_file():
            return candidate
    return None


def import_legacy(ctx: AppContext) -> int:
    """Import bass-tab-sync ``songs/<slug>/`` folders for the single local user.

    Only runs in single-user mode: with OIDC there is no obvious owner for them.
    """
    if ctx.settings.oidc_enabled:
        return 0
    root = ctx.settings.legacy_songs_dir
    if root is None or not root.is_dir():
        return 0
    owner = "local"
    imported = 0
    for folder in sorted(path for path in root.iterdir() if path.is_dir()):
        if not (folder / "tab-data.js").is_file():
            continue
        if ctx.songs.find_by_source(owner, "legacy", legacy_slug=folder.name):
            continue
        try:
            tab, preset = load_legacy_dir(folder)
            document = legacy_document(tab, preset)
        except (OSError, ValueError, KeyError, IndexError) as exc:
            logger.warning("skipping legacy song %s: %s", folder.name, exc)
            continue
        song = ctx.songs.create_song(
            owner,
            title=str(tab.get("title") or folder.name),
            artist=str(tab.get("artist") or ""),
            document=document,
            source_kind="legacy",
            source_ref={"legacy_slug": folder.name},
            slug=folder.name,
        )
        audio = folder / "audio.mp3"
        if audio.is_file():
            # The songs folder may be read-only, so copy rather than move.
            staging = ctx.settings.inbox_dir / f"legacy-{song['id']}.mp3"
            staging.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(audio, staging)
            ctx.media.save_file(
                owner,
                song["id"],
                kind="audio",
                filename="audio.mp3",
                content_type="audio/mpeg",
                source=staging,
            )
        imported += 1
    return imported


def create_app(
    settings: Settings | None = None,
    *,
    oidc_transport: httpx.AsyncBaseTransport | None = None,
    fetcher: SafeFetcher | None = None,
) -> FastAPI:
    """``oidc_transport`` and ``fetcher`` stand in for the network (the OIDC provider, pasted links) in tests."""
    settings = settings or Settings.from_env()
    songs = SongRepository(settings)
    users = UserStore(settings)
    media = MediaStore(settings)
    jobs = JobRunner(settings)
    register_handlers(jobs, songs, media, fetcher)
    register_restore_handler(jobs, songs, media)
    register_kinds(jobs)
    updater = AutoUpdater(settings)
    inbox = InboxWatcher(settings, songs, media) if settings.inbox_watch_dir else None
    ctx = AppContext(
        settings=settings,
        songs=songs,
        media=media,
        jobs=jobs,
        users=users,
        auth=build_auth(settings, users, transport=oidc_transport),
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        migrate(
            settings.database_path,
            backups_dir=settings.backups_dir,
            backup_keep=settings.migration_backups_keep,
        )
        songs.ensure_user("local", "Local")
        count = import_legacy(app.state.ctx)
        if count:
            logger.info("imported %s legacy song(s)", count)
        jobs.start()
        updater.start()
        if inbox:
            inbox.start()
        yield
        if inbox:
            inbox.stop()
        updater.stop()
        jobs.stop()

    app = FastAPI(
        title="Fretbook",
        version=__version__,
        description=(
            "JSON API for the web app. Every route is under /api. "
            'Errors use the shape {"detail": {"key", "message", "params"}}; '
            "the UI looks `key` up under `errors` and falls back to the English `message`. "
            "Single-user mode has no login: every request is the local user. "
            "With OIDC (FRETBOOK_OIDC_ISSUER set) a browser signs in through GET /auth/login, "
            "GET /auth/callback and POST /auth/logout, which are not JSON and not listed here; "
            "every route but /api/health then answers 401 auth.required without a session cookie or an API token."
        ),
        lifespan=lifespan,
        openapi_tags=[
            {
                "name": "meta",
                "description": "Server identity, instrument presets, and auth mode.",
            },
            {
                "name": "auth",
                "description": "Current user, their role, and per-user settings.",
            },
            {
                "name": "admin",
                "description": "OIDC mode, admins only: accounts, sessions, and the single-user library.",
            },
            {
                "name": "songs",
                "description": "Library, score documents, chord sheets, audio, and exports.",
            },
            {
                "name": "setlists",
                "description": "Ordered lists of songs with a note and a chord-sheet transpose per entry.",
            },
            {
                "name": "practice",
                "description": "Practice log: sessions, the daily goal, the dashboard, and a song's history.",
            },
            {
                "name": "imports",
                "description": "Start a background import. Poll GET /api/jobs/{job_id}.",
            },
            {
                "name": "library",
                "description": "Export the whole library as a zip and restore one. Restore is a background job.",
            },
            {
                "name": "jobs",
                "description": "Background job status, progress keys, and errors.",
            },
            {
                "name": "tags",
                "description": "Free-form tags and the favourite star on the caller's songs.",
            },
            {
                "name": "tokens",
                "description": (
                    "Personal API tokens for scripts. Send one as `Authorization: Bearer <token>` on any /api route; "
                    "it acts as its owner. Managing tokens needs a signed-in session, not a token."
                ),
            },
        ],
        # Output schemas mark defaulted fields as present, which is what responses actually send.
        separate_input_output_schemas=True,
    )
    app.state.ctx = ctx
    app.add_exception_handler(RequestValidationError, _validation_error)
    app.add_middleware(SameOriginMiddleware)
    # Room for multipart framing around the largest allowed upload.
    app.add_middleware(
        BodyLimitMiddleware,
        max_bytes=settings.max_upload_bytes + 1024 * 1024,
        path_limits={RESTORE_PATH: settings.max_restore_bytes + 1024 * 1024},
    )
    app.include_router(router)
    app.include_router(backup_router)
    app.include_router(ascii_tab_router)
    app.include_router(midi_router)
    app.include_router(retune_router)
    app.include_router(universal_router)
    app.include_router(tag_router)
    app.include_router(bulk_router)
    app.include_router(token_router)
    app.include_router(calibration_router)
    app.include_router(setlist_router)
    app.include_router(practice_router)
    auth_routes = ctx.auth.routes()
    if auth_routes is not None:
        app.include_router(auth_routes)

    def signed_out(request: Request, full_path: str) -> Response | None:
        """Send a browser without a session to sign in. Every page and asset is behind it."""
        try:
            ctx.auth.authenticate(request)
        except HTTPException as exc:
            target = ctx.auth.login_url(full_path + (f"?{request.url.query}" if request.url.query else ""))
            if exc.status_code == 401 and target:
                return RedirectResponse(target, status_code=302)
            raise
        return None

    @app.get("/", include_in_schema=False)
    def index(request: Request) -> Response:
        return signed_out(request, "") or _index(settings)

    @app.get("/{full_path:path}", include_in_schema=False)
    def assets(request: Request, full_path: str) -> Response:
        if full_path.startswith(("api/", "auth/")):
            raise HTTPException(status_code=404, detail="not found")
        if redirect := signed_out(request, full_path):
            return redirect
        static = resolve_static(settings)
        if static is None:
            return _index(settings)
        candidate = (static / full_path).resolve()
        root = static.resolve()
        if candidate.is_file() and candidate.is_relative_to(root):
            return FileResponse(candidate)
        return _index(settings)

    return app


async def _validation_error(_request: Request, exc: Exception) -> JSONResponse:
    # FastAPI's default handler echoes each rejected input back, which fails for NaN
    # (not valid JSON) and repeats whole documents. Location and message are enough.
    assert isinstance(exc, RequestValidationError)
    errors = [
        {"type": error.get("type"), "loc": list(error.get("loc", ())), "msg": error.get("msg")}
        for error in exc.errors()
    ]
    return JSONResponse({"detail": errors}, status_code=422)


def _index(settings: Settings) -> HTMLResponse:
    static = resolve_static(settings)
    if static is None:
        return HTMLResponse(_PLACEHOLDER)
    html = (static / "index.html").read_text(encoding="utf-8")
    base = settings.base_path
    html = _BASE_TAG.sub(lambda _match: f'<base href="{base}">', html, count=1)
    return HTMLResponse(html)
