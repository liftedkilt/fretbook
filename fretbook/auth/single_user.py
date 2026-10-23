from __future__ import annotations

from fastapi import APIRouter, Request

from fretbook.auth.base import Principal


class SingleUserAuth:
    """No login. One shared library owned by ``local``."""

    def authenticate(self, request: Request) -> Principal:
        del request
        return Principal(user_id="local", display_name="Local", authenticated=False)

    def routes(self) -> APIRouter | None:
        return None

    def login_url(self, next_path: str) -> str | None:
        del next_path
        return None
