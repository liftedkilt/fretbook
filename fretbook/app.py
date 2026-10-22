"""FastAPI application."""

from __future__ import annotations

import logging
import mimetypes
import re
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from starlette.responses import Response

from fretbook import __version__
from fretbook.api.routes import router
from fretbook.auth import build_auth
from fretbook.config import Settings
from fretbook.context import AppContext
from fretbook.db.migrate import migrate
from fretbook.jobs.handlers import register_handlers
from fretbook.jobs.runner import JobRunner
from fretbook.score.legacy import legacy_document, load_legacy_dir
from fretbook.storage.media import MediaStore
from fretbook.storage.repository import SongRepository

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


def _base_href(root_path: str) -> str:
    cleaned = "/" + root_path.strip("/")
    if cleaned == "/":
        return "/"
    return cleaned + "/"


def import_legacy(ctx: AppContext) -> int:
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
            ctx.media.save(
                owner,
                song["id"],
                kind="audio",
                filename="audio.mp3",
                content_type="audio/mpeg",
                data=audio.read_bytes(),
            )
        imported += 1
    return imported


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    songs = SongRepository(settings)
    media = MediaStore(settings)
    jobs = JobRunner(settings)
    register_handlers(jobs, songs, media)
    ctx = AppContext(
        settings=settings,
        songs=songs,
        media=media,
        jobs=jobs,
        auth=build_auth(settings),
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        migrate(settings.database_path)
        songs.ensure_user("local", "Local")
        count = import_legacy(app.state.ctx)
        if count:
            logger.info("imported %s legacy song(s)", count)
        jobs.start()
        yield
        jobs.stop()

    app = FastAPI(title="Fretbook", version=__version__, lifespan=lifespan)
    app.state.ctx = ctx
    app.include_router(router)

    @app.get("/")
    def index() -> HTMLResponse:
        return _index(settings)

    @app.get("/{full_path:path}")
    def assets(full_path: str) -> Response:
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="not found")
        static = resolve_static(settings)
        if static is None:
            return _index(settings)
        candidate = (static / full_path).resolve()
        root = static.resolve()
        if candidate.is_file() and candidate.is_relative_to(root):
            return FileResponse(candidate)
        return _index(settings)

    return app


def _index(settings: Settings) -> HTMLResponse:
    static = resolve_static(settings)
    if static is None:
        return HTMLResponse(_PLACEHOLDER)
    html = (static / "index.html").read_text(encoding="utf-8")
    base = _base_href(settings.root_path)
    html = _BASE_TAG.sub(lambda _match: f'<base href="{base}">', html, count=1)
    return HTMLResponse(html)
