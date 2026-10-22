"""Import a Fretbook JSON export, or a bare score document."""

from __future__ import annotations

import json
import re
from pathlib import Path

from fretbook.importers.base import ImportError, ImportRequest, ImportResult, Progress
from fretbook.score.model import ScoreDocument


class FretbookJsonImporter:
    kind = "fretbook-json"

    def can_handle(self, request: ImportRequest) -> bool:
        name = (request.filename or "").lower()
        return name.endswith(".json")

    def import_score(self, request: ImportRequest, progress: Progress) -> ImportResult:
        if request.file_path is None:
            raise ImportError("JSON import needs a file")
        progress("Reading Fretbook JSON", "import.readingFile")
        try:
            payload = json.loads(request.file_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise ImportError("JSON file could not be parsed") from exc
        if not isinstance(payload, dict):
            raise ImportError("expected a Fretbook JSON object")
        document_raw = payload.get("document", payload)
        try:
            document = ScoreDocument.model_validate(document_raw)
        except ValueError as exc:
            raise ImportError(f"JSON is not a Fretbook score: {exc}") from exc
        title = str(payload.get("title") or "Untitled")
        artist = str(payload.get("artist") or "")
        stem = Path(request.filename or "song.json").stem
        slug = re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-") or "song"
        progress("Tab ready", "import.tabReady")
        return ImportResult(
            title=title,
            artist=artist,
            slug=slug[:60],
            document=document,
            source_kind="fretbook-json",
            source_ref={"filename": request.filename or request.file_path.name},
        )
