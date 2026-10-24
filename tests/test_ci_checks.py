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


def run_ci_ok(needs: dict) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["NEEDS"] = json.dumps(needs)
    return subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "check_ci_ok.py")],
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )


def _needs(pr: str, dagger: str, fork: str, **extra: str) -> dict:
    needs = {
        "pr-title": {"result": pr},
        "dagger": {"result": dagger},
        "dagger-fork": {"result": fork},
    }
    for name, result in extra.items():
        needs[name] = {"result": result}
    return needs


def test_ci_ok_passes_for_a_same_repo_run():
    result = run_ci_ok(_needs("success", "success", "skipped"))
    assert result.returncode == 0
    assert "dagger: success" in result.stdout
    assert "dagger-fork: skipped" in result.stdout


def test_ci_ok_passes_for_a_fork_run():
    assert run_ci_ok(_needs("success", "skipped", "success")).returncode == 0


@pytest.mark.parametrize(
    "needs",
    [
        {},
        _needs("success", "skipped", "skipped"),
        _needs("success", "success", "success"),
        _needs("success", "failure", "skipped"),
        _needs("success", "cancelled", "skipped"),
        _needs("failure", "success", "skipped"),
        _needs("skipped", "success", "skipped"),
        _needs("success", "success", "failure"),
    ],
)
def test_ci_ok_fails_when_a_required_job_did_not_succeed(needs):
    result = run_ci_ok(needs)
    assert result.returncode == 1
    assert "did not succeed" in result.stderr


def test_ci_ok_fails_when_an_extra_job_is_skipped():
    needs = _needs("success", "success", "skipped", extra="skipped")
    assert run_ci_ok(needs).returncode == 1


def test_ci_ok_refuses_to_pass_without_needs():
    env = os.environ.copy()
    env.pop("NEEDS", None)
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "check_ci_ok.py")],
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )
    assert result.returncode == 1


def test_ci_workflow_keeps_forks_off_the_self_hosted_runner():
    workflow = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    assert "runs-on: [self-hosted, dagger]" in workflow
    guard = "github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository"
    assert guard in workflow
    assert "github.event.pull_request.head.repo.full_name != github.repository" in workflow
    assert "cancel-in-progress: true" in workflow
    assert "group: ci-${{ github.ref }}" in workflow
    assert "permissions:\n  contents: read\n" in workflow
    assert "\n  ci-ok:\n" in workflow
    assert "\n  dagger:\n" in workflow
    assert "\n  dagger-fork:\n" in workflow
    assert "dagger call --progress=plain ci" in workflow
    for name in ("docker.yml", "release.yml", "codeql.yml", "unblock.yml"):
        assert (ROOT / ".github/workflows" / name).is_file()
    assert not (ROOT / ".github/workflows" / "dagger.yml").exists()


def test_release_please_versions_agree():
    """The files release-please bumps all start from the manifest version."""
    version = json.loads((ROOT / ".release-please-manifest.json").read_text())["."]
    config = json.loads((ROOT / "release-please-config.json").read_text())
    for entry in config["packages"]["."]["extra-files"]:
        path = entry if isinstance(entry, str) else entry["path"]
        assert f'"{version}"' in (ROOT / path).read_text(encoding="utf-8"), path
