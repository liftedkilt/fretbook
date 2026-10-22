"""OIDC sign-in against a mock provider served through an httpx transport."""

import base64
import hashlib
import json
import secrets
import time
from dataclasses import replace
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from fretbook.app import create_app
from fretbook.auth import build_auth
from fretbook.config import Settings
from fretbook.storage.users import UserStore

ISSUER = "https://id.example.test"
CLIENT_ID = "fretbook-client"
REDIRECT = "http://testserver/auth/callback"


class MockProvider:
    """Discovery, JWKS, token and userinfo endpoints of a Pocket ID-like provider."""

    def __init__(self) -> None:
        self.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(self.key.public_key()))
        self.jwks = {"keys": [{**jwk, "kid": "k1", "use": "sig", "alg": "RS256"}]}
        self.codes: dict[str, dict] = {}
        self.overrides: dict = {}
        self.token_requests: list[httpx.Request] = []

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)

    def handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/.well-known/openid-configuration":
            return httpx.Response(
                200,
                json={
                    "issuer": ISSUER,
                    "authorization_endpoint": f"{ISSUER}/authorize",
                    "token_endpoint": f"{ISSUER}/api/oidc/token",
                    "userinfo_endpoint": f"{ISSUER}/api/oidc/userinfo",
                    "jwks_uri": f"{ISSUER}/.well-known/jwks.json",
                    "end_session_endpoint": f"{ISSUER}/api/oidc/end-session",
                    "id_token_signing_alg_values_supported": ["RS256"],
                    "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post"],
                },
            )
        if path == "/.well-known/jwks.json":
            return httpx.Response(200, json=self.jwks)
        if path == "/api/oidc/token":
            self.token_requests.append(request)
            form = {key: values[0] for key, values in parse_qs(request.content.decode()).items()}
            grant = self.codes.pop(form.get("code", ""), None)
            if grant is None or form.get("redirect_uri") != REDIRECT or form.get("client_id") != CLIENT_ID:
                return httpx.Response(400, json={"error": "invalid_grant"})
            challenge = base64.urlsafe_b64encode(hashlib.sha256(form["code_verifier"].encode()).digest())
            if challenge.rstrip(b"=").decode() != grant["code_challenge"]:
                return httpx.Response(400, json={"error": "invalid_grant", "error_description": "PKCE"})
            now = int(time.time())
            claims = {
                "iss": ISSUER,
                "aud": CLIENT_ID,
                "sub": grant["sub"],
                "iat": now,
                "exp": now + 300,
                "nonce": grant["nonce"],
                "name": grant["name"],
                "email": f"{grant['sub']}@example.test",
                "groups": grant["groups"],
                **self.overrides,
            }
            id_token = jwt.encode(claims, self.key, algorithm="RS256", headers={"kid": "k1"})
            return httpx.Response(200, json={"access_token": "at", "token_type": "Bearer", "id_token": id_token})
        return httpx.Response(404)

    def authorize(self, location: str, *, sub: str, groups: list[str], name: str = "") -> tuple[str, str]:
        """What the provider does on its sign-in page: check the request and issue a code."""
        url = urlsplit(location)
        assert f"{url.scheme}://{url.netloc}{url.path}" == f"{ISSUER}/authorize"
        query = {key: values[0] for key, values in parse_qs(url.query).items()}
        assert query["response_type"] == "code"
        assert query["client_id"] == CLIENT_ID
        assert query["redirect_uri"] == REDIRECT
        assert query["code_challenge_method"] == "S256"
        assert set(query["scope"].split()) >= {"openid", "profile", "email", "groups"}
        code = secrets.token_urlsafe(16)
        self.codes[code] = {
            "sub": sub,
            "groups": groups,
            "name": name or sub.title(),
            "nonce": query["nonce"],
            "code_challenge": query["code_challenge"],
        }
        return code, query["state"]


def _settings(tmp_path: Path, **changes) -> Settings:
    base = Settings.for_tests(tmp_path)
    values = {
        "auth_mode": "oidc",
        "oidc_issuer": ISSUER,
        "oidc_client_id": CLIENT_ID,
        "oidc_client_secret": "shh",
        "oidc_redirect_uri": REDIRECT,
        "session_secret": "s" * 40,
    }
    return replace(base, **{**values, **changes})


@pytest.fixture
def provider() -> MockProvider:
    return MockProvider()


@pytest.fixture
def app_factory(tmp_path: Path, provider: MockProvider):
    def make(**changes):
        return create_app(_settings(tmp_path, **changes), oidc_transport=provider.transport())

    return make


def sign_in(
    client: TestClient, provider: MockProvider, sub: str, groups: list[str], next_path: str = ""
) -> httpx.Response:
    login = client.get("/auth/login", params={"next": next_path} if next_path else None, follow_redirects=False)
    assert login.status_code == 302
    code, state = provider.authorize(login.headers["location"], sub=sub, groups=groups)
    return client.get("/auth/callback", params={"code": code, "state": state}, follow_redirects=False)


def test_signed_out_requests_are_blocked(app_factory) -> None:
    with TestClient(app_factory()) as client:
        assert client.get("/api/health").status_code == 200
        for path in ("/api/songs", "/api/me", "/api/meta", "/api/admin/users"):
            response = client.get(path)
            assert response.status_code == 401, path
            assert response.json()["detail"]["key"] == "auth.required"
        assert client.post("/api/songs", json={"title": "x"}).status_code == 401
        page = client.get("/", follow_redirects=False)
        assert page.status_code == 302
        assert page.headers["location"] == "/auth/login"
        deep = client.get("/songs/abc/edit", follow_redirects=False)
        assert deep.headers["location"] == "/auth/login?next=songs/abc/edit"
        assert client.get("/favicon.svg", follow_redirects=False).status_code == 302


def test_sign_in_and_out(app_factory, provider: MockProvider) -> None:
    with TestClient(app_factory()) as client:
        done = sign_in(client, provider, "alice", ["fretbook_users"], next_path="songs/abc")
        assert done.status_code == 302
        assert done.headers["location"] == "/songs/abc"
        cookie = done.headers["set-cookie"]
        assert "fretbook_session=" in cookie and "HttpOnly" in cookie and "SameSite=lax" in cookie

        # A confidential client authenticates with HTTP Basic.
        assert provider.token_requests[-1].headers["authorization"].startswith("Basic ")

        me = client.get("/api/me").json()
        assert me["authenticated"] is True
        assert me["role"] == "user"
        assert me["display_name"] == "Alice"
        assert me["email"] == "alice@example.test"
        assert me["user_id"] != "alice"
        assert client.get("/", follow_redirects=False).status_code == 200

        out = client.post("/auth/logout", follow_redirects=False)
        assert out.status_code == 303
        target = urlsplit(out.headers["location"])
        assert target.path == "/api/oidc/end-session"
        assert parse_qs(target.query)["id_token_hint"]
        assert client.get("/api/me").status_code == 401

        # Signing in again maps the same sub to the same internal user.
        sign_in(client, provider, "alice", ["fretbook_users"])
        assert client.get("/api/me").json()["user_id"] == me["user_id"]


def test_users_cannot_see_each_others_songs(app_factory, provider: MockProvider) -> None:
    app = app_factory()
    with TestClient(app) as alice, TestClient(app) as bob:
        sign_in(alice, provider, "alice", ["fretbook_users"])
        sign_in(bob, provider, "bob", ["fretbook_users"])
        song = alice.post("/api/songs", json={"title": "Mine", "measures": 1}).json()
        song_id = song["id"]
        assert [item["id"] for item in alice.get("/api/songs").json()] == [song_id]

        assert bob.get("/api/songs").json() == []
        assert bob.get(f"/api/songs/{song_id}").status_code == 404
        assert bob.get(f"/api/songs/{song_id}/export.json").status_code == 404
        assert bob.get(f"/api/songs/{song_id}/audio").status_code == 404
        update = {"title": "Stolen", "revision": song["revision"], "document": song["document"]}
        assert bob.put(f"/api/songs/{song_id}", json=update).status_code == 404
        assert bob.delete(f"/api/songs/{song_id}").status_code == 404
        assert alice.get(f"/api/songs/{song_id}").json()["title"] == "Mine"


def test_groups_decide_access_and_role(app_factory, provider: MockProvider) -> None:
    app = app_factory()
    with TestClient(app) as outsider, TestClient(app) as user, TestClient(app) as admin:
        refused = sign_in(outsider, provider, "eve", ["other"])
        assert refused.status_code == 403
        assert "fretbook_users" in refused.text
        assert "fretbook_session" not in refused.headers.get("set-cookie", "")
        assert outsider.get("/api/me").status_code == 401

        sign_in(user, provider, "uma", ["fretbook_users"])
        sign_in(admin, provider, "ada", ["fretbook_admins"])
        assert admin.get("/api/me").json()["role"] == "admin"

        assert user.get("/api/admin/users").json()["detail"]["key"] == "auth.adminOnly"
        assert user.post("/api/admin/adopt-local").status_code == 403
        listed = {row["display_name"]: row for row in admin.get("/api/admin/users").json()}
        assert listed["Uma"]["role"] == "user" and listed["Uma"]["session_count"] == 1
        assert listed["Ada"]["role"] == "admin"
        assert listed["Local"]["local"] is True
        assert "eve" not in {row["display_name"].lower() for row in listed.values()}

        # Ending a user's sessions signs them out at once.
        assert admin.post(f"/api/admin/users/{listed['Uma']['id']}/sign-out").json() == {"ended": 1}
        assert user.get("/api/me").status_code == 401
        assert admin.post("/api/admin/users/nobody/sign-out").status_code == 404

        # Roles are re-read at every sign-in.
        sign_in(user, provider, "uma", ["fretbook_users", "fretbook_admins"])
        assert user.get("/api/me").json()["role"] == "admin"


def test_empty_user_group_admits_everyone(app_factory, provider: MockProvider) -> None:
    with TestClient(app_factory(oidc_user_group="")) as client:
        assert sign_in(client, provider, "anyone", []).status_code == 302
        assert client.get("/api/me").json()["role"] == "user"


def test_admin_adopts_single_user_library(app_factory, provider: MockProvider) -> None:
    app = app_factory()
    with TestClient(app) as admin:
        sign_in(admin, provider, "ada", ["fretbook_admins"])
        songs = app.state.ctx.songs
        songs.create_song("local", title="Old", artist="", source_kind="manual", chordpro="[G]Hi")
        mine = admin.post("/api/songs", json={"content_kind": "chords", "title": "Old", "chordpro": "[C]Yo"}).json()
        assert admin.post("/api/admin/adopt-local").json() == {"moved": 1}
        listed = admin.get("/api/songs").json()
        assert sorted(item["slug"] for item in listed) == ["old", "old-2"]
        assert mine["slug"] == "old"
        assert songs.list_songs("local") == []


def test_rejects_forged_or_mismatched_callbacks(app_factory, provider: MockProvider) -> None:
    with TestClient(app_factory()) as client:
        # No login cookie.
        assert client.get("/auth/callback", params={"code": "x", "state": "y"}).status_code == 400

        login = client.get("/auth/login", follow_redirects=False)
        code, state = provider.authorize(login.headers["location"], sub="mallory", groups=["fretbook_users"])
        assert client.get("/auth/callback", params={"code": code, "state": state + "x"}).status_code == 400
        # A failed callback uses up the attempt.
        assert client.get("/auth/callback", params={"code": code, "state": state}).status_code == 400

        # A tampered login cookie is ignored.
        login = client.get("/auth/login", follow_redirects=False)
        code, state = provider.authorize(login.headers["location"], sub="mallory", groups=["fretbook_users"])
        client.cookies.set("fretbook_login", client.cookies["fretbook_login"][:-2] + "AA")
        assert client.get("/auth/callback", params={"code": code, "state": state}).status_code == 400

        assert client.get("/auth/callback", params={"error": "access_denied"}).status_code == 400
        assert client.get("/api/me").status_code == 401


@pytest.mark.parametrize(
    "override",
    [{"aud": "someone-else"}, {"iss": "https://evil.test"}, {"nonce": "replayed"}, {"exp": int(time.time()) - 3600}],
)
def test_rejects_bad_id_tokens(app_factory, provider: MockProvider, override: dict) -> None:
    provider.overrides = override
    with TestClient(app_factory()) as client:
        assert sign_in(client, provider, "alice", ["fretbook_users"]).status_code == 400
        assert client.get("/api/me").status_code == 401


def test_rejects_token_signed_by_another_key(app_factory, provider: MockProvider) -> None:
    provider.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    with TestClient(app_factory()) as client:
        assert sign_in(client, provider, "alice", ["fretbook_users"]).status_code == 400


def test_logout_refuses_cross_site_posts(app_factory, provider: MockProvider) -> None:
    with TestClient(app_factory()) as client:
        sign_in(client, provider, "alice", ["fretbook_users"])
        refused = client.post("/auth/logout", headers={"Origin": "https://evil.test"})
        assert refused.status_code == 403
        assert client.get("/api/me").status_code == 200


def test_cookies_are_secure_behind_https(tmp_path: Path, provider: MockProvider) -> None:
    settings = _settings(tmp_path, oidc_redirect_uri="https://music.example.test/fretbook/auth/callback")
    settings = replace(settings, root_path="/fretbook")
    with TestClient(create_app(settings, oidc_transport=provider.transport())) as client:
        login = client.get("/auth/login", follow_redirects=False)
        cookie = login.headers["set-cookie"]
        assert "Secure" in cookie and "Path=/fretbook/" in cookie
        assert "redirect_uri=https%3A%2F%2Fmusic.example.test%2Ffretbook%2Fauth%2Fcallback" in login.headers["location"]


def test_configuration(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    users = UserStore(Settings.for_tests(tmp_path))
    with pytest.raises(RuntimeError, match="FRETBOOK_OIDC_ISSUER"):
        build_auth(replace(Settings.for_tests(tmp_path), auth_mode="oidc"), users)
    with pytest.raises(RuntimeError, match="32 characters"):
        build_auth(replace(_settings(tmp_path), session_secret="short"), users)

    monkeypatch.delenv("FRETBOOK_AUTH_MODE", raising=False)
    monkeypatch.delenv("FRETBOOK_OIDC_ISSUER", raising=False)
    assert Settings.from_env().auth_mode == "single"
    monkeypatch.setenv("FRETBOOK_OIDC_ISSUER", ISSUER)
    assert Settings.from_env().auth_mode == "oidc"
    monkeypatch.setenv("FRETBOOK_AUTH_MODE", "single")
    assert Settings.from_env().auth_mode == "single"
