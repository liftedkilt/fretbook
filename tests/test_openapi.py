"""The committed OpenAPI document is the frontend contract."""

import json
import re

from fretbook.openapi import build_schema, main, render

_TIMESTAMP = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")


def _ref(node: dict) -> str:
    schema = node["content"]["application/json"]["schema"]
    if "$ref" in schema:
        return schema["$ref"]
    # list responses are arrays of a ref
    return schema["items"]["$ref"]


def test_render_is_deterministic_and_has_no_timestamp() -> None:
    first = render()
    second = render()
    assert first == second
    assert first.endswith("\n")
    assert _TIMESTAMP.search(first) is None
    assert "generated_at" not in first
    # Sorted keys: the top-level document starts with the openapi version field.
    assert first.startswith('{\n  "components":')


def test_schema_documents_responses_errors_and_auth() -> None:
    schema = build_schema()
    paths = schema["paths"]
    assert "/" not in paths
    assert "/{full_path}" not in paths
    for path in (
        "/api/health",
        "/api/meta",
        "/api/me",
        "/api/me/settings",
        "/api/songs",
        "/api/songs/{song_id}",
        "/api/jobs/{job_id}",
        "/api/imports/preview",
    ):
        assert path in paths

    models = schema["components"]["schemas"]
    detail = models["ErrorDetail"]["properties"]
    assert list(detail) == ["key", "message", "params"] or set(detail) == {"key", "message", "params"}
    assert "ErrorBody" in models
    assert "SongDetail" in models
    assert "Me" in models
    assert "ScoreDocument" in models

    song = paths["/api/songs/{song_id}"]["get"]
    assert _ref(song["responses"]["200"]).endswith("/SongDetail")
    error = song["responses"]["404"]["content"]["application/json"]["schema"]["$ref"]
    assert error.endswith("/ErrorBody")
    preview = paths["/api/imports/preview"]["post"]
    assert _ref(preview["responses"]["200"]).endswith("/ImportPreview")
    assert paths["/api/me"]["get"]["tags"] == ["auth"]
    assert _ref(paths["/api/me"]["get"]["responses"]["200"]).endswith("/Me")
    assert paths["/api/me"]["get"]["responses"]["501"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "/PlainErrorBody"
    )
    listed = paths["/api/songs"]["get"]["responses"]["200"]
    assert _ref(listed).endswith("/SongSummary")
    health = paths["/api/health"]["get"]["responses"]["200"]
    assert _ref(health).endswith("/Health")


def test_committed_openapi_matches_generator() -> None:
    assert main(["--check"]) == 0, "API changed: run python -m fretbook.openapi and commit openapi.json"


def test_error_example_uses_the_keyed_shape() -> None:
    schema = build_schema()
    body = schema["components"]["schemas"]["ErrorBody"]
    example = body["examples"][0]
    assert set(example["detail"]) == {"key", "message", "params"}
    assert "/auth/login" not in schema["paths"]
    assert "/auth/callback" not in schema["paths"]
    assert "/auth/logout" not in schema["paths"]
    assert json.dumps(schema["paths"]["/api/me"])
