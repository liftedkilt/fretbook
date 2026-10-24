"""The CI guard scripts in scripts/ fail with clear messages on bad input."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


def run(script: str, directory: Path | None = None) -> subprocess.CompletedProcess[str]:
    args = [sys.executable, str(ROOT / "scripts" / script)]
    if directory is not None:
        args.append(str(directory))
    return subprocess.run(args, capture_output=True, text=True, check=False)


def make_migrations(tmp_path: Path, *names: str) -> Path:
    for name in names:
        (tmp_path / name).write_text("SELECT 1;\n", encoding="utf-8")
    return tmp_path


def test_repo_migrations_pass():
    assert run("check_migrations.py").returncode == 0


def test_migrations_sequential_pass(tmp_path):
    assert run("check_migrations.py", make_migrations(tmp_path, "001_a.sql", "002_b.sql")).returncode == 0


def test_duplicate_migration_number_fails(tmp_path):
    result = run("check_migrations.py", make_migrations(tmp_path, "001_a.sql", "002_b.sql", "003_x.sql", "003_y.sql"))
    assert result.returncode == 1
    assert "duplicate migration number 003: 003_x.sql, 003_y.sql" in result.stderr


def test_skipped_migration_number_fails(tmp_path):
    result = run("check_migrations.py", make_migrations(tmp_path, "001_a.sql", "003_c.sql"))
    assert result.returncode == 1
    assert "missing migration number 002" in result.stderr


def test_reserved_migration_number_may_be_missing(tmp_path):
    names = [f"{n:03d}_m.sql" for n in range(1, 9)] + ["010_next.sql"]
    assert run("check_migrations.py", make_migrations(tmp_path, *names)).returncode == 0
    # Only the reserved number is exempt: another gap still fails.
    (tmp_path / "gap").mkdir()
    result = run("check_migrations.py", make_migrations(tmp_path / "gap", *names[:-1], "011_next.sql"))
    assert result.returncode == 1
    assert "missing migration number 010" in result.stderr


def test_malformed_migration_name_fails(tmp_path):
    result = run("check_migrations.py", make_migrations(tmp_path, "001_a.sql", "2_b.sql"))
    assert result.returncode == 1
    assert "2_b.sql" in result.stderr


def write_locale(directory: Path, name: str, text: str) -> None:
    (directory / name).write_text(text, encoding="utf-8")


def test_repo_locales_pass():
    assert run("check_locales.py").returncode == 0


def test_locales_valid_pass(tmp_path):
    body = json.dumps({"a": {"x": "1"}, "b": "2"}, indent=2) + "\n"
    write_locale(tmp_path, "en.json", body)
    write_locale(tmp_path, "pt-BR.json", body)
    assert run("check_locales.py", tmp_path).returncode == 0


def test_locale_invalid_json_fails(tmp_path):
    write_locale(tmp_path, "en.json", '{\n  "a": 1,\n}\n')
    result = run("check_locales.py", tmp_path)
    assert result.returncode == 1
    assert "en.json: invalid JSON" in result.stderr


def test_locale_duplicate_key_fails(tmp_path):
    write_locale(tmp_path, "en.json", '{\n  "a": "1",\n  "a": "2"\n}\n')
    result = run("check_locales.py", tmp_path)
    assert result.returncode == 1
    assert "duplicate key 'a'" in result.stderr


def test_locale_missing_trailing_newline_fails(tmp_path):
    write_locale(tmp_path, "en.json", '{\n  "a": "1"\n}')
    result = run("check_locales.py", tmp_path)
    assert result.returncode == 1
    assert "exactly one newline" in result.stderr


def test_locale_key_order_mismatch_fails(tmp_path):
    write_locale(tmp_path, "en.json", '{\n  "a": "1",\n  "b": "2"\n}\n')
    write_locale(tmp_path, "pt-BR.json", '{\n  "b": "2",\n  "a": "1"\n}\n')
    result = run("check_locales.py", tmp_path)
    assert result.returncode == 1
    assert "same order" in result.stderr


def run_pr_title(title: str | None) -> subprocess.CompletedProcess[str]:
    env = {k: v for k, v in os.environ.items() if k != "PR_TITLE"}
    if title is not None:
        env["PR_TITLE"] = title
    args = [sys.executable, str(ROOT / "scripts" / "check_pr_title.py")]
    return subprocess.run(args, capture_output=True, text=True, check=False, env=env)


@pytest.mark.parametrize(
    "title",
    [
        "feat: add tab export",
        "fix(player): stop drift",
        "feat!: drop v1 API",
        "chore(main): release 0.2.0",
        "ci: gate on ci-ok",
    ],
)
def test_conventional_pr_title_passes(title):
    assert run_pr_title(title).returncode == 0


@pytest.mark.parametrize(
    "title", ["Add tab export", "feat add export", "feature: x", "feat:", "feat: x\nbody", "Feat: x"]
)
def test_non_conventional_pr_title_fails(title):
    result = run_pr_title(title)
    assert result.returncode == 1
    assert "Conventional Commit" in result.stderr


def test_pr_title_skipped_outside_pull_requests():
    assert run_pr_title(None).returncode == 0
    assert run_pr_title("").returncode == 0


def test_release_please_versions_agree():
    """The files release-please bumps all start from the manifest version."""
    version = json.loads((ROOT / ".release-please-manifest.json").read_text())["."]
    config = json.loads((ROOT / "release-please-config.json").read_text())
    for entry in config["packages"]["."]["extra-files"]:
        path = entry if isinstance(entry, str) else entry["path"]
        assert f'"{version}"' in (ROOT / path).read_text(encoding="utf-8"), path
