"""Authentication backends.

Single-user mode is the default: every request is the ``local`` user and
there is no login. OIDC mode (:mod:`fretbook.auth.oidc`) signs users in through
a provider such as Pocket ID and maps its groups to the ``user`` and ``admin``
roles. Routes receive a :class:`Principal`, and every song row is stored with
``owner_id``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

from fastapi import APIRouter, Request

Role = Literal["user", "admin"]


@dataclass(frozen=True)
class Principal:
    user_id: str
    display_name: str
    authenticated: bool
    role: Role = "user"
    email: str = ""
    # True when the request carried a personal API token instead of a session.
    via_token: bool = False

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


class AuthBackend(Protocol):
    def authenticate(self, request: Request) -> Principal:
        """Return the caller, or raise a 401 ``auth.required`` error."""
        ...

    def routes(self) -> APIRouter | None:
        """Sign-in and sign-out endpoints, mounted at the app root."""
        ...

    def login_url(self, next_path: str) -> str | None:
        """Where a signed-out browser is sent for a page, or ``None`` when no login exists."""
        ...
