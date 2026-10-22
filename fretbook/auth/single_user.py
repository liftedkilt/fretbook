from __future__ import annotations

from fastapi import Request

from fretbook.auth.base import Principal


class SingleUserAuth:
    """No login. One shared library owned by ``local``."""

    def authenticate(self, request: Request) -> Principal:
        del request
        return Principal(user_id="local", display_name="Local", authenticated=False)
