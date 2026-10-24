"""Personal API tokens: creating and revoking them, bearer auth in both modes, and ``fretbook-cli``."""

from __future__ import annotations

import json
import socket
import threading
import time
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path

import httpx
import pytest
import uvicorn
from fastapi.testclient import TestClient
from tests.test_api import SHEET, XML
from tests.test_oidc import MockProvider, _settings, sign_in

from fretbook import cli
from fretbook.app import create_app
from fretbook.config import Settings
from fretbook.db.connection import session
from fretbook.storage.users import MAX_TOKENS_PER_USER, hash_api_token


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    with TestClient(create_app(Settings.for_tests(tmp_path))) as test_client:
        yield test_client


def _mint(client: TestClient, name: str = "script", **body: object) -> dict:
    response = client.post("/api/tokens", json={"name": name, **body})
    assert response.status_code == 201, response.text
    return response.json()


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_token_is_shown_once_and_only_its_hash_is_stored(client: TestClient, tmp_path: Path) -> None:
    created = _mint(client, "nightly", expires_in_days=30)
    assert created["token"].startswith("fb_") and created["name"] == "nightly"
    assert created["prefix"] == created["token"][:8]
    assert created["expires_at"] and created["last_used_at"] is None

    listed = client.get("/api/tokens").json()
    assert [row["id"] for row in listed] == [created["id"]]
    assert "token" not in listed[0] and created["token"] not in json.dumps(listed)

    with session(Settings.for_tests(tmp_path).database_path) as conn:
        stored = [tuple(row) for row in conn.execute("SELECT token_hash FROM api_tokens")]
    assert stored == [(hash_api_token(created["token"]),)]
    assert created["token"] not in str(stored)


def test_bearer_acts_as_the_owner_and_records_use(client: TestClient) -> None:
    song = client.post("/api/songs", json={"title": "Mine", "preset": "bass-4"}).json()
    token = _mint(client)
    with TestClient(client.app) as script:
        me = script.get("/api/me", headers=_bearer(token["token"]))
        assert me.status_code == 200 and me.json()["user_id"] == "local"
        titles = [item["title"] for item in script.get("/api/songs", headers=_bearer(token["token"])).json()["items"]]
        assert titles == ["Mine"]
        assert script.get(f"/api/songs/{song['id']}/export.json", headers=_bearer(token["token"])).status_code == 200
    assert client.get("/api/tokens").json()[0]["last_used_at"]


def test_bad_revoked_and_expired_tokens_are_refused(client: TestClient) -> None:
    # A bearer credential that is not a Fretbook token (an auth proxy's own) is ignored, not refused.
    assert client.get("/api/songs", headers=_bearer("someone-elses")).status_code == 200
    bad = client.get("/api/songs", headers=_bearer("fb_nope"))
    assert bad.status_code == 401 and bad.json()["detail"]["key"] == "auth.invalidToken"

    token = _mint(client)
    assert client.get("/api/songs", headers=_bearer(token["token"])).status_code == 200
    assert client.delete(f"/api/tokens/{token['id']}").status_code == 204
    assert client.get("/api/songs", headers=_bearer(token["token"])).status_code == 401
    assert client.delete(f"/api/tokens/{token['id']}").status_code == 404

    expiring = _mint(client, expires_in_days=1)
    with session(client.app.state.ctx.settings.database_path) as conn:
        conn.execute("UPDATE api_tokens SET expires_at = '2000-01-01T00:00:00+00:00' WHERE id = ?", (expiring["id"],))
    assert client.get("/api/songs", headers=_bearer(expiring["token"])).status_code == 401


def test_tokens_cannot_manage_tokens(client: TestClient) -> None:
    token = _mint(client)
    with TestClient(client.app) as script:
        for response in (
            script.get("/api/tokens", headers=_bearer(token["token"])),
            script.post("/api/tokens", json={"name": "x"}, headers=_bearer(token["token"])),
            script.delete(f"/api/tokens/{token['id']}", headers=_bearer(token["token"])),
        ):
            assert response.status_code == 403
            assert response.json()["detail"]["key"] == "token.sessionRequired"


def test_token_validation_and_cap(client: TestClient) -> None:
    assert client.post("/api/tokens", json={"name": ""}).status_code == 422
    assert client.post("/api/tokens", json={"name": "   "}).json()["detail"]["key"] == "token.nameRequired"
    assert client.post("/api/tokens", json={"name": "x", "expires_in_days": 0}).status_code == 422
    for index in range(MAX_TOKENS_PER_USER):
        _mint(client, f"t{index}")
    full = client.post("/api/tokens", json={"name": "one more"})
    assert full.status_code == 409 and full.json()["detail"]["key"] == "token.tooMany"


def test_bearer_writes_skip_the_origin_check(client: TestClient) -> None:
    token = _mint(client)
    body = {"title": "Scripted", "preset": "bass-4"}
    assert client.post("/api/songs", json=body, headers={"Origin": "https://evil.test"}).status_code == 403
    sent = client.post("/api/songs", json=body, headers={"Origin": "https://evil.test", **_bearer(token["token"])})
    assert sent.status_code == 201


# --- OIDC mode ---------------------------------------------------------------


def test_oidc_tokens_belong_to_their_owner_and_keep_roles(tmp_path: Path) -> None:
    provider = MockProvider()
    app = create_app(_settings(tmp_path), oidc_transport=provider.transport())
    with TestClient(app) as uma, TestClient(app) as ada, TestClient(app) as script:
        sign_in(uma, provider, "uma", ["fretbook_users"])
        sign_in(ada, provider, "ada", ["fretbook_users", "fretbook_admins"])
        uma_song = uma.post("/api/songs", json={"title": "Uma's", "preset": "bass-4"}).json()
        uma_token, ada_token = _mint(uma)["token"], _mint(ada)["token"]

        assert script.get("/api/songs").status_code == 401  # no cookie, no token
        mine = script.get("/api/songs", headers=_bearer(uma_token)).json()["items"]
        assert [song["id"] for song in mine] == [uma_song["id"]]
        assert script.get("/api/songs", headers=_bearer(ada_token)).json()["items"] == []
        assert script.get(f"/api/songs/{uma_song['id']}", headers=_bearer(ada_token)).status_code == 404

        # A token is its owner's role: refused on admin routes unless the owner is an admin.
        refused = script.get("/api/admin/users", headers=_bearer(uma_token))
        assert refused.status_code == 403 and refused.json()["detail"]["key"] == "auth.adminOnly"
        assert script.get("/api/admin/users", headers=_bearer(ada_token)).status_code == 200
        assert script.get("/api/me", headers=_bearer(uma_token)).json()["authenticated"] is True

        # A bad token does not fall back to a cookie.
        assert uma.get("/api/songs", headers=_bearer("fb_nope")).status_code == 401

        # Users cannot see or revoke each other's tokens.
        theirs = uma.get("/api/tokens").json()[0]["id"]
        assert ada.delete(f"/api/tokens/{theirs}").status_code == 404
        assert [row["id"] for row in ada.get("/api/tokens").json()] != [theirs]

        # Cookie writes are still origin-checked; the token is what lets a script skip it.
        assert uma.post("/api/songs", json={"title": "x"}, headers={"Origin": "https://evil.test"}).status_code == 403


def test_admin_lists_and_revokes_another_users_tokens(tmp_path: Path) -> None:
    provider = MockProvider()
    app = create_app(_settings(tmp_path), oidc_transport=provider.transport())
    with TestClient(app) as uma, TestClient(app) as ada, TestClient(app) as script:
        sign_in(uma, provider, "uma", ["fretbook_users"])
        sign_in(ada, provider, "ada", ["fretbook_users", "fretbook_admins"])
        first, second = _mint(uma, "one"), _mint(uma, "two")
        uma_id = next(row["id"] for row in ada.get("/api/admin/users").json() if row["display_name"] == "Uma")
        base = f"/api/admin/users/{uma_id}/tokens"

        counts = {row["display_name"]: row["token_count"] for row in ada.get("/api/admin/users").json()}
        assert counts["Uma"] == 2 and counts["Ada"] == 0

        listed = ada.get(base).json()
        assert {row["id"] for row in listed} == {first["id"], second["id"]}
        assert all("token" not in row for row in listed)

        # Only admins, and only for users that exist.
        assert uma.get(base).json()["detail"]["key"] == "auth.adminOnly"
        assert uma.delete(base).status_code == 403
        assert ada.get("/api/admin/users/nobody/tokens").status_code == 404
        assert ada.delete("/api/admin/users/nobody/tokens").status_code == 404
        assert ada.delete(f"{base}/missing").status_code == 404

        # One token, then the rest. A revoked token stops working at once.
        assert script.get("/api/songs", headers=_bearer(first["token"])).status_code == 200
        assert ada.delete(f"{base}/{first['id']}").status_code == 204
        assert script.get("/api/songs", headers=_bearer(first["token"])).status_code == 401
        assert script.get("/api/songs", headers=_bearer(second["token"])).status_code == 200
        assert ada.delete(base).json() == {"revoked": 1}
        assert script.get("/api/songs", headers=_bearer(second["token"])).status_code == 401
        assert ada.get(base).json() == []

        # An admin's own token works on admin routes, as it does elsewhere.
        admin_token = _mint(ada)["token"]
        assert script.delete(base, headers=_bearer(admin_token)).status_code == 200


# --- fretbook-cli ------------------------------------------------------------


@pytest.fixture
def live(tmp_path: Path) -> Iterator[tuple[str, str]]:
    """A running server on a free port, and a token for it."""
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    settings = replace(Settings.for_tests(tmp_path), port=port)
    server = uvicorn.Server(uvicorn.Config(create_app(settings), host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not server.started and time.monotonic() < deadline:
        time.sleep(0.05)
    assert server.started
    url = f"http://127.0.0.1:{port}"
    try:
        token = httpx.post(f"{url}/api/tokens", json={"name": "cli"}).json()["token"]
        yield url, token
    finally:
        server.should_exit = True
        thread.join(timeout=10)


def _run(url: str, token: str, *args: str) -> int:
    return cli.main(["--url", url, "--token", token, *args])


def test_cli_imports_a_folder_lists_and_exports(
    live: tuple[str, str], tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    url, token = live
    inbox = tmp_path / "inbox"
    (inbox / "nested").mkdir(parents=True)
    (inbox / "Walking.musicxml").write_text(XML, encoding="utf-8")
    (inbox / "Hello.cho").write_text("{title: Hello}\n" + SHEET, encoding="utf-8")
    (inbox / "notes.md").write_text("ignored", encoding="utf-8")
    (inbox / "nested" / "Deep.cho").write_text("{title: Deep}\n" + SHEET, encoding="utf-8")

    assert _run(url, token, "import", str(inbox)) == 0
    out = capsys.readouterr().out
    assert out.count("imported ") == 2 and "notes.md" not in out and "Deep.cho" not in out

    assert _run(url, token, "import", "--recursive", str(inbox / "nested")) == 0
    capsys.readouterr()
    assert _run(url, token, "list", "--json") == 0
    songs = json.loads(capsys.readouterr().out)
    assert sorted(song["title"].lower() for song in songs) == ["deep", "hello", "walking"]

    assert _run(url, token, "list", "Hello") == 0
    listed = capsys.readouterr().out
    assert "Hello" in listed and "Walking" not in listed

    song_id = next(song["id"] for song in songs if song["title"] == "Hello")
    target = tmp_path / "hello.json"
    assert _run(url, token, "export", song_id, "-o", str(target)) == 0
    assert json.loads(target.read_text())["format"] == "fretbook-song"
    assert _run(url, token, "export", song_id, "-f", "chordpro") == 0
    assert "Hello" in capsys.readouterr().out


def test_cli_imports_midi_from_a_folder_and_exports_it(
    live: tuple[str, str], tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    url, token = live
    inbox = tmp_path / "inbox"
    inbox.mkdir()
    riff = Path(__file__).parent / "fixtures" / "corpus" / "midi" / "riff.mid"
    (inbox / "Riff.mid").write_bytes(riff.read_bytes())

    assert _run(url, token, "import", str(inbox)) == 0
    assert capsys.readouterr().out.count("imported ") == 1
    assert _run(url, token, "list", "--json") == 0
    song_id = json.loads(capsys.readouterr().out)[0]["id"]
    target = tmp_path / "riff.mid"
    assert _run(url, token, "export", song_id, "-f", "midi", "-o", str(target)) == 0
    assert target.read_bytes().startswith(b"MThd")


def test_cli_reports_failures_with_a_nonzero_exit(
    live: tuple[str, str], tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    url, token = live
    junk = tmp_path / "junk.bin"
    junk.write_bytes(b"\x00\x01\x02 not a song")
    assert _run(url, token, "import", str(junk)) == 1
    assert "FAILED" in capsys.readouterr().err

    assert _run(url, token, "import", str(tmp_path / "missing")) == 1
    assert "no such file" in capsys.readouterr().err
    assert _run(url, "fb_wrong", "list") == 1
    assert "invalid" in capsys.readouterr().err
    assert _run(url, "", "list") == 1
    assert "FRETBOOK_TOKEN" in capsys.readouterr().err


def test_cli_reads_the_environment(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    monkeypatch.setenv("FRETBOOK_URL", "http://127.0.0.1:9")
    monkeypatch.setenv("FRETBOOK_TOKEN", "fb_x")
    args = cli.build_parser().parse_args(["list"])
    assert (args.url, args.token) == ("http://127.0.0.1:9", "fb_x")
    assert cli.main(["list"]) == 1
    assert "cannot reach" in capsys.readouterr().err
