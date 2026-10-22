"""Import a Fretbook JSON export (a tab or a chord sheet), or a bare score document."""

from __future__ import annotations

import json
import re
from pathlib import Path

from pydantic import ValidationError

from fretbook.importers.base import ImportError, ImportRequest, ImportResult, Progress
from fretbook.score.model import ScoreDocument


class FretbookJsonImporter:
    kind = "fretbook-json"

    def can_handle(self, request: ImportRequest) -> bool:
        return (request.filename or "").lower().endswith(".json")

    def import_score(self, request: ImportRequest, progress: Progress) -> ImportResult:
        if request.file_path is None:
            raise ImportError("JSON import needs a file", "import.needsFile")
        progress("Reading Fretbook JSON", "import.readingFile")
        try:
            payload = json.loads(request.file_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ImportError("JSON file could not be parsed", "json.parse") from exc
        if not isinstance(payload, dict):
            raise ImportError("expected a Fretbook JSON object", "json.notFretbook")
        title = str(payload.get("title") or "Untitled")
        artist = str(payload.get("artist") or "")
        stem = Path(request.filename or "song.json").stem
        slug = (re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-") or "song")[:60]
        source_ref = {"filename": request.filename or request.file_path.name}
        progress("Tab ready", "import.tabReady")
        if payload.get("content_kind") == "chords":
            chordpro = payload.get("chordpro")
            if not isinstance(chordpro, str):
                raise ImportError("chord sheet export has no ChordPro text", "json.notFretbook")
            return ImportResult(
                title=title,
                artist=artist,
                slug=slug,
                chordpro=chordpro,
                source_kind="fretbook-json",
                source_ref=source_ref,
            )
        try:
            document = ScoreDocument.model_validate(payload.get("document", payload))
        except ValidationError as exc:
            raise ImportError(f"JSON is not a Fretbook score: {exc}", "json.notFretbook") from exc
        return ImportResult(
            title=title, artist=artist, slug=slug, document=document, source_kind="fretbook-json", source_ref=source_ref
        )
