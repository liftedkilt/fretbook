"""Built-in worker-only job kinds. Heavy features (stems, transcription, OCR) add theirs beside ``echo``."""

from __future__ import annotations

from typing import Any

from fretbook.jobs.registry import job_kind
from fretbook.jobs.runner import Progress


@job_kind("echo", worker_only=True)
def echo(job: dict[str, Any], progress: Progress) -> dict[str, Any]:
    """Return the payload. Exists to prove that a job runs in the worker and nowhere else."""
    progress("echo", "job.echo")
    return {"echo": job["payload"], "worker_id": job["worker_id"]}
