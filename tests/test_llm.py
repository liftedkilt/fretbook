"""LLM settings: key choice, quotas, rate limit, cache, and that keys are encrypted and never returned."""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from tests.test_oidc import MockProvider, _settings, sign_in

from fretbook.app import create_app
from fretbook.config import Settings
from fretbook.db.connection import session
from fretbook.llm.crypto import SecretBox
from fretbook.llm.service import LlmRefused, select_key

ADMIN_KEY = "sk-admin-SECRET-1234567890"
OWN_KEY = "sk-own-SECRET-0987654321"


class FakeModel:
    """Stands in for the provider; records each request."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.status = 200

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.status != 200:
            return httpx.Response(self.status, json={"error": "nope"})
        if request.url.path.endswith("/messages"):
            return httpx.Response(
                200,
                json={
                    "content": [{"type": "text", "text": "tab"}],
                    "usage": {"input_tokens": 1000, "output_tokens": 500},
                },
            )
        if request.url.path.endswith("/chat/completions"):
            return httpx.Response(
                200,
                json={
                    "choices": [{"message": {"content": "tab"}}],
                    "usage": {"prompt_tokens": 10, "completion_tokens": 5},
                },
            )
        return httpx.Response(200, json={"message": {"content": "tab"}, "prompt_eval_count": 7, "eval_count": 3})


@pytest.fixture
def model() -> FakeModel:
    return FakeModel()


@pytest.fixture
def client(tmp_path: Path, model: FakeModel) -> Iterator[TestClient]:
    with TestClient(create_app(Settings.for_tests(tmp_path), llm_transport=model.transport())) as test_client:
        yield test_client


def _configure(client: TestClient, **changes: object) -> dict:
    body = {"provider": "anthropic", "model": "claude-sonnet-5-5", "admin_key": ADMIN_KEY, **changes}
    response = client.put("/api/admin/llm", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def _generate(client: TestClient, prompt: str = "song 1", user: str = "local") -> object:
    return client.app.state.ctx.llm.generate(user, system="be a guitarist", prompt=prompt)


def _set_mode(client: TestClient, mode: str, user: str = "local", **limits: object) -> None:
    body = {"mode": mode, "daily_limit": None, "monthly_limit": None, "monthly_spend_cap_usd": None, **limits}
    assert client.put(f"/api/admin/llm/users/{user}", json=body).status_code == 200


# --- key choice ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("provider", "mode", "admin", "own", "expected"),
    [
        ("anthropic", "shared", ADMIN_KEY, None, "shared"),
        ("anthropic", "shared", ADMIN_KEY, OWN_KEY, "own"),
        ("anthropic", "own_key", ADMIN_KEY, OWN_KEY, "own"),
        ("openai", "own_key", ADMIN_KEY, None, "llm.keyRequired"),
        ("anthropic", "shared", None, None, "llm.noAdminKey"),
        ("anthropic", "disabled", ADMIN_KEY, OWN_KEY, "llm.noAccess"),
        ("none", "shared", ADMIN_KEY, OWN_KEY, "llm.off"),
        ("ollama", "own_key", None, None, "local"),
        ("ollama", "disabled", None, None, "llm.noAccess"),
    ],
)
def test_select_key(provider: str, mode: str, admin: str | None, own: str | None, expected: str) -> None:
    if expected.startswith("llm."):
        with pytest.raises(LlmRefused) as refused:
            select_key(provider, mode, admin, own)
        assert refused.value.code == expected
        return
    choice = select_key(provider, mode, admin, own)
    assert choice.source == expected
    assert choice.key == {"shared": admin, "own": own, "local": None}[expected]


def test_new_users_default_to_own_key(client: TestClient) -> None:
    _configure(client)
    status = client.get("/api/llm").json()
    assert status["mode"] == "own_key" and status["available"] is False
    assert status["unavailable_reason"] == "llm.keyRequired"


def test_own_key_is_used_first_and_does_not_count(client: TestClient, model: FakeModel) -> None:
    _configure(client)
    _set_mode(client, "shared", daily_limit=1)
    client.put("/api/llm/key", json={"key": OWN_KEY})
    for index in range(3):
        _generate(client, f"song {index}")
    assert {request.headers["x-api-key"] for request in model.requests} == {OWN_KEY}
    assert client.get("/api/llm").json()["generations_today"] == 0
    client.delete("/api/llm/key")
    _generate(client, "with admin key")
    assert model.requests[-1].headers["x-api-key"] == ADMIN_KEY


def test_hosted_providers_send_their_own_auth(client: TestClient, model: FakeModel) -> None:
    _configure(client, provider="openai", model="gpt-x", base_url="https://llm.example.test/v1")
    _set_mode(client, "shared")
    _generate(client)
    request = model.requests[-1]
    assert str(request.url) == "https://llm.example.test/v1/chat/completions"
    assert request.headers["authorization"] == f"Bearer {ADMIN_KEY}"


def test_local_provider_needs_no_key(client: TestClient, model: FakeModel) -> None:
    _configure(client, provider="ollama", model="llama3", base_url="http://pop-os:11434", admin_key=None)
    result = _generate(client)
    assert str(model.requests[-1].url) == "http://pop-os:11434/api/chat"
    assert result.source == "local" and result.cost_usd == 0 and result.output_tokens == 3


def test_provider_none_turns_llm_off(client: TestClient) -> None:
    _configure(client, provider="none", model="")
    with pytest.raises(LlmRefused) as refused:
        _generate(client)
    assert refused.value.code == "llm.off"


# --- quotas -------------------------------------------------------------------


def test_daily_limit_refuses_with_a_clear_message(client: TestClient) -> None:
    _configure(client)
    _set_mode(client, "shared", daily_limit=2)
    _generate(client, "a")
    _generate(client, "b")
    with pytest.raises(LlmRefused) as refused:
        _generate(client, "c")
    assert refused.value.code == "llm.quotaDaily" and refused.value.status == 429
    assert "daily limit of 2" in refused.value.message


def test_monthly_and_spend_limits(client: TestClient) -> None:
    _configure(client)
    _set_mode(client, "shared", monthly_limit=1)
    _generate(client, "a")
    with pytest.raises(LlmRefused) as refused:
        _generate(client, "b")
    assert refused.value.code == "llm.quotaMonthly"
    # One claude-sonnet request above costs 1000 in x $3/M + 500 out x $15/M = $0.0105.
    _set_mode(client, "shared", monthly_spend_cap_usd=0.01)
    with pytest.raises(LlmRefused) as refused:
        _generate(client, "c")
    assert refused.value.code == "llm.quotaSpend"


def test_instance_cap_is_a_backstop_for_the_admin_key_only(client: TestClient) -> None:
    _configure(client, instance_monthly_cap_usd=0.01)
    _set_mode(client, "shared")
    _generate(client, "a")
    with pytest.raises(LlmRefused) as refused:
        _generate(client, "b")
    assert refused.value.code == "llm.instanceCap"
    client.put("/api/llm/key", json={"key": OWN_KEY})
    assert _generate(client, "c").source == "own"


def test_failed_requests_are_not_counted(client: TestClient, model: FakeModel) -> None:
    _configure(client)
    _set_mode(client, "shared", daily_limit=1)
    model.status = 500
    with pytest.raises(LlmRefused) as refused:
        _generate(client)
    assert refused.value.code == "llm.providerError"
    model.status = 401
    with pytest.raises(LlmRefused) as refused:
        _generate(client)
    assert "rejected the API key" in refused.value.message and ADMIN_KEY not in refused.value.message
    model.status = 200
    _generate(client)
    assert len(client.get("/api/admin/llm/usage").json()) == 1


def test_admin_gets_a_notice_at_80_percent_once(client: TestClient) -> None:
    _configure(client)
    _set_mode(client, "shared", daily_limit=5)
    for index in range(3):
        _generate(client, str(index))
    assert client.get("/api/admin/llm/notices").json() == []
    _generate(client, "3")
    _generate(client, "4")
    notices = client.get("/api/admin/llm/notices").json()
    assert [(n["limit_kind"], n["user_id"]) for n in notices] == [("daily", "local")]
    assert client.delete("/api/admin/llm/notices").json() == {"cleared": 1}


def test_rate_limit_applies_even_with_an_own_key(client: TestClient) -> None:
    _configure(client, rate_limit_per_minute=2)
    client.put("/api/llm/key", json={"key": OWN_KEY})
    _generate(client, "a")
    _generate(client, "b")
    with pytest.raises(LlmRefused) as refused:
        _generate(client, "c")
    assert refused.value.code == "llm.rateLimited" and refused.value.status == 429


def test_identical_requests_use_the_cache(client: TestClient, model: FakeModel) -> None:
    _configure(client, rate_limit_per_minute=1)
    _set_mode(client, "shared", daily_limit=1)
    first = _generate(client, "same song, advanced")
    again = _generate(client, "same song, advanced")
    assert not first.cached and again.cached and again.text == "tab"
    assert len(model.requests) == 1
    assert len(client.get("/api/admin/llm/usage").json()) == 1


# --- usage log ----------------------------------------------------------------


def test_usage_log_and_totals(client: TestClient) -> None:
    _configure(client)
    _set_mode(client, "shared")
    _generate(client, "a")
    _generate(client, "b")
    log = client.get("/api/admin/llm/usage").json()
    assert len(log) == 2
    assert log[0]["model"] == "claude-sonnet-5-5" and log[0]["key_source"] == "shared"
    assert (log[0]["input_tokens"], log[0]["output_tokens"], log[0]["cost_usd"]) == (1000, 500, 0.0105)
    [row] = [u for u in client.get("/api/admin/llm/users").json() if u["user_id"] == "local"]
    assert row["generations_month"] == 2 and row["cost_total_usd"] == 0.021
    assert client.get("/api/admin/llm").json()["admin_generations_month"] == 2


# --- keys are never returned and are encrypted --------------------------------


def test_keys_are_never_returned_and_stored_encrypted(client: TestClient, tmp_path: Path) -> None:
    saved = _configure(client)
    assert saved["has_admin_key"] is True
    client.put("/api/llm/key", json={"key": OWN_KEY})
    _set_mode(client, "shared")
    _generate(client)
    responses = [
        client.get("/api/admin/llm"),
        client.put("/api/admin/llm", json={"provider": "anthropic", "model": "m"}),
        client.get("/api/admin/llm/users"),
        client.get("/api/admin/llm/usage"),
        client.get("/api/llm"),
        client.put("/api/llm/key", json={"key": OWN_KEY}),
        client.get("/api/openapi.json"),
    ]
    for response in responses:
        assert ADMIN_KEY not in response.text and OWN_KEY not in response.text
        assert "admin_key_enc" not in response.text and "own_key_enc" not in response.text
    assert client.get("/api/admin/llm").json()["has_admin_key"] is True  # blank key keeps the saved one

    with session(Settings.for_tests(tmp_path).database_path) as conn:
        stored = [str(tuple(row)) for row in conn.execute("SELECT admin_key_enc FROM llm_settings")]
        stored += [str(tuple(row)) for row in conn.execute("SELECT own_key_enc FROM llm_user")]
    assert len(stored) == 2 and all(value for value in stored)
    assert ADMIN_KEY not in "".join(stored) and OWN_KEY not in "".join(stored)
    assert (tmp_path / "secret.key").stat().st_mode & 0o077 == 0


def test_clearing_the_admin_key(client: TestClient) -> None:
    _configure(client)
    assert _configure(client, admin_key=None, clear_admin_key=True)["has_admin_key"] is False


def test_secret_box_round_trip_and_wrong_secret(tmp_path: Path) -> None:
    box = SecretBox.for_data_dir(tmp_path)
    token = box.encrypt("hello")
    assert token != "hello" and box.decrypt(token) == "hello"
    assert SecretBox.for_data_dir(tmp_path).decrypt(token) == "hello"  # the key file is reused
    assert SecretBox("other").decrypt(token) is None
    assert SecretBox.for_data_dir(tmp_path, "configured").decrypt(token) is None


def test_settings_validation(client: TestClient) -> None:
    assert client.put("/api/admin/llm", json={"provider": "openai", "model": " "}).status_code == 400
    assert client.put("/api/admin/llm", json={"provider": "bogus", "model": "x"}).status_code == 422
    assert client.put("/api/llm/key", json={"key": "short"}).status_code == 422
    assert client.put("/api/admin/llm/users/nobody", json={"mode": "shared"}).status_code == 404


def test_api_tokens_cannot_set_a_key(client: TestClient) -> None:
    secret = client.post("/api/tokens", json={"name": "script"}).json()["token"]
    response = client.put("/api/llm/key", json={"key": OWN_KEY}, headers={"Authorization": f"Bearer {secret}"})
    assert response.status_code == 403


# --- OIDC: admin-only settings, per-user keys -----------------------------------


def test_only_admins_manage_settings_and_users_keep_separate_keys(tmp_path: Path, model: FakeModel) -> None:
    provider = MockProvider()
    app = create_app(_settings(tmp_path), oidc_transport=provider.transport(), llm_transport=model.transport())
    with TestClient(app) as admin, TestClient(app) as alice:
        sign_in(admin, provider, "root", ["fretbook_admins"])
        sign_in(alice, provider, "alice", ["fretbook_users"])
        for path in ("/api/admin/llm", "/api/admin/llm/users", "/api/admin/llm/usage", "/api/admin/llm/notices"):
            assert alice.get(path).status_code == 403, path
        assert alice.put("/api/admin/llm", json={"provider": "none"}).status_code == 403
        assert (
            admin.put(
                "/api/admin/llm", json={"provider": "anthropic", "model": "m", "admin_key": ADMIN_KEY}
            ).status_code
            == 200
        )

        assert alice.get("/api/llm").json()["mode"] == "own_key"
        assert alice.put("/api/llm/key", json={"key": OWN_KEY}).json()["has_own_key"] is True
        assert admin.get("/api/llm").json()["has_own_key"] is False
        users = {u["display_name"]: u for u in admin.get("/api/admin/llm/users").json()}
        assert set(users) == {"Local", "Alice", "Root"}
        alice_id = next(u["user_id"] for u in users.values() if u["has_own_key"])
        assert (
            admin.put(f"/api/admin/llm/users/{alice_id}", json={"mode": "disabled", "daily_limit": 1}).status_code
            == 200
        )
        with pytest.raises(LlmRefused) as refused:
            app.state.ctx.llm.generate(alice_id, system="s", prompt="p")
        assert refused.value.code == "llm.noAccess"
        assert json.dumps(admin.get("/api/admin/llm/users").json()).count(OWN_KEY) == 0
