"""Dagger pipelines for Fretbook CI.

``dagger call ci`` runs the same checks as ``.github/workflows/ci.yml``
concurrently in one engine session. Pip, uv, npm, and Playwright browsers
each have a cache volume. Test commands are keyed by the run id so a rerun
executes them again; dependency installs stay cached.

Fork pull requests must not reach the privileged self-hosted engine. The
workflow runs these same functions on a GitHub-hosted runner instead.
"""

from __future__ import annotations

import asyncio
import re
from typing import Annotated

import dagger
from dagger import DefaultPath, Doc, Ignore, dag, function, object_type

PYTHON_312 = "python:3.12-slim-bookworm"
PYTHON_313 = "python:3.13-slim-bookworm"
NODE_IMAGE = "node:22-bookworm-slim"
UV_IMAGE = "ghcr.io/astral-sh/uv:0.13.5"
PYTHONS = {"3.12": PYTHON_312, "3.13": PYTHON_313}

SOURCE_IGNORE = [
    ".git",
    ".venv",
    "**/.venv",
    "**/__pycache__",
    "**/*.pyc",
    "**/.pytest_cache",
    "**/.mypy_cache",
    "**/.ruff_cache",
    ".dagger/sdk",
    ".dagger/.venv",
    "web/node_modules",
    "web/dist",
    "web/dist-gp",
    "web/coverage",
    "web/test-results",
    "web/playwright-report",
    "htmlcov",
    ".coverage",
    "data",
    "songs",
    "source",
    "ci-out",
    "ci-summary.md",
]

Source = Annotated[
    dagger.Directory,
    DefaultPath("/"),
    Ignore(SOURCE_IGNORE),
    Doc("Repository root. Defaults to the current directory."),
]

_REPO = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
_SHA = re.compile(r"^[0-9a-fA-F]{40}$")
_RUN = re.compile(r"^[A-Za-z0-9_.-]{1,80}$")

_PYTEST_COV = """
set -euo pipefail
python -m pytest --cov --cov-report=term --cov-report=html
mkdir -p "/ci-artifacts/${FRETBOOK_CI_RUN}/htmlcov"
cp -a htmlcov/. "/ci-artifacts/${FRETBOOK_CI_RUN}/htmlcov/"
echo
echo "### Server coverage"
echo
python -m coverage report --skip-covered --format=markdown
echo
echo "backend 3.12 ok"
"""

_WEB_COVERAGE_JS = (
    'const t=require("./coverage/coverage-summary.json").total;'
    'for (const k of ["lines","statements","functions","branches"]) '
    'console.log(k.padEnd(11)+t[k].pct+"% ("+t[k].covered+"/"+t[k].total+")")'
)

_WEB_COVERAGE = f"""
set -eu
node -e {_WEB_COVERAGE_JS!r} | tee /tmp/web-cov.txt
mkdir -p "/ci-artifacts/${{FRETBOOK_CI_RUN}}/web-coverage"
cp -a coverage/. "/ci-artifacts/${{FRETBOOK_CI_RUN}}/web-coverage/"
"""

_WEB_SUMMARY = """
set -eu
echo "### Web coverage"
echo
cat /tmp/web-cov.txt
echo
echo "frontend ok"
"""

_E2E = """
set +e
npm run e2e
code=$?
if [ "$code" -ne 0 ]; then
  mkdir -p "/ci-artifacts/${FRETBOOK_CI_RUN}/playwright"
  cp -a test-results "/ci-artifacts/${FRETBOOK_CI_RUN}/playwright/" 2>/dev/null || true
  cp -a playwright-report "/ci-artifacts/${FRETBOOK_CI_RUN}/playwright/" 2>/dev/null || true
fi
exit "$code"
"""

_EXPORT_REPORTS = """
set -eu
mkdir -p /out
if [ -d "/ci-artifacts/${FRETBOOK_CI_RUN}" ]; then
  cp -a "/ci-artifacts/${FRETBOOK_CI_RUN}/." /out/
fi
find /out -maxdepth 2 -type d -print
"""

_FETCH_COMMITS = """
set -euo pipefail
git init -q /repo
cd /repo
git remote add origin "https://github.com/${REPOSITORY}.git"
git fetch --filter=blob:none --no-tags origin "$BASE_SHA"
if [ "$HEAD_REPOSITORY" = "$REPOSITORY" ]; then
  git fetch --filter=blob:none --no-tags origin "$HEAD_SHA"
else
  git fetch --filter=blob:none --no-tags "https://github.com/${HEAD_REPOSITORY}.git" "$HEAD_SHA"
fi
git cat-file -e "${BASE_SHA}^{commit}"
git cat-file -e "${HEAD_SHA}^{commit}"
"""


def _has_ui_only(labels: str) -> bool:
    """Same match as scripts/check_ui_only.sh: a comma-separated label list."""
    return ",ui-only," in f",{labels},"


def _check_repo(name: str) -> None:
    if not _REPO.fullmatch(name):
        raise ValueError(f"invalid repository {name!r}")


def _check_sha(sha: str) -> None:
    if not _SHA.fullmatch(sha):
        raise ValueError(f"invalid commit sha {sha!r}")


def _check_run_id(run_id: str) -> None:
    if not _RUN.fullmatch(run_id):
        raise ValueError(f"invalid run id {run_id!r}")


def _tail(text: str, limit: int = 12000) -> str:
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    return "...\n" + text[-limit:]


def _format_exec(name: str, exc: dagger.ExecError) -> str:
    parts = [f"{name} failed (exit {exc.exit_code}): {exc.message}"]
    stdout = _tail(exc.stdout)
    stderr = _tail(exc.stderr)
    if stdout:
        parts.append("--- stdout ---\n" + stdout)
    if stderr:
        parts.append("--- stderr ---\n" + stderr)
    return "\n".join(parts)


@object_type
class FretbookCi:
    """CI checks for Fretbook. Start with `dagger call ci`."""

    def _python(self, version: str) -> dagger.Container:
        image = PYTHONS.get(version)
        if image is None:
            raise ValueError(f"unsupported Python version {version!r}; use 3.12 or 3.13")
        uv = dag.container().from_(UV_IMAGE).file("/uv")
        return (
            dag.container()
            .from_(image)
            .with_file("/usr/local/bin/uv", uv, permissions=0o755)
            .with_mounted_cache("/root/.cache/uv", dag.cache_volume("fretbook-uv"))
            .with_env_variable("UV_CACHE_DIR", "/root/.cache/uv")
            .with_env_variable("UV_LINK_MODE", "copy")
            .with_env_variable("UV_SYSTEM_PYTHON", "1")
            .with_env_variable("CI", "true")
            .with_env_variable("PIP_DISABLE_PIP_VERSION_CHECK", "1")
        )

    def _mount_reports(self, ctr: dagger.Container) -> dagger.Container:
        return ctr.with_mounted_cache("/ci-artifacts", dag.cache_volume("fretbook-ci-artifacts"))

    def _mark_run(self, ctr: dagger.Container, run_id: str) -> dagger.Container:
        """Set after installs so a new run id re-executes checks, not downloads."""
        _check_run_id(run_id)
        return ctr.with_env_variable("FRETBOOK_CI_RUN", run_id)

    def _npm_modules(self, source: dagger.Directory) -> dagger.Directory:
        web = source.directory("web")
        return (
            dag.container()
            .from_(NODE_IMAGE)
            .with_mounted_cache("/root/.npm", dag.cache_volume("fretbook-npm"))
            .with_env_variable("npm_config_cache", "/root/.npm")
            .with_env_variable("CI", "true")
            .with_workdir("/src/web")
            .with_file("/src/web/package.json", web.file("package.json"))
            .with_file("/src/web/package-lock.json", web.file("package-lock.json"))
            .with_exec(["npm", "ci"])
            .directory("/src/web/node_modules")
        )

    def _with_node(self, ctr: dagger.Container) -> dagger.Container:
        node = dag.container().from_(NODE_IMAGE)
        return ctr.with_directory("/opt/node", node.directory("/usr/local")).with_env_variable(
            "PATH", "/opt/node/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin"
        )

    def _node_binary(self) -> dagger.File:
        return dag.container().from_(NODE_IMAGE).file("/usr/local/bin/node")

    def _gp_converter(self, source: dagger.Directory) -> dagger.File:
        web = source.directory("web")
        return (
            dag.container()
            .from_(NODE_IMAGE)
            .with_directory("/src/web", web)
            .with_directory("/src/web/node_modules", self._npm_modules(source))
            .with_workdir("/src/web")
            .with_exec(["npm", "run", "build:gp-cli"])
            .file("/src/web/dist-gp/gp-to-document.mjs")
        )

    def _with_python_deps(self, ctr: dagger.Container, source: dagger.Directory, requirements: str) -> dagger.Container:
        ctr = ctr.with_file("/tmp/requirements.txt", source.file("requirements.txt"))
        if requirements == "requirements-dev.txt":
            ctr = ctr.with_file("/tmp/requirements-dev.txt", source.file("requirements-dev.txt"))
            target = "/tmp/requirements-dev.txt"
        else:
            target = "/tmp/requirements.txt"
        return ctr.with_exec(["uv", "pip", "install", "--python", "/usr/local/bin/python3", "--system", "-r", target])

    async def _backend(self, source: dagger.Directory, version: str, run_id: str) -> str:
        ctr = self._mount_reports(self._python(version))
        ctr = self._with_python_deps(ctr, source, "requirements-dev.txt")
        ctr = (
            ctr.with_file("/usr/local/bin/node", self._node_binary(), permissions=0o755)
            .with_directory("/src", source)
            .with_file("/src/web/dist-gp/gp-to-document.mjs", self._gp_converter(source))
            .with_workdir("/src")
            .with_exec(["node", "--version"])
        )
        ctr = self._mark_run(ctr, run_id)
        ctr = (
            ctr.with_exec(["ruff", "check", "fretbook", "tests"])
            .with_exec(["ruff", "format", "--check", "fretbook", "tests"])
            .with_exec(["mypy"])
        )
        if version == "3.12":
            ctr = ctr.with_exec(["bash", "-c", _PYTEST_COV])
        else:
            ctr = ctr.with_exec(["python", "-m", "pytest"]).with_exec(["echo", f"backend {version} ok"])
        return await ctr.stdout()

    async def _frontend(self, source: dagger.Directory, run_id: str) -> str:
        ctr = (
            self._mount_reports(dag.container().from_(NODE_IMAGE))
            .with_env_variable("CI", "true")
            .with_directory("/src", source)
            .with_directory("/src/web/node_modules", self._npm_modules(source))
            .with_workdir("/src/web")
        )
        ctr = self._mark_run(ctr, run_id)
        ctr = (
            ctr.with_exec(["npm", "run", "lint"])
            .with_exec(["npm", "run", "format:check"])
            .with_exec(["npm", "run", "api-types:check"])
            .with_exec(["npm", "run", "check"])
            .with_exec(["npm", "run", "test:coverage"])
            .with_exec(["bash", "-c", _WEB_COVERAGE])
            .with_exec(["npm", "run", "build"])
            .with_exec(["bash", "-c", _WEB_SUMMARY])
        )
        return await ctr.stdout()

    async def _openapi(self, source: dagger.Directory, run_id: str) -> str:
        ctr = self._with_python_deps(self._python("3.12"), source, "requirements.txt")
        ctr = ctr.with_directory("/src", source).with_workdir("/src")
        ctr = self._mark_run(ctr, run_id)
        return await (
            ctr.with_exec(["python", "-m", "fretbook.openapi", "--check"]).with_exec(["echo", "openapi ok"]).stdout()
        )

    async def _repo_checks(self, source: dagger.Directory, run_id: str) -> str:
        ctr = (
            dag.container()
            .from_(PYTHON_312)
            .with_env_variable("CI", "true")
            .with_directory("/src", source)
            .with_workdir("/src")
        )
        ctr = self._mark_run(ctr, run_id)
        return await ctr.with_exec(
            ["bash", "-c", "python3 scripts/check_migrations.py && python3 scripts/check_locales.py"]
        ).stdout()

    async def _ui_only(
        self,
        source: dagger.Directory,
        labels: str,
        base_sha: str,
        head_sha: str,
        repository: str,
        head_repository: str,
    ) -> str:
        script = source.file("scripts/check_ui_only.sh")
        # The script exits 0 before it touches git when the label is absent.
        # Skip the clone in that case so `dagger call ci` stays local.
        if not (_has_ui_only(labels) and base_sha and head_sha):
            return await (
                dag.container()
                .from_(PYTHON_312)
                .with_file("/src/scripts/check_ui_only.sh", script)
                .with_workdir("/src")
                .with_env_variable("LABELS", labels)
                .with_env_variable("BASE_SHA", base_sha)
                .with_env_variable("HEAD_SHA", head_sha)
                .with_exec(["bash", "scripts/check_ui_only.sh"])
                .stdout()
            )

        _check_repo(repository)
        head_repo = head_repository or repository
        _check_repo(head_repo)
        _check_sha(base_sha)
        _check_sha(head_sha)
        return await (
            dag.container()
            .from_(PYTHON_312)
            .with_env_variable("DEBIAN_FRONTEND", "noninteractive")
            .with_exec(["apt-get", "update"])
            .with_exec(["apt-get", "install", "-y", "--no-install-recommends", "git", "ca-certificates"])
            .with_file("/tmp/check_ui_only.sh", script)
            .with_env_variable("LABELS", labels)
            .with_env_variable("BASE_SHA", base_sha)
            .with_env_variable("HEAD_SHA", head_sha)
            .with_env_variable("REPOSITORY", repository)
            .with_env_variable("HEAD_REPOSITORY", head_repo)
            .with_env_variable("GIT_TERMINAL_PROMPT", "0")
            .with_exec(["bash", "-c", _FETCH_COMMITS])
            .with_workdir("/repo")
            .with_exec(["bash", "/tmp/check_ui_only.sh"])
            .stdout()
        )

    async def _e2e(self, source: dagger.Directory, run_id: str) -> str:
        web = source.directory("web")
        modules = self._npm_modules(source)
        ctr = self._with_node(self._mount_reports(self._python("3.12")))
        ctr = (
            ctr.with_mounted_cache("/root/.cache/ms-playwright", dag.cache_volume("fretbook-playwright"))
            .with_env_variable("PLAYWRIGHT_BROWSERS_PATH", "/root/.cache/ms-playwright")
            .with_env_variable("FRETBOOK_E2E_PYTHON", "python3")
            .with_exec(["node", "--version"])
            .with_exec(["npm", "--version"])
        )
        ctr = self._with_python_deps(ctr, source, "requirements.txt")
        ctr = (
            ctr.with_directory("/opt/web/node_modules", modules)
            .with_file("/opt/web/package.json", web.file("package.json"))
            .with_file("/opt/web/package-lock.json", web.file("package-lock.json"))
            .with_workdir("/opt/web")
            .with_exec(["npx", "playwright", "install", "--with-deps", "chromium"])
            .with_directory("/src", source)
            .with_directory("/src/web/node_modules", modules)
            .with_workdir("/src/web")
        )
        ctr = self._mark_run(ctr, run_id)
        return await ctr.with_exec(["npm", "run", "check:e2e"]).with_exec(["bash", "-c", _E2E]).stdout()

    async def _pip_audit(self, source: dagger.Directory, run_id: str) -> str:
        ctr = (
            self._python("3.12")
            .with_mounted_cache("/root/.cache/pip", dag.cache_volume("fretbook-pip"))
            .with_env_variable("PIP_CACHE_DIR", "/root/.cache/pip")
            .with_file("/src/requirements.txt", source.file("requirements.txt"))
            .with_exec(["pip", "install", "pip-audit"])
        )
        ctr = self._mark_run(ctr, run_id)
        return await ctr.with_exec(["pip-audit", "-r", "/src/requirements.txt"]).stdout()

    async def _npm_audit(self, source: dagger.Directory, run_id: str) -> str:
        ctr = (
            dag.container()
            .from_(NODE_IMAGE)
            .with_env_variable("CI", "true")
            .with_directory("/src/web", source.directory("web"))
            .with_workdir("/src/web")
        )
        ctr = self._mark_run(ctr, run_id)
        return await ctr.with_exec(["npm", "audit", "--omit=dev", "--audit-level=high"]).stdout()

    async def _audit(self, source: dagger.Directory, run_id: str) -> str:
        pip, npm = await asyncio.gather(self._pip_audit(source, run_id), self._npm_audit(source, run_id))
        return f"### pip-audit\n{pip.rstrip()}\n\n### npm audit\n{npm.rstrip()}"

    async def _run(
        self,
        source: dagger.Directory,
        labels: str,
        base_sha: str,
        head_sha: str,
        repository: str,
        head_repository: str,
        run_id: str,
    ) -> str:
        _check_run_id(run_id)
        _check_repo(repository)
        if head_repository:
            _check_repo(head_repository)
        coros = [
            ("backend (3.12)", self._backend(source, "3.12", run_id)),
            ("backend (3.13)", self._backend(source, "3.13", run_id)),
            ("frontend", self._frontend(source, run_id)),
            ("openapi", self._openapi(source, run_id)),
            ("repo-checks", self._repo_checks(source, run_id)),
            ("ui-only", self._ui_only(source, labels, base_sha, head_sha, repository, head_repository)),
            ("e2e", self._e2e(source, run_id)),
            ("audit", self._audit(source, run_id)),
        ]
        names = [name for name, _ in coros]
        results = await asyncio.gather(*(coro for _, coro in coros), return_exceptions=True)
        failures: list[str] = []
        chunks: list[str] = []
        for name, result in zip(names, results, strict=True):
            if isinstance(result, dagger.ExecError):
                failures.append(_format_exec(name, result))
            elif isinstance(result, Exception):
                failures.append(f"{name} failed: {result}")
            else:
                chunks.append(f"## {name}\n{result.rstrip()}")
        if failures:
            passed = ", ".join(
                name for name, result in zip(names, results, strict=True) if not isinstance(result, Exception)
            )
            failed = ", ".join(
                name for name, result in zip(names, results, strict=True) if isinstance(result, Exception)
            )
            detail = "\n\n".join(failures)
            raise RuntimeError(f"Fretbook CI failed ({failed})\nPassed: {passed or 'none'}\n\n{detail}")
        return "Fretbook CI passed\n\n" + "\n\n".join(chunks) + "\n"

    @function
    async def lint(self, source: Source) -> str:
        """Ruff lint and format check (the original proof-of-concept command)."""
        return await (
            self._python("3.12")
            .with_file("/tmp/requirements-dev.txt", source.file("requirements-dev.txt"))
            .with_exec(["bash", "-c", "uv pip install --system \"$(grep '^ruff==' /tmp/requirements-dev.txt)\""])
            .with_directory("/src", source)
            .with_workdir("/src")
            .with_exec(["ruff", "check", "fretbook", "tests"])
            .with_exec(["ruff", "format", "--check", "fretbook", "tests"])
            .with_exec(["echo", "lint ok"])
            .stdout()
        )

    @function
    async def backend(
        self,
        source: Source,
        version: Annotated[str, Doc("Python version: 3.12 (with coverage) or 3.13")] = "3.12",
        run_id: Annotated[str, Doc("Cache-buster for the check commands")] = "local",
    ) -> str:
        """Ruff, format, mypy, and pytest. Coverage runs on Python 3.12."""
        return await self._backend(source, version, run_id)

    @function
    async def frontend(
        self,
        source: Source,
        run_id: Annotated[str, Doc("Cache-buster for the check commands")] = "local",
    ) -> str:
        """Lint, format, API types, svelte-check, Vitest coverage, and the web build."""
        return await self._frontend(source, run_id)

    @function
    async def openapi(
        self,
        source: Source,
        run_id: Annotated[str, Doc("Cache-buster for the check commands")] = "local",
    ) -> str:
        """Fail when the committed openapi.json does not match the app."""
        return await self._openapi(source, run_id)

    @function
    async def repo_checks(
        self,
        source: Source,
        run_id: Annotated[str, Doc("Cache-buster for the check commands")] = "local",
    ) -> str:
        """Migration numbers and locale JSON."""
        return await self._repo_checks(source, run_id)

    @function
    async def ui_only(
        self,
        source: Source,
        labels: Annotated[str, Doc("Comma-separated pull request labels")] = "",
        base_sha: Annotated[str, Doc("Pull request base commit")] = "",
        head_sha: Annotated[str, Doc("Pull request head commit")] = "",
        repository: Annotated[str, Doc("Base repository, owner/name")] = "liftedkilt/fretbook",
        head_repository: Annotated[str, Doc("Head repository, owner/name. Defaults to repository.")] = "",
    ) -> str:
        """Path guard for the ui-only label. Without the label this passes."""
        return await self._ui_only(source, labels, base_sha, head_sha, repository, head_repository)

    @function
    async def e2e(
        self,
        source: Source,
        run_id: Annotated[str, Doc("Cache-buster for the check commands")] = "local",
    ) -> str:
        """Type-check and run the Playwright suite against python -m fretbook."""
        return await self._e2e(source, run_id)

    @function
    async def audit(
        self,
        source: Source,
        run_id: Annotated[str, Doc("Cache-buster for the check commands")] = "local",
    ) -> str:
        """pip-audit on requirements.txt and npm audit (production, high and critical)."""
        return await self._audit(source, run_id)

    @function
    async def reports(
        self,
        run_id: Annotated[str, Doc("Run id passed to ci")] = "local",
    ) -> dagger.Directory:
        """Coverage HTML and Playwright traces saved by ci for this run id."""
        _check_run_id(run_id)
        return (
            dag.container()
            .from_(PYTHON_312)
            .with_mounted_cache("/ci-artifacts", dag.cache_volume("fretbook-ci-artifacts"))
            .with_env_variable("FRETBOOK_CI_RUN", run_id)
            .with_exec(["bash", "-c", _EXPORT_REPORTS])
            .directory("/out")
        )

    @function
    async def ci(
        self,
        source: Source,
        labels: Annotated[str, Doc("Comma-separated pull request labels")] = "",
        base_sha: Annotated[str, Doc("Pull request base commit")] = "",
        head_sha: Annotated[str, Doc("Pull request head commit")] = "",
        repository: Annotated[str, Doc("Base repository, owner/name")] = "liftedkilt/fretbook",
        head_repository: Annotated[str, Doc("Head repository when the pull request comes from a fork")] = "",
        run_id: Annotated[str, Doc("Unique id for this run; checks re-execute when it changes")] = "local",
    ) -> str:
        """Run every CI check concurrently. The call fails if any check fails."""
        return await self._run(source, labels, base_sha, head_sha, repository, head_repository, run_id)

    @function
    async def all(
        self,
        source: Source,
        labels: Annotated[str, Doc("Comma-separated pull request labels")] = "",
        base_sha: Annotated[str, Doc("Pull request base commit")] = "",
        head_sha: Annotated[str, Doc("Pull request head commit")] = "",
        repository: Annotated[str, Doc("Base repository, owner/name")] = "liftedkilt/fretbook",
        head_repository: Annotated[str, Doc("Head repository when the pull request comes from a fork")] = "",
        run_id: Annotated[str, Doc("Unique id for this run; checks re-execute when it changes")] = "local",
    ) -> str:
        """Alias of ci."""
        return await self._run(source, labels, base_sha, head_sha, repository, head_repository, run_id)
