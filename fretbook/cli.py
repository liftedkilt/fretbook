"""``fretbook-cli``: import, list, and export songs from a script.

Talks to a running Fretbook over its HTTP API with a personal API token (Settings → API tokens). It uses only the
standard library, so it runs wherever Python does. Configure it with ``FRETBOOK_URL`` and ``FRETBOOK_TOKEN``, or
``--url`` and ``--token``. Run it as ``fretbook-cli`` or ``python -m fretbook.cli``.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
import time
import uuid
from collections.abc import Iterator, Sequence
from pathlib import Path
from typing import Any
from urllib import error, parse, request

DEFAULT_URL = "http://localhost:8137"
# What a directory import picks up. A file named on the command line is sent whatever its extension.
IMPORT_SUFFIXES = frozenset(
    {
        ".gp",
        ".gp3",
        ".gp4",
        ".gp5",
        ".gpx",
        ".musicxml",
        ".mxl",
        ".xml",
        ".cho",
        ".chopro",
        ".crd",
        ".json",
        ".tab",
        ".mid",
        ".midi",
    }
)
EXPORT_FORMATS = {"json": "export.json", "musicxml": "export.musicxml", "midi": "export.mid", "chordpro": "export.cho"}
POLL_SECONDS = 1.0
JOB_TIMEOUT_SECONDS = 600.0


class CliError(Exception):
    """A failure to report on stderr without a traceback."""


class Client:
    def __init__(self, base_url: str, token: str, *, timeout: float = 60.0) -> None:
        if not token:
            raise CliError("no API token: set FRETBOOK_TOKEN or pass --token (create one in Settings → API tokens)")
        self.base = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout

    def call(
        self,
        method: str,
        path: str,
        *,
        query: dict[str, Any] | None = None,
        body: bytes | None = None,
        content_type: str | None = None,
    ) -> bytes:
        url = self.base + path
        if query:
            url += "?" + parse.urlencode(query, doseq=True)
        req = request.Request(url, data=body, method=method)
        req.add_header("Authorization", f"Bearer {self.token}")
        req.add_header("Accept", "application/json, */*")
        if content_type:
            req.add_header("Content-Type", content_type)
        try:
            with request.urlopen(req, timeout=self.timeout) as response:
                return response.read()
        except error.HTTPError as exc:
            raise CliError(_describe(exc)) from exc
        except error.URLError as exc:
            raise CliError(f"cannot reach {self.base}: {exc.reason}") from exc

    def json(self, method: str, path: str, **kwargs: Any) -> Any:
        return json.loads(self.call(method, path, **kwargs))

    def upload(self, path: str, field: str, filename: str, data: bytes) -> Any:
        boundary = uuid.uuid4().hex
        quoted = filename.replace('"', "'").replace("\r", " ").replace("\n", " ")
        kind = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        body = (
            (
                f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"; filename="{quoted}"\r\n'
                f"Content-Type: {kind}\r\n\r\n"
            ).encode()
            + data
            + f"\r\n--{boundary}--\r\n".encode()
        )
        return self.json("POST", path, body=body, content_type=f"multipart/form-data; boundary={boundary}")

    def form(self, path: str, fields: dict[str, str]) -> Any:
        return self.json(
            "POST",
            path,
            body=parse.urlencode(fields).encode(),
            content_type="application/x-www-form-urlencoded",
        )


def _describe(exc: error.HTTPError) -> str:
    """The server's own message for an error response, or the bare HTTP status."""
    try:
        detail = json.loads(exc.read()).get("detail")
    except (ValueError, AttributeError):
        detail = None
    if isinstance(detail, dict) and detail.get("message"):
        return f"{detail['message']} (HTTP {exc.code})"
    if exc.code == 401:
        return "the server refused the token (HTTP 401)"
    return f"HTTP {exc.code}"


def _is_url(text: str) -> bool:
    return text.lower().startswith(("http://", "https://"))


def collect(target: str, *, recursive: bool) -> list[str] | list[Path]:
    """The things to import for one command-line argument: a link, a file, or a directory's files."""
    if _is_url(target):
        return [target]
    path = Path(target)
    if path.is_dir():
        entries = path.rglob("*") if recursive else path.iterdir()
        return sorted(item for item in entries if item.is_file() and item.suffix.lower() in IMPORT_SUFFIXES)
    if path.is_file():
        return [path]
    raise CliError(f"{target}: no such file or directory")


def _wait(client: Client, job_id: str, *, timeout: float) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while True:
        job = client.json("GET", f"/api/jobs/{parse.quote(job_id)}")
        if job["status"] in {"done", "error"}:
            return job
        if time.monotonic() > deadline:
            raise CliError(f"job {job_id} did not finish within {timeout:.0f}s")
        time.sleep(POLL_SECONDS)


def _queue(client: Client, item: str | Path) -> str:
    """Start the import and return its job id."""
    if isinstance(item, str):
        return client.form("/api/imports/auto", {"url": item})["job_id"]
    data = item.read_bytes()
    try:
        return client.upload("/api/imports/file", "file", item.name, data)["job_id"]
    except CliError as exc:
        # Not a format picked by file name (for example a pasted-style .txt tab): let the server sniff it.
        if "HTTP 400" not in str(exc):
            raise
        return client.upload("/api/imports/auto", "file", item.name, data)["job_id"]


def _job_error(job: dict[str, Any]) -> str:
    return job.get("error") or job.get("error_key") or "import failed"


def cmd_import(client: Client, args: argparse.Namespace) -> int:
    items: list[str | Path] = []
    for target in args.targets:
        found = collect(target, recursive=args.recursive)
        if not found:
            print(f"{target}: nothing to import", file=sys.stderr)
        items.extend(found)
    failed = 0
    queued: list[tuple[str | Path, str]] = []
    for item in items:
        try:
            queued.append((item, _queue(client, item)))
        except CliError as exc:
            failed += 1
            print(f"FAILED {item}: {exc}", file=sys.stderr)
    for item, job_id in queued:
        if args.no_wait:
            print(f"queued {item} job={job_id}")
            continue
        try:
            job = _wait(client, job_id, timeout=args.timeout)
        except CliError as exc:
            failed += 1
            print(f"FAILED {item}: {exc}", file=sys.stderr)
            continue
        if job["status"] == "error":
            failed += 1
            print(f"FAILED {item}: {_job_error(job)}", file=sys.stderr)
        else:
            print(f"imported {item} song={(job.get('result') or {}).get('song_id', '')}")
    if not items:
        return 1
    return 1 if failed else 0


def _songs(client: Client, query: str) -> Iterator[dict[str, Any]]:
    cursor = ""
    while True:
        page = client.json("GET", "/api/songs", query={"q": query, "limit": 200, "cursor": cursor, "sort": "title"})
        yield from page["items"]
        cursor = page.get("next_cursor") or ""
        if not cursor:
            return


def cmd_list(client: Client, args: argparse.Namespace) -> int:
    songs = list(_songs(client, args.query))
    if args.json:
        print(json.dumps(songs, indent=2, ensure_ascii=False))
        return 0
    for song in songs:
        artist = f" — {song['artist']}" if song["artist"] else ""
        print(f"{song['id']}  {song['title']}{artist}")
    return 0


def cmd_export(client: Client, args: argparse.Namespace) -> int:
    data = client.call("GET", f"/api/songs/{parse.quote(args.song_id)}/{EXPORT_FORMATS[args.format]}")
    if args.output and args.output != "-":
        Path(args.output).write_bytes(data)
        print(f"wrote {args.output}", file=sys.stderr)
    else:
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="fretbook-cli",
        description="Import, list, and export songs in a Fretbook library with a personal API token.",
        epilog=f"Environment: FRETBOOK_URL (default {DEFAULT_URL}) and FRETBOOK_TOKEN.",
    )
    parser.add_argument("--url", default=os.environ.get("FRETBOOK_URL") or DEFAULT_URL, help="server address")
    parser.add_argument("--token", default=os.environ.get("FRETBOOK_TOKEN", ""), help="personal API token")
    commands = parser.add_subparsers(dest="command", required=True)

    importer = commands.add_parser("import", help="import files, folders, or links")
    importer.add_argument("targets", nargs="+", metavar="file|dir|url")
    importer.add_argument("-r", "--recursive", action="store_true", help="look inside subfolders of a directory")
    importer.add_argument("--no-wait", action="store_true", help="queue the imports and return without waiting")
    importer.add_argument("--timeout", type=float, default=JOB_TIMEOUT_SECONDS, help="seconds to wait per import")
    importer.set_defaults(run=cmd_import)

    lister = commands.add_parser("list", help="list songs")
    lister.add_argument("query", nargs="?", default="", help="words to match against title and artist")
    lister.add_argument("--json", action="store_true", help="print the song summaries as JSON")
    lister.set_defaults(run=cmd_list)

    exporter = commands.add_parser("export", help="download a song")
    exporter.add_argument("song_id")
    exporter.add_argument("-f", "--format", choices=sorted(EXPORT_FORMATS), default="json")
    exporter.add_argument("-o", "--output", help="file to write (default: standard output)")
    exporter.set_defaults(run=cmd_export)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.run(Client(args.url, args.token), args)
    except CliError as exc:
        print(f"fretbook-cli: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
