"""Guitar Pro 3-8 files (``.gp3``, ``.gp4``, ``.gp5``, ``.gpx``, ``.gp``).

alphaTab (MPL-2.0) already reads every version in the browser. The server runs the *same* parser:
``web/scripts/gp-to-document.ts`` is bundled with alphaTab into one ``gp-to-document.mjs`` and run
with Node, and it shares ``web/src/lib/alphatab/convert.ts`` with the browser. A file therefore
becomes the same document wherever it is read (``tests/test_guitarpro.py`` compares the two). The
CLI, the watched folder and bulk imports use this path.

The converter is found, in order, at ``FRETBOOK_GP_CONVERTER``, ``fretbook/gp/`` (the Docker image)
and ``web/dist-gp/`` (a checkout after ``npm run build:gp-cli``). Node is ``FRETBOOK_NODE`` or the
first ``node`` on ``PATH``. Without them a Guitar Pro upload fails with ``import.guitarProUnavailable``
and the browser import keeps working.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

from fretbook.importers.base import ImportError, ImportRequest, ImportResult, Progress
from fretbook.score.model import ScoreDocument

CONVERTER_NAME = "gp-to-document.mjs"
TIMEOUT_SECONDS = 60
MAX_OUTPUT_BYTES = 64 * 1024 * 1024
# A bomb-sized score should fail rather than take the server's memory (alphaTab runs in-process).
NODE_ARGS = ("--max-old-space-size=1024",)


def converter_path() -> Path | None:
    configured = os.environ.get("FRETBOOK_GP_CONVERTER", "").strip()
    here = Path(__file__).resolve()
    candidates = [Path(configured).expanduser()] if configured else []
    candidates += [here.parents[1] / "gp" / CONVERTER_NAME, here.parents[2] / "web" / "dist-gp" / CONVERTER_NAME]
    return next((path for path in candidates if path.is_file()), None)


def node_path() -> str | None:
    configured = os.environ.get("FRETBOOK_NODE", "").strip()
    return shutil.which(configured) if configured else shutil.which("node")


def available() -> bool:
    return converter_path() is not None and node_path() is not None


class GuitarProImporter:
    kind = "guitarpro"
    extensions = (".gp", ".gp3", ".gp4", ".gp5", ".gpx")

    def can_handle(self, request: ImportRequest) -> bool:
        name = (request.filename or (request.file_path.name if request.file_path else "")).lower()
        return name.endswith(self.extensions)

    def import_score(self, request: ImportRequest, progress: Progress) -> ImportResult:
        if request.file_path is None:
            raise ImportError("Guitar Pro import needs a file", "import.needsFile")
        node, converter = node_path(), converter_path()
        if node is None or converter is None:
            raise ImportError(
                "Guitar Pro import is not available on this server (Node and the converter are missing). "
                "Import the file from the browser instead.",
                "import.guitarProUnavailable",
            )
        progress("Reading Guitar Pro file", "import.readingFile")
        prefer = str(request.options.get("prefer") or "")
        command = [node, *NODE_ARGS, str(converter), str(request.file_path)]
        if prefer in {"bass", "guitar"}:
            command.append(prefer)
        try:
            done = subprocess.run(
                command,
                capture_output=True,
                timeout=TIMEOUT_SECONDS,
                check=False,
                stdin=subprocess.DEVNULL,
                env={"PATH": os.environ.get("PATH", ""), "NODE_ENV": "production"},
            )
        except subprocess.TimeoutExpired as exc:
            raise ImportError(
                "The Guitar Pro file took too long to read", "import.guitarProUnreadable", detail="timeout"
            ) from exc
        except OSError as exc:
            raise ImportError(
                "Guitar Pro import could not start Node", "import.guitarProUnavailable", detail=str(exc)
            ) from exc
        parsed = self._parse(done.stdout)
        if "error" in parsed:
            error = parsed["error"] if isinstance(parsed["error"], dict) else {}
            key = str(error.get("key") or "import.guitarProUnreadable")
            if key not in {"import.guitarProUnreadable", "import.guitarProNoFretted"}:
                key = "import.guitarProUnreadable"
            raise ImportError(f"Could not read the Guitar Pro file: {error.get('message', 'unknown error')}", key)
        try:
            document = ScoreDocument.model_validate(parsed["document"])
        except (KeyError, ValueError) as exc:
            raise ImportError("The Guitar Pro file produced an invalid score", "import.guitarProUnreadable") from exc
        filename = request.filename or request.file_path.name
        slug = "".join(ch.lower() if ch.isalnum() else "-" for ch in Path(filename).stem).strip("-") or "song"
        progress("Tab ready", "import.tabReady")
        return ImportResult(
            title=str(parsed.get("title") or "") or Path(filename).stem or slug,
            artist=str(parsed.get("artist") or ""),
            slug=slug[:60],
            document=document,
            source_kind="guitarpro",
            source_ref={"filename": filename},
        )

    @staticmethod
    def _parse(stdout: bytes) -> dict:
        if len(stdout) > MAX_OUTPUT_BYTES:
            raise ImportError("The Guitar Pro file is too large to convert", "import.guitarProUnreadable")
        try:
            parsed = json.loads(stdout)
        except ValueError as exc:
            raise ImportError("The Guitar Pro converter failed", "import.guitarProUnreadable") from exc
        if not isinstance(parsed, dict):
            raise ImportError("The Guitar Pro converter failed", "import.guitarProUnreadable")
        return parsed
