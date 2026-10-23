"""An audio file becomes a song with a blank tab, ready for transcription or for typing the tab by hand."""

from __future__ import annotations

import re
import uuid
from pathlib import Path

from fretbook.importers import sniff
from fretbook.importers.base import ImportError, ImportRequest, ImportResult, Progress
from fretbook.score.instruments import get_preset
from fretbook.score.model import Bar, Beat, ScoreDocument, Track, TrackBar, Voice
from fretbook.storage.media import AUDIO_TYPES

BLANK_BARS = 4


def blank_document(prefer: str | None = None, *, bars: int = BLANK_BARS) -> ScoreDocument:
    """Four empty bars for the user's preferred instrument family (``bass`` or ``guitar``)."""
    preset = get_preset("bass-4" if prefer == "bass" else "guitar-6")
    signature = (4, 4)
    length = Bar(signature=signature).length_ticks
    beat = length // signature[0]
    return ScoreDocument(
        bpm=120,
        bars=[Bar(signature=signature) for _ in range(bars)],
        tracks=[
            Track(
                id="trk_" + uuid.uuid4().hex[:8],
                name=preset.name,
                instrument=preset.instrument,
                tuning_midi=list(preset.tuning_midi),
                preferred=True,
                bars=[
                    TrackBar(voices=[Voice(beats=[Beat(position=index * beat, duration=beat) for index in range(4)])])
                    for _ in range(bars)
                ],
            )
        ],
    )


def song_slug(name: str) -> str:
    return (re.sub(r"[^a-z0-9]+", "-", Path(name).stem.lower()).strip("-") or "song")[:60]


class AudioOnlyImporter:
    kind = "audio"

    def can_handle(self, request: ImportRequest) -> bool:
        return (request.filename or "").lower().endswith(tuple(AUDIO_TYPES))

    def import_score(self, request: ImportRequest, progress: Progress) -> ImportResult:
        if request.file_path is None:
            raise ImportError("audio import needs a file", "import.needsFile")
        progress("Reading the audio file", "import.readingFile")
        found = sniff.sniff_path(request.file_path, request.filename)
        if found.kind != sniff.AUDIO or found.audio_suffix is None:
            raise ImportError("this is not a supported audio file", "upload.notAudio")
        name = request.filename or request.file_path.name
        stem = Path(name).stem or "Audio"
        suffix = found.audio_suffix
        progress("Ready", "import.tabReady")
        return ImportResult(
            title=stem,
            artist="",
            slug=song_slug(name),
            document=blank_document(str(request.options.get("prefer") or "")),
            source_kind="audio",
            source_ref={"filename": name},
            audio_file=request.file_path,
            # The type comes from the bytes we sniffed, not from the client.
            audio_content_type=AUDIO_TYPES[suffix],
        )
