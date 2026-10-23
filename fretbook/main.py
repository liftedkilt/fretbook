from __future__ import annotations

import argparse
import logging
import sys
from collections.abc import Sequence
from pathlib import Path

import uvicorn

from fretbook.config import Settings


def _keep(value: str) -> int:
    count = int(value)
    if count < 1:
        raise argparse.ArgumentTypeError("must be at least 1")
    return count


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m fretbook", description="Fretbook. Without a command, start the server."
    )
    commands = parser.add_subparsers(dest="command")
    backup = commands.add_parser(
        "backup",
        help="snapshot the database and media folder",
        description=(
            "Write a consistent snapshot (SQLite online backup plus a copy of media/) "
            "to <dest>/fretbook-backup-<UTC timestamp>/. Reads FRETBOOK_DATA_DIR and FRETBOOK_DATABASE."
        ),
    )
    backup.add_argument("dest", type=Path, help="directory that receives the snapshot")
    backup.add_argument("--keep", type=_keep, metavar="N", help="keep only the newest N snapshots in dest")
    return parser


def serve() -> None:
    settings = Settings.from_env()
    uvicorn.run(
        "fretbook.asgi:app",
        host=settings.host,
        port=settings.port,
        proxy_headers=True,
        forwarded_allow_ips=settings.forwarded_allow_ips,
        root_path=settings.root_path or "",
    )


def backup(dest: Path, keep: int | None) -> int:
    from fretbook.backup.snapshot import SnapshotError, take_snapshot

    try:
        path = take_snapshot(Settings.from_env(), dest, keep=keep)
    except (SnapshotError, OSError) as exc:
        print(f"backup failed: {exc}", file=sys.stderr)
        return 1
    print(path)
    return 0


def main(argv: Sequence[str] | None = None) -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    args = _parser().parse_args(argv)
    if args.command == "backup":
        raise SystemExit(backup(args.dest, args.keep))
    serve()


if __name__ == "__main__":
    main()
