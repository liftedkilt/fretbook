"""Serving the built web app's files: gzip for text, and cache headers that match how Vite names files."""

from __future__ import annotations

import gzip
import mimetypes
from functools import lru_cache
from pathlib import Path

from fastapi import Request
from fastapi.responses import FileResponse
from starlette.responses import Response

# Text formats shrink to a third or less. Fonts (woff2), images and the soundfont are already compressed.
_COMPRESSIBLE = {".css", ".html", ".js", ".json", ".map", ".mjs", ".svg", ".txt", ".webmanifest"}
_MIN_BYTES = 1024
# Vite puts a content hash in every name under assets/, so a changed file has a new URL. Pages are
# behind sign-in, hence ``private``.
IMMUTABLE = "private, max-age=31536000, immutable"
# Everything else (the service worker, the manifest, icons, fonts) keeps its name between builds:
# the browser may store it but asks first, and gets a 304 when the ETag still matches.
REVALIDATE = "no-cache"


@lru_cache(maxsize=64)
def _gzipped(path: str, mtime_ns: int, size: int) -> bytes:
    del mtime_ns, size  # only part of the cache key, so a rebuilt file is compressed again
    return gzip.compress(Path(path).read_bytes(), compresslevel=6, mtime=0)


def _accepts_gzip(request: Request) -> bool:
    for part in request.headers.get("accept-encoding", "").split(","):
        name, _, params = part.strip().partition(";")
        if name.strip().lower() == "gzip":
            return params.replace(" ", "").lower() not in {"q=0", "q=0.0", "q=0.00", "q=0.000"}
    return False


def static_response(request: Request, path: Path, relative: str) -> Response:
    """``path`` (already checked to be a file inside the static folder), requested as ``relative``."""
    cache = IMMUTABLE if relative.startswith("assets/") else REVALIDATE
    stat = path.stat()
    if path.suffix.lower() not in _COMPRESSIBLE or stat.st_size < _MIN_BYTES:
        return FileResponse(path, headers={"Cache-Control": cache})
    headers = {"Cache-Control": cache, "Vary": "Accept-Encoding"}
    # A Range request is for bytes of the file itself, which a compressed body would not be.
    if not _accepts_gzip(request) or "range" in request.headers:
        return FileResponse(path, headers=headers)
    etag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}-gz"'
    headers["ETag"] = etag
    if etag in {item.strip().removeprefix("W/") for item in request.headers.get("if-none-match", "").split(",")}:
        return Response(status_code=304, headers=headers)
    body = _gzipped(str(path), stat.st_mtime_ns, stat.st_size)
    headers["Content-Encoding"] = "gzip"
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return Response(body, media_type=media_type, headers=headers)
