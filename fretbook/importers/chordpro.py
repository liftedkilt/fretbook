"""Import a chord sheet: a ChordPro file, or a plain chords-over-lyrics text file."""

from __future__ import annotations

import re
from pathlib import Path

from fretbook.chords import chordpro
from fretbook.importers import sniff
from fretbook.importers.base import ImportError, ImportRequest, ImportResult, Progress

EXTENSIONS = (".cho", ".chordpro", ".chopro", ".crd", ".txt")


class ChordProImporter:
    kind = "chordpro"

    def can_handle(self, request: ImportRequest) -> bool:
        return (request.filename or "").lower().endswith(EXTENSIONS)

    def import_score(self, request: ImportRequest, progress: Progress) -> ImportResult:
        if request.file_path is None:
            raise ImportError("chord sheet import needs a file", "import.needsFile")
        progress("Reading the file", "import.readingFile")
        try:
            raw = request.file_path.read_text(encoding="utf-8-sig")
        except UnicodeDecodeError as exc:
            raise ImportError("chord sheet is not UTF-8 text", "chords.notText") from exc
        name = request.filename or request.file_path.name
        if name.lower().endswith(".txt") and sniff.sniff_text(raw) not in (sniff.CHORDPRO, sniff.CHORDS_OVER_LYRICS):
            raise ImportError(
                "Couldn't recognise this text. Fretbook reads " + "; ".join(sniff.SUPPORTED_LABELS) + ".",
                "import.noFileImporter",
            )
        stem = Path(request.filename or request.file_path.name).stem
        try:
            text = chordpro.normalize(raw, title="" if chordpro.looks_like_chordpro(raw) else stem)
        except ValueError as exc:
            raise ImportError(str(exc), "chords.tooLong", limit=chordpro.MAX_CHARS) from exc
        if not text.strip():
            raise ImportError("chord sheet is empty", "chords.empty")
        meta = chordpro.metadata(text)
        slug = (re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-") or "song")[:60]
        progress("Ready", "import.tabReady")
        return ImportResult(
            title=meta.get("title") or stem,
            artist=meta.get("artist", ""),
            slug=slug,
            chordpro=text,
            source_kind="chordpro",
            source_ref={"filename": request.filename or request.file_path.name},
        )
