"""ASGI middleware: request size limit and a same-origin check for writes."""

from __future__ import annotations

import json
from urllib.parse import urlsplit

from fastapi import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

_UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}
_GUARDED = ("/api", "/auth")


async def _json_error(send: Send, status: int, key: str, message: str) -> None:
    body = json.dumps({"detail": {"key": key, "message": message, "params": {}}}).encode()
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
        }
    )
    await send({"type": "http.response.body", "body": body})


class _TooLarge(HTTPException):
    # An HTTPException, so FastAPI's body parsing re-raises it as a 413 instead of wrapping it in a 400.
    def __init__(self) -> None:
        super().__init__(413, {"key": "request.tooLarge", "message": "request body is too large", "params": {}})


class BodyLimitMiddleware:
    """Refuse request bodies over ``max_bytes``, whether or not they declare a Content-Length."""

    def __init__(self, app: ASGIApp, max_bytes: int, path_limits: dict[str, int] | None = None) -> None:
        self.app = app
        self.max_bytes = max_bytes
        # Larger limits for named routes (library restore); matched on the path without ``root_path``.
        self.path_limits = path_limits or {}

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers") or [])
        path = scope["path"].removeprefix(scope.get("root_path", ""))
        limit = max(self.max_bytes, self.path_limits.get(path, 0))
        declared = headers.get(b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > limit:
            await _json_error(send, 413, "request.tooLarge", "request body is too large")
            return
        seen = 0
        started = False

        async def counting_receive() -> Message:
            nonlocal seen
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > limit:
                    raise _TooLarge
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, counting_receive, tracking_send)
        except _TooLarge:
            if not started:
                await _json_error(send, 413, "request.tooLarge", "request body is too large")


class SameOriginMiddleware:
    """Reject cross-site writes to ``/api`` and ``/auth``.

    A browser sends ``Origin`` with cross-site POSTs, including multipart form
    posts that need no CORS preflight. A write whose Origin host differs from
    the Host it was sent to is refused, so another web page cannot import,
    upload, or delete in a library the viewer can reach. Requests without an
    Origin (curl, scripts) are allowed; auth decides those.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] == "http"
            and scope["method"] in _UNSAFE
            and scope["path"].startswith(_GUARDED + tuple(scope.get("root_path", "") + p for p in _GUARDED))
        ):
            headers = dict(scope.get("headers") or [])
            origin = headers.get(b"origin")
            if origin is not None:
                host = headers.get(b"host", b"").decode("latin-1").lower()
                origin_host = urlsplit(origin.decode("latin-1")).netloc.lower() if origin != b"null" else ""
                if not origin_host or origin_host != host:
                    await _json_error(send, 403, "request.crossOrigin", "cross-site requests are not allowed")
                    return
        await self.app(scope, receive, send)
