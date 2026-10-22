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
* Store the local user id in a session cookie signed with
  ``FRETBOOK_SESSION_SECRET``: ``HttpOnly``, ``Secure``, ``SameSite=Lax``.
  Map the OIDC ``sub`` to ``users.external_subject`` and create the row on
  first login with a new internal ``users.id`` (a uuid hex). Never use the
  ``sub`` itself as the id: it names directories under ``media/``.
* ``authenticate`` reads that cookie and returns a :class:`Principal` with
  ``authenticated=True``. Missing or bad cookies are 401.
* ``POST /auth/logout`` clears the cookie.
* Build the callback from ``FRETBOOK_OIDC_REDIRECT_URI``, not from request
  headers. Uvicorn trusts ``X-Forwarded-*`` only from
  ``FRETBOOK_FORWARDED_ALLOW_IPS`` (default ``127.0.0.1``). Scopes:
  ``openid profile email``.
* ``SameOriginMiddleware`` already refuses cross-site writes to ``/api``;
  keep it in front of cookie auth.
* Songs owned by ``local`` (single-user mode, legacy imports) are not visible
  to OIDC users. If an install switches modes, decide whether the first
  login claims them.
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
