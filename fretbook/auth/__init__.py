from __future__ import annotations

import httpx

from fretbook.auth.base import AuthBackend
from fretbook.auth.oidc import OIDCAuth
from fretbook.auth.single_user import SingleUserAuth
from fretbook.config import Settings
from fretbook.storage.users import UserStore


def build_auth(
    settings: Settings, users: UserStore, *, transport: httpx.AsyncBaseTransport | None = None
) -> AuthBackend:
    """``transport`` replaces the network for calls to the OIDC provider (tests use a mock)."""
    if settings.auth_mode in {"", "single", "none"}:
        return SingleUserAuth()
    if settings.auth_mode == "oidc":
        return OIDCAuth(settings, users, transport=transport)
    raise RuntimeError(f"Unknown FRETBOOK_AUTH_MODE={settings.auth_mode!r}. Use 'single' or 'oidc'.")
