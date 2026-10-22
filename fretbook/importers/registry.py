"""Find the importer for a URL or an uploaded file."""

from __future__ import annotations

from fretbook.importers.base import Importer, ImportError, ImportRequest
from fretbook.importers.fretbook_json import FretbookJsonImporter
from fretbook.importers.guitarpro import GuitarProImporter
from fretbook.importers.musicxml import MusicXmlImporter
from fretbook.importers.songsterr import SongsterrImporter
from fretbook.importers.youtube_frames import YouTubeFrameImporter


def default_importers() -> list[Importer]:
    return [
        SongsterrImporter(),
        MusicXmlImporter(),
        FretbookJsonImporter(),
        GuitarProImporter(),
        YouTubeFrameImporter(),
    ]


def resolve_importer(request: ImportRequest, importers: list[Importer] | None = None) -> Importer:
    pool = importers if importers is not None else default_importers()
    if request.kind:
        for importer in pool:
            if importer.kind == request.kind:
                return importer
        raise ImportError(f"unknown importer {request.kind}")
    for importer in pool:
        if importer.can_handle(request):
            return importer
    if request.url:
        raise ImportError(
            "No importer matches this URL. Songsterr links work today. "
            "YouTube frame import is issue #6 and is not available yet."
        )
    raise ImportError("No importer matches this file. Try MusicXML or a Fretbook JSON export.")
