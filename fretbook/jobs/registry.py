"""Job kinds that live outside ``handlers.py``: add a handler in one place with ``@job_kind``.

``worker_only`` kinds (slow or GPU-bound) are registered only by ``python -m fretbook.worker``;
the web process leaves them queued until a worker claims them.
"""

from __future__ import annotations

from dataclasses import dataclass

from fretbook.jobs.runner import Handler, JobRunner


@dataclass(frozen=True)
class JobKind:
    name: str
    handler: Handler
    worker_only: bool = False


KINDS: dict[str, JobKind] = {}


def job_kind(name: str, *, worker_only: bool = False):
    def decorate(handler: Handler) -> Handler:
        KINDS[name] = JobKind(name, handler, worker_only)
        return handler

    return decorate


def register_kinds(runner: JobRunner, *, worker: bool = False) -> None:
    """Register the kinds in the registry; the web process gets only those that are not worker-only."""
    from fretbook.jobs import worker_kinds  # noqa: F401  (importing registers the built-in kinds)

    for kind in KINDS.values():
        if worker or not kind.worker_only:
            runner.register(kind.name, kind.handler, worker_only=kind.worker_only)
