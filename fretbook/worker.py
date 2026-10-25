"""A job worker process: ``python -m fretbook.worker --kinds echo,import.youtube_frames``.

It claims only the listed kinds from the shared ``jobs`` table (default: every worker-only kind),
heartbeats into the ``workers`` table so ``/api/meta`` can report which kinds have a live worker,
and writes progress and results exactly like the web process. It needs the same database file and
data directory as the web process, so it runs on the same host or on one that mounts the same volume.
"""

from __future__ import annotations

import argparse
import logging
import os
import signal
import socket
import threading
from collections.abc import Sequence

from fretbook.audio.stems import available as stems_available
from fretbook.audio.transcription import available as transcription_available
from fretbook.config import Settings
from fretbook.db.migrate import migrate
from fretbook.importers.omr import available as omr_available
from fretbook.jobs.handlers import register_handlers
from fretbook.jobs.registry import KINDS, register_kinds
from fretbook.jobs.runner import JobRunner
from fretbook.jobs.stems import KIND as STEMS_KIND
from fretbook.jobs.transcribe import KIND as TRANSCRIBE_KIND
from fretbook.storage.media import MediaStore
from fretbook.storage.repository import SongRepository

logger = logging.getLogger("fretbook.worker")
HEARTBEAT_SECONDS = 5
POLL_SECONDS = 0.4


def build_runner(settings: Settings, worker_id: str) -> JobRunner:
    runner = JobRunner(settings, worker_id=worker_id)
    register_handlers(runner, SongRepository(settings), MediaStore(settings))
    register_kinds(runner, worker=True)
    return runner


def run(
    runner: JobRunner, kinds: list[str], stop: threading.Event, *, heartbeat_seconds: float = HEARTBEAT_SECONDS
) -> None:
    """Claim and run jobs of ``kinds`` until ``stop`` is set."""
    host, pid = socket.gethostname(), os.getpid()
    runner.heartbeat(kinds, host=host, pid=pid)
    requeued = runner.recover(kinds)
    if requeued:
        logger.info("requeued %s interrupted job(s)", requeued)

    def beat() -> None:
        # Its own thread, so a long job does not make the worker look dead.
        while not stop.wait(heartbeat_seconds):
            try:
                runner.heartbeat(kinds, host=host, pid=pid)
            except Exception:
                logger.exception("heartbeat failed")

    thread = threading.Thread(target=beat, name="fretbook-worker-heartbeat", daemon=True)
    thread.start()
    try:
        while not stop.is_set():
            try:
                if runner.run_once(kinds):
                    continue
            except Exception:
                logger.exception("job worker failed")
            stop.wait(POLL_SECONDS)
    finally:
        stop.set()
        thread.join(timeout=heartbeat_seconds + 1)
        runner.forget_worker()


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m fretbook.worker", description=__doc__)
    parser.add_argument("--kinds", help="comma-separated job kinds to claim (default: every worker-only kind)")
    parser.add_argument("--id", dest="worker_id", help="worker id (default: <hostname>-<pid>)")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    args = _parser().parse_args(argv)
    settings = Settings.from_env()
    worker_id = args.worker_id or f"{socket.gethostname()}-{os.getpid()}"
    runner = build_runner(settings, worker_id)
    if args.kinds:
        kinds = [k.strip() for k in args.kinds.split(",") if k.strip()]
    else:
        kinds = sorted({name for name, kind in KINDS.items() if kind.worker_only} | set(runner.worker_only_kinds()))
        if STEMS_KIND in kinds and not stems_available():
            # Without Demucs the kind would be advertised but could never run; leave it to a worker that can.
            kinds.remove(STEMS_KIND)
            logger.warning("Demucs is not installed, so this worker does not claim %s", STEMS_KIND)
        if TRANSCRIBE_KIND in kinds and not transcription_available():
            kinds.remove(TRANSCRIBE_KIND)
            logger.warning("onnxruntime is not installed, so this worker does not claim %s", TRANSCRIBE_KIND)
    if "import.omr" in kinds and not args.kinds and not omr_available():
        kinds.remove("import.omr")
        logger.warning("Audiveris is not installed, so this worker does not claim import.omr")
    unknown = [k for k in kinds if k not in runner._handlers]
    if unknown:
        raise SystemExit(f"unknown job kind(s): {', '.join(unknown)}")
    migrate(settings.database_path, backups_dir=settings.backups_dir, backup_keep=settings.migration_backups_keep)
    stop = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stop.set())
    logger.info("worker %s claiming %s", worker_id, ", ".join(kinds))
    run(runner, kinds, stop)


if __name__ == "__main__":
    main()
