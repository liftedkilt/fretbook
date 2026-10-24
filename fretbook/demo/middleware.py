"""The read-only guard of ``FRETBOOK_DEMO_MODE``."""

from __future__ import annotations

import json
import re

from starlette.types import ASGIApp, Receive, Scope, Send

_UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}

# Writes a visitor can still make: they only record what they looked at or how they play, and the nightly reset
# clears them. Everything else (imports, uploads, edits, deletes, tags, setlists, tokens, backups) is refused.
_ALLOWED = (
    re.compile(r"^/api/songs/[^/]+/opened$"),
    re.compile(r"^/api/me/settings$"),
    re.compile(r"^/api/practice/(sessions|exercises)$"),
    re.compile(r"^/api/courses/[^/]+/lessons/[^/]+/(open|progress|check)$"),
)


class DemoReadOnlyMiddleware:
    """Answer 403 ``demo.readOnly`` to every write under ``/api`` that is not on the short allow-list."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] in _UNSAFE:
            path = scope["path"].removeprefix(scope.get("root_path", ""))
            if path.startswith("/api/") and not any(rule.match(path) for rule in _ALLOWED):
                body = json.dumps(
                    {
                        "detail": {
                            "key": "demo.readOnly",
                            "message": "this is a read-only demo; run your own Fretbook to change the library",
                            "params": {},
                        }
                    }
                ).encode()
                await send(
                    {
                        "type": "http.response.start",
                        "status": 403,
                        "headers": [
                            (b"content-type", b"application/json"),
                            (b"content-length", str(len(body)).encode()),
                        ],
                    }
                )
                await send({"type": "http.response.body", "body": body})
                return
        await self.app(scope, receive, send)
