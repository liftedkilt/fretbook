"""Find the importer for a URL or an uploaded file."""

from __future__ import annotations

from fretbook.importers import sniff
from fretbook.importers.ascii_tab import AsciiTabImporter
from fretbook.importers.audio_only import AudioOnlyImporter
from fretbook.importers.base import Importer, ImportError, ImportRequest
from fretbook.importers.chordpro import ChordProImporter
from fretbook.importers.fretbook_json import FretbookJsonImporter
from fretbook.importers.guitarpro import GuitarProImporter
from fretbook.importers.midi import MidiImporter
from fretbook.importers.musicxml import MusicXmlImporter
from fretbook.importers.omr import OmrImporter
from fretbook.importers.songsterr import SongsterrImporter
from fretbook.importers.youtube_frames import YouTubeFrameImporter


def default_importers() -> list[Importer]:
    return [
        SongsterrImporter(),
        MusicXmlImporter(),
        FretbookJsonImporter(),
        AsciiTabImporter(),
        ChordProImporter(),
        GuitarProImporter(),
        MidiImporter(),
        OmrImporter(),
        AudioOnlyImporter(),
        YouTubeFrameImporter(),
    ]


# Formats that map to an importer, by what the content is. Everything else the sniffer names is refused with a reason.
_IMPORTER_FOR = {
    sniff.MUSICXML: "musicxml",
    sniff.MXL: "musicxml",
    sniff.GUITAR_PRO: "guitarpro",
    sniff.FRETBOOK_JSON: "fretbook-json",
    sniff.CHORDPRO: "chordpro",
    sniff.CHORDS_OVER_LYRICS: "chordpro",
    sniff.ASCII_TAB: "ascii-tab",
    sniff.MIDI: "midi",
    sniff.AUDIO: "audio",
    sniff.PDF: "omr",
    sniff.IMAGE: "omr",
}


def refuse_by_content(kind: str | None) -> None:
    """Raise the error for a sniffed format that cannot be imported on the server; do nothing otherwise."""
    if kind == sniff.FRETBOOK_ARCHIVE:
        raise ImportError(
            "This is a Fretbook library backup. Restore it from Settings, Library backup.",
            "import.isLibraryArchive",
        )


def resolve_importer(request: ImportRequest, importers: list[Importer] | None = None) -> Importer:
    pool = importers if importers is not None else default_importers()
    if request.kind:
        for importer in pool:
            if importer.kind == request.kind:
                return importer
        raise ImportError(f"unknown importer {request.kind}", "import.unknownKind", kind=request.kind)
    if request.file_path is not None and request.file_path.is_file():
        found = sniff.sniff_path(request.file_path, request.filename).kind
        refuse_by_content(found)
        wanted = _IMPORTER_FOR.get(found or "")
        for importer in pool:
            if importer.kind == wanted:
                return importer
    for importer in pool:
        if importer.can_handle(request):
            return importer
    if request.url:
        raise ImportError(
            "No importer matches this URL. Songsterr links work today. "
            "YouTube frame import is issue #6 and is not available yet.",
            "import.noUrlImporter",
        )
    raise ImportError(
        "Couldn't recognise this file. Fretbook reads " + "; ".join(sniff.SUPPORTED_LABELS) + ".",
        "import.noFileImporter",
    )
