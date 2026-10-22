"""Authentication hooks.

Single-user mode is the default: every request is the ``local`` user and
nothing is signed. Issue #5 replaces :class:`fretbook.auth.oidc.OIDCAuth`
with a Pocket ID authorization-code + PKCE flow. Routes already receive a
:class:`Principal` and every song row is stored with ``owner_id``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from fastapi import Request


@dataclass(frozen=True)
class Principal:
    user_id: str
    display_name: str
    authenticated: bool


class AuthBackend(Protocol):
    def authenticate(self, request: Request) -> Principal: ...
