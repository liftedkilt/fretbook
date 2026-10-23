"""Write the committed OpenAPI contract to ``openapi.json``.

From the repository root, with the project dependencies installed:

    python -m fretbook.openapi
    python -m fretbook.openapi --check

``--check`` prints ``API changed: run python -m fretbook.openapi and commit openapi.json``
and exits 1 when the file would change. The document is deterministic: object
keys are sorted, formatting is fixed, and nothing records when it was generated.
"""

from __future__ import annotations

import difflib
import json
import sys
from pathlib import Path
from typing import Any

from fretbook.app import create_app
from fretbook.config import Settings

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "openapi.json"

# The contract does not follow the release version: release-please would have to
# rewrite openapi.json on every release, and its JSON updater re-serializes the
# whole file, so the release PR would fail the --check below.
CONTRACT_VERSION = "0.0.0"


def contract_settings() -> Settings:
    """Settings that cannot leak machine-specific values into the schema."""
    return Settings(
        host="127.0.0.1",
        port=8137,
        data_dir=Path("data"),
        database_path=Path("data/fretbook.sqlite"),
        legacy_songs_dir=None,
        auth_mode="single",
        root_path="",
        download_audio=False,
        forwarded_allow_ips="127.0.0.1",
        max_upload_bytes=80 * 1024 * 1024,
        audio_timeout_seconds=600,
        static_dir=None,
        oidc_issuer="",
        oidc_client_id="",
        oidc_client_secret="",
        oidc_redirect_uri="",
        session_secret="",
    )


def _drop_empty_json_schemas(schema: dict[str, Any]) -> None:
    """FastAPI adds ``application/json: {schema: {}}`` beside a file response.

    The download routes declare their own media type. Drop the empty JSON body
    so a client does not think the file is a JSON object.
    """
    for methods in schema.get("paths", {}).values():
        for operation in methods.values():
            if not isinstance(operation, dict):
                continue
            for response in operation.get("responses", {}).values():
                content = response.get("content")
                if not isinstance(content, dict) or "application/json" not in content:
                    continue
                if content["application/json"].get("schema") == {} and len(content) > 1:
                    del content["application/json"]


def build_schema() -> dict[str, Any]:
    app = create_app(contract_settings())
    schema = app.openapi()
    schema["info"]["version"] = CONTRACT_VERSION
    # Drop an empty servers list if a future FastAPI adds one from the environment.
    if schema.get("servers") == []:
        schema.pop("servers", None)
    _drop_empty_json_schemas(schema)
    return schema


def render(schema: dict[str, Any] | None = None) -> str:
    payload = build_schema() if schema is None else schema
    return json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    check = "--check" in args
    text = render()
    if check:
        current = OUTPUT.read_text(encoding="utf-8") if OUTPUT.is_file() else ""
        if current != text:
            print(
                "API changed: run python -m fretbook.openapi and commit openapi.json",
                file=sys.stderr,
            )
            diff = difflib.unified_diff(
                current.splitlines(keepends=True),
                text.splitlines(keepends=True),
                fromfile="openapi.json",
                tofile="openapi.json (regenerated)",
            )
            shown = 0
            for line in diff:
                if shown >= 200:
                    print("... diff truncated ...", file=sys.stderr)
                    break
                sys.stderr.write(line)
                shown += 1
            return 1
        return 0
    OUTPUT.write_text(text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
