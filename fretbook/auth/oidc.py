"""OIDC sign-in (Pocket ID or any OpenID Connect provider).

Authorization code flow with PKCE (S256). Endpoints come from the issuer's
discovery document. ``FRETBOOK_OIDC_CLIENT_SECRET`` is optional, for
confidential clients.

* ``GET /auth/login?next=…`` stores state, nonce, the PKCE verifier and the
  return path in a short-lived cookie signed with ``FRETBOOK_SESSION_SECRET``
  and redirects to the provider.
* ``GET /auth/callback`` checks the state, exchanges the code, verifies the ID
  token (signature from the JWKS, issuer, audience, expiry, nonce), and reads
  the groups claim. Members of ``FRETBOOK_OIDC_ADMIN_GROUP`` are admins, members
  of ``FRETBOOK_OIDC_USER_GROUP`` are users, anyone else is refused. Roles are
  re-read at every sign-in, and a refused sign-in by a known user ends their sessions and suspends their API
  tokens until they are admitted again.
* The session is server-side: the cookie holds a random token and the database
  its hash. Cookies are ``HttpOnly`` and ``SameSite=Lax``, and ``Secure`` when the
  redirect URI is https.
* ``POST /auth/logout`` ends the session and sends the browser to the
  provider's ``end_session_endpoint`` when it has one.

The callback URL is ``FRETBOOK_OIDC_REDIRECT_URI``, never built from request
headers, so a forged ``Host`` cannot redirect codes elsewhere.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import html
import json
import logging
import re
import secrets
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote, urlencode, urlsplit

import httpx
import jwt
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response

from fretbook.api.errors import api_error
from fretbook.auth.base import Principal, Role
from fretbook.config import Settings
from fretbook.storage.users import UserStore

logger = logging.getLogger("fretbook.auth")

SESSION_COOKIE = "fretbook_session"
LOGIN_COOKIE = "fretbook_login"
_LOGIN_TTL = 600
_DISCOVERY_TTL = 3600
_ALLOWED_ALGS = {"RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA"}
_NEXT = re.compile(r"[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*")


class SignInError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


@dataclass
class _Provider:
    issuer: str
    authorization_endpoint: str
    token_endpoint: str
    jwks_uri: str
    userinfo_endpoint: str
    end_session_endpoint: str
    algorithms: set[str]
    basic_auth: bool
    fetched: float


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _safe_next(raw: str) -> str:
    """A path relative to the app's base, so the redirect after sign-in cannot leave the app."""
    cleaned = raw.lstrip("/")
    if "\\" in cleaned or not _NEXT.fullmatch(cleaned):
        return ""
    return cleaned


def _role(groups: list[str], settings: Settings) -> Role | None:
    if settings.oidc_admin_group and settings.oidc_admin_group in groups:
        return "admin"
    if not settings.oidc_user_group or settings.oidc_user_group in groups:
        return "user"
    return None


def _groups(value: Any) -> list[str]:
    if isinstance(value, str):
        return [part for part in re.split(r"[\s,]+", value) if part]
    if isinstance(value, list):
        return [str(item) for item in value]
    return []


def _page(status: int, title: str, message: str, base: str) -> HTMLResponse:
    body = f"""<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fretbook</title>
<style>body{{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5}}</style>
<h1>{html.escape(title)}</h1>
<p>{html.escape(message)}</p>
<p><a href="{html.escape(base)}auth/login">Sign in again</a></p>
"""
    return HTMLResponse(body, status_code=status)


class OIDCAuth:
    def __init__(
        self, settings: Settings, users: UserStore, *, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        missing = [
            name
            for name, value in (
                ("FRETBOOK_OIDC_ISSUER", settings.oidc_issuer),
                ("FRETBOOK_OIDC_CLIENT_ID", settings.oidc_client_id),
                ("FRETBOOK_OIDC_REDIRECT_URI", settings.oidc_redirect_uri),
                ("FRETBOOK_SESSION_SECRET", settings.session_secret),
            )
            if not value
        ]
        if missing:
            raise RuntimeError(f"FRETBOOK_AUTH_MODE=oidc needs {', '.join(missing)}.")
        if len(settings.session_secret) < 32:
            raise RuntimeError("FRETBOOK_SESSION_SECRET must be at least 32 characters (try `openssl rand -hex 32`).")
        self.settings = settings
        self.users = users
        self.transport = transport
        self.base = settings.base_path
        self.secure = urlsplit(settings.oidc_redirect_uri).scheme == "https"
        self._provider: _Provider | None = None
        self._jwks: jwt.PyJWKSet | None = None

    # --- AuthBackend --------------------------------------------------------

    def authenticate(self, request: Request) -> Principal:
        token = request.cookies.get(SESSION_COOKIE)
        found = self.users.find_session(_hash_token(token)) if token else None
        if found is None:
            raise api_error(401, "auth.required", "sign in to use Fretbook")
        return Principal(
            user_id=found["user_id"],
            display_name=found["display_name"],
            authenticated=True,
            role=found["role"],
            email=found["email"],
        )

    def login_url(self, next_path: str) -> str | None:
        target = _safe_next(next_path)
        return f"{self.base}auth/login" + (f"?next={quote(target, safe='/')}" if target else "")

    def routes(self) -> APIRouter:
        router = APIRouter()
        router.add_api_route("/auth/login", self.login, methods=["GET"])
        router.add_api_route("/auth/callback", self.callback, methods=["GET"])
        router.add_api_route("/auth/logout", self.logout, methods=["POST"])
        return router

    # --- endpoints ----------------------------------------------------------

    async def login(self, next: str = "") -> Response:
        try:
            provider = await self._discover()
        except (httpx.HTTPError, SignInError, ValueError, KeyError) as exc:
            logger.warning("OIDC discovery failed: %s", exc)
            return _page(502, "Sign-in is unavailable", "The sign-in provider could not be reached.", self.base)
        state = secrets.token_urlsafe(32)
        nonce = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(64)
        challenge = _b64(hashlib.sha256(verifier.encode()).digest())
        query = urlencode(
            {
                "response_type": "code",
                "client_id": self.settings.oidc_client_id,
                "redirect_uri": self.settings.oidc_redirect_uri,
                "scope": self.settings.oidc_scopes,
                "state": state,
                "nonce": nonce,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            }
        )
        separator = "&" if "?" in provider.authorization_endpoint else "?"
        response = RedirectResponse(provider.authorization_endpoint + separator + query, status_code=302)
        pending = {"state": state, "nonce": nonce, "verifier": verifier, "next": _safe_next(next)}
        cookie = self._sign({**pending, "exp": time.time() + _LOGIN_TTL})
        self._set_cookie(response, LOGIN_COOKIE, cookie, _LOGIN_TTL)
        return response

    async def callback(
        self, request: Request, code: str = "", state: str = "", error: str = "", error_description: str = ""
    ) -> Response:
        pending = self._unsign(request.cookies.get(LOGIN_COOKIE, ""))
        try:
            if error:
                raise SignInError(400, error_description or f"The provider returned {error}.")
            if pending is None or pending.get("exp", 0) < time.time():
                raise SignInError(400, "The sign-in attempt expired or was started in another browser.")
            if not code or not hmac.compare_digest(str(pending.get("state", "")), state):
                raise SignInError(400, "The sign-in response did not match this browser's request.")
            claims, id_token = await self._exchange(code, str(pending["verifier"]), str(pending["nonce"]))
            role = _role(_groups(claims.get(self.settings.oidc_groups_claim)), self.settings)
            if role is None:
                # Also ends their sessions and refuses their API tokens, which are otherwise checked only here.
                self.users.deny_access(str(claims["sub"]))
                raise SignInError(
                    403, f"Your account is not in the {self.settings.oidc_user_group} group, so it cannot use Fretbook."
                )
        except SignInError as exc:
            response = _page(exc.status, "Could not sign in", str(exc), self.base)
            self._clear_cookie(response, LOGIN_COOKIE)
            return response
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            logger.warning("OIDC sign-in failed: %s", exc)
            response = _page(502, "Could not sign in", "The sign-in provider could not be reached.", self.base)
            self._clear_cookie(response, LOGIN_COOKIE)
            return response

        subject = str(claims["sub"])
        email = str(claims.get("email") or "")
        name = str(claims.get("name") or claims.get("preferred_username") or email or subject)
        user_id = self.users.sign_in(subject=subject, display_name=name[:200], email=email[:320], role=role)
        token = secrets.token_urlsafe(32)
        self.users.create_session(user_id, token_hash=_hash_token(token), role=role, id_token=id_token)
        logger.info("signed in %s as %s", user_id, role)

        redirect = RedirectResponse(self.base + str(pending.get("next") or ""), status_code=302)
        self._clear_cookie(redirect, LOGIN_COOKIE)
        self._set_cookie(redirect, SESSION_COOKIE, token, self.settings.session_max_age)
        return redirect

    async def logout(self, request: Request) -> Response:
        token = request.cookies.get(SESSION_COOKIE)
        id_token = self.users.end_session(_hash_token(token)) if token else ""
        target = self.base
        try:
            provider = await self._discover()
        except (httpx.HTTPError, SignInError, ValueError, KeyError):
            provider = None
        if provider and provider.end_session_endpoint:
            params = {"client_id": self.settings.oidc_client_id}
            if id_token:
                params["id_token_hint"] = id_token
            if self.settings.oidc_post_logout_redirect_uri:
                params["post_logout_redirect_uri"] = self.settings.oidc_post_logout_redirect_uri
            separator = "&" if "?" in provider.end_session_endpoint else "?"
            target = provider.end_session_endpoint + separator + urlencode(params)
        # 303 so the browser follows a POST with a GET.
        response = RedirectResponse(target, status_code=303)
        self._clear_cookie(response, SESSION_COOKIE)
        return response

    # --- provider -----------------------------------------------------------

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=self.transport, timeout=15, follow_redirects=False)

    async def _discover(self) -> _Provider:
        if self._provider and time.monotonic() - self._provider.fetched < _DISCOVERY_TTL:
            return self._provider
        url = self.settings.oidc_issuer.rstrip("/") + "/.well-known/openid-configuration"
        async with self._client() as client:
            response = await client.get(url)
            response.raise_for_status()
            doc = response.json()
        issuer = str(doc.get("issuer", ""))
        if issuer.rstrip("/") != self.settings.oidc_issuer.rstrip("/"):
            raise SignInError(502, f"The provider says its issuer is {issuer!r}, not {self.settings.oidc_issuer!r}.")
        algorithms = set(doc.get("id_token_signing_alg_values_supported") or ["RS256"]) & _ALLOWED_ALGS
        methods = doc.get("token_endpoint_auth_methods_supported") or ["client_secret_basic"]
        self._provider = _Provider(
            issuer=issuer,
            authorization_endpoint=str(doc["authorization_endpoint"]),
            token_endpoint=str(doc["token_endpoint"]),
            jwks_uri=str(doc["jwks_uri"]),
            userinfo_endpoint=str(doc.get("userinfo_endpoint") or ""),
            end_session_endpoint=str(doc.get("end_session_endpoint") or ""),
            algorithms=algorithms or {"RS256"},
            basic_auth="client_secret_basic" in methods,
            fetched=time.monotonic(),
        )
        return self._provider

    async def _signing_key(self, provider: _Provider, kid: str | None) -> jwt.PyJWK:
        for refresh in (False, True):
            if self._jwks is None or refresh:
                async with self._client() as client:
                    response = await client.get(provider.jwks_uri)
                    response.raise_for_status()
                    self._jwks = jwt.PyJWKSet.from_dict(response.json())
            keys = self._jwks.keys
            if kid is None and len(keys) == 1:
                return keys[0]
            for key in keys:
                if key.key_id == kid:
                    return key
        raise SignInError(502, "The ID token was signed with a key the provider does not publish.")

    async def _exchange(self, code: str, verifier: str, nonce: str) -> tuple[dict[str, Any], str]:
        provider = await self._discover()
        form = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": self.settings.oidc_redirect_uri,
            "code_verifier": verifier,
            "client_id": self.settings.oidc_client_id,
        }
        auth: httpx.BasicAuth | None = None
        if self.settings.oidc_client_secret:
            if provider.basic_auth:
                auth = httpx.BasicAuth(
                    quote(self.settings.oidc_client_id, safe=""), quote(self.settings.oidc_client_secret, safe="")
                )
            else:
                form["client_secret"] = self.settings.oidc_client_secret
        async with self._client() as client:
            response = await client.post(provider.token_endpoint, data=form, auth=auth or httpx.USE_CLIENT_DEFAULT)
        if response.status_code != 200:
            logger.warning("OIDC token exchange failed: %s %s", response.status_code, response.text[:300])
            raise SignInError(400, "The provider refused the sign-in code.")
        tokens = response.json()
        id_token = str(tokens.get("id_token") or "")
        if not id_token:
            raise SignInError(502, "The provider did not return an ID token.")

        try:
            header = jwt.get_unverified_header(id_token)
            alg = header.get("alg", "")
            if alg not in provider.algorithms:
                raise SignInError(502, f"The ID token uses an unexpected algorithm ({alg}).")
            key = await self._signing_key(provider, header.get("kid"))
            claims = jwt.decode(
                id_token,
                key=key.key,
                algorithms=[alg],
                audience=self.settings.oidc_client_id,
                issuer=provider.issuer,
                leeway=60,
                options={"require": ["exp", "iat", "iss", "aud", "sub"]},
            )
        except jwt.PyJWTError as exc:
            logger.warning("OIDC ID token rejected: %s", exc)
            raise SignInError(400, "The provider's ID token was not valid.") from None
        if not hmac.compare_digest(str(claims.get("nonce", "")), nonce):
            raise SignInError(400, "The ID token was not issued for this sign-in.")

        # Pocket ID puts groups in the ID token; other providers may only return them from userinfo.
        access_token = tokens.get("access_token")
        if self.settings.oidc_groups_claim not in claims and provider.userinfo_endpoint and access_token:
            async with self._client() as client:
                info = await client.get(provider.userinfo_endpoint, headers={"Authorization": f"Bearer {access_token}"})
            if info.status_code == 200:
                extra = info.json()
                if extra.get("sub") == claims["sub"]:
                    claims = {**extra, **claims}
        return claims, id_token

    # --- cookies ------------------------------------------------------------

    def _sign(self, payload: dict[str, Any]) -> str:
        body = _b64(json.dumps(payload, separators=(",", ":")).encode())
        mac = hmac.new(self.settings.session_secret.encode(), body.encode(), hashlib.sha256).digest()
        return f"{body}.{_b64(mac)}"

    def _unsign(self, value: str) -> dict[str, Any] | None:
        body, _, mac = value.partition(".")
        if not body or not mac:
            return None
        expected = _b64(hmac.new(self.settings.session_secret.encode(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(expected, mac):
            return None
        try:
            payload = json.loads(_unb64(body))
        except ValueError:
            return None
        return payload if isinstance(payload, dict) else None

    def _set_cookie(self, response: Response, name: str, value: str, max_age: int) -> None:
        response.set_cookie(
            name, value, max_age=max_age, path=self.base, secure=self.secure, httponly=True, samesite="lax"
        )

    def _clear_cookie(self, response: Response, name: str) -> None:
        response.delete_cookie(name, path=self.base, secure=self.secure, httponly=True, samesite="lax")
