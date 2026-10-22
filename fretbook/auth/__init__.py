from __future__ import annotations

from fretbook.auth.base import AuthBackend
from fretbook.auth.oidc import OIDCAuth
from fretbook.auth.single_user import SingleUserAuth
from fretbook.config import Settings


def build_auth(settings: Settings) -> AuthBackend:
    if settings.auth_mode in {"", "single", "none"}:
        return SingleUserAuth()
    if settings.auth_mode == "oidc":
        return OIDCAuth(settings)
    raise RuntimeError(
        f"Unknown FRETBOOK_AUTH_MODE={settings.auth_mode!r}. Use 'single' or 'oidc'."
    )
