"""Dagger pipelines for fretbook, run on the self-hosted Dagger CI (media host)."""

from typing import Annotated

import dagger
from dagger import DefaultPath, Ignore, dag, function, object_type

PYTHON_IMAGE = "python:3.12-slim"


@object_type
class FretbookCi:
    @function
    async def lint(
        self,
        source: Annotated[
            dagger.Directory,
            DefaultPath("/"),
            Ignore([".git", ".venv", "**/__pycache__", "web", "songs", "docs", "data"]),
        ],
    ) -> str:
        """Ruff lint and format check of the server code (same checks as ci.yml)."""
        return await (
            dag.container()
            .from_(PYTHON_IMAGE)
            .with_mounted_cache("/root/.cache/pip", dag.cache_volume("fretbook-pip"))
            .with_file("/tmp/requirements-dev.txt", source.file("requirements-dev.txt"))
            # Install the ruff version pinned in requirements-dev.txt.
            .with_exec(["sh", "-c", "pip install --quiet $(grep '^ruff==' /tmp/requirements-dev.txt)"])
            .with_directory("/src", source)
            .with_workdir("/src")
            .with_exec(["ruff", "check", "fretbook", "tests"])
            .with_exec(["ruff", "format", "--check", "fretbook", "tests"])
            .stdout()
        )
