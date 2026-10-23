from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fretbook.app import create_app
from fretbook.buildinfo import git_sha
from fretbook.config import Settings


def test_git_sha_unset_or_blank_is_none(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("FRETBOOK_GIT_SHA", raising=False)
    assert git_sha() is None
    monkeypatch.setenv("FRETBOOK_GIT_SHA", "  ")
    assert git_sha() is None


def test_meta_reports_commit_of_a_non_release_build(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FRETBOOK_GIT_SHA", "0123456789abcdef0123456789abcdef01234567")
    with TestClient(create_app(Settings.for_tests(tmp_path))) as client:
        meta = client.get("/api/meta").json()
    assert meta["commit"] == "0123456789abcdef0123456789abcdef01234567"
