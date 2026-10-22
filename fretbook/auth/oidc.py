"""Issue #5: Pocket ID (OIDC) sign-in.

The app stays in single-user mode until ``FRETBOOK_AUTH_MODE=oidc``. Selecting
that mode before this class is implemented returns 501, so a half-configured
deploy does not silently leave the library open.

Implement:

* ``GET /auth/login`` — redirect to the issuer's authorization endpoint with
  PKCE (S256). Discovery comes from ``FRETBOOK_OIDC_ISSUER``.
* ``GET /auth/callback`` — exchange the code. Client id is
  ``FRETBOOK_OIDC_CLIENT_ID``. ``FRETBOOK_OIDC_CLIENT_SECRET`` is optional
  (public PKCE clients). Redirect URI is ``FRETBOOK_OIDC_REDIRECT_URI``.
* Store the local user id in a secure session cookie signed with
  ``FRETBOOK_SESSION_SECRET``. Map the OIDC ``sub`` to
  ``users.external_subject`` (create the row on first login).
* ``authenticate`` reads that cookie and returns a :class:`Principal` with
  ``authenticated=True``. Missing or bad cookies are 401.
* ``POST /auth/logout`` clears the cookie.
* Honor ``X-Forwarded-Proto`` and ``Host`` (uvicorn proxy headers are already
  on). Scopes: ``openid profile email``.
* With no OIDC config, :func:`fretbook.auth.build_auth` must keep returning
  :class:`fretbook.auth.single_user.SingleUserAuth`.

Tests for the issue should use a mock OIDC provider and assert two users
cannot read each other's songs. The repository already filters on
``owner_id``.
"""

from __future__ import annotations

from fastapi import HTTPException, Request

from fretbook.auth.base import Principal
from fretbook.config import Settings


class OIDCAuth:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def authenticate(self, request: Request) -> Principal:
        del request
        raise HTTPException(
            status_code=501,
            detail=(
                "OIDC sign-in is issue #5 and is not implemented. "
                "See fretbook/auth/oidc.py. Unset FRETBOOK_AUTH_MODE to use single-user mode."
            ),
        )
