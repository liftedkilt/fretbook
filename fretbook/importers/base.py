"""Importer contracts.

An importer turns an external source into a :class:`ScoreDocument` (or, for
chord sheets, ChordPro text). Slow work (network, audio, a future frame scan)
runs inside a background job; the importer itself stays callable from tests
with a fake fetcher.

Guitar Pro bytes are parsed in the browser by alphaTab (see
``web/src/lib/alphatab/importScore.ts``) and then saved as a normal document.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from fretbook.score.model import ScoreDocument

Progress = Callable[[str, str], None]


class ImportError(Exception):
    """A source was recognized but could not be turned into a song.

    ``key`` names a message under ``errors`` in the UI catalogs and ``params``
    fills it in, so the browser can show the error in the reader's language.
    The English ``str()`` stays for logs and API clients.
    """

    def __init__(self, message: str, key: str = "import.failed", **params: Any) -> None:
        super().__init__(message)
        self.key = key
        self.params = params


class ImporterNotImplemented(ImportError):
    """The importer is registered so a job can find it, but not built yet."""

    def __init__(self, message: str) -> None:
        super().__init__(message, "import.notImplemented")


@dataclass
class Notice:
    """A translatable import warning (shown to the user, not raised)."""

    key: str
    message: str
    params: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {"key": self.key, "message": self.message, "params": self.params}


@dataclass
class ImportRequest:
    owner_id: str
    url: str | None = None
    filename: str | None = None
    file_path: Path | None = None
    kind: str | None = None
    options: dict = field(default_factory=dict)


@dataclass
class AudioFetch:
    """Audio the job should download after the score is saved."""

    video_id: str


@dataclass
class ImportResult:
    title: str
    artist: str
    slug: str
    source_kind: str
    source_ref: dict
    document: ScoreDocument | None = None
    chordpro: str | None = None
    audio: AudioFetch | None = None
    audio_file: Path | None = None
    """An audio file on disk to keep as the song's audio (the job moves it into the media store)."""
    audio_content_type: str = "audio/mpeg"
    warnings: list[Notice] = field(default_factory=list)

    @property
    def content_kind(self) -> str:
        return "chords" if self.chordpro is not None else "tab"


class Importer(Protocol):
    kind: str

    def can_handle(self, request: ImportRequest) -> bool: ...

    def import_score(self, request: ImportRequest, progress: Progress) -> ImportResult: ...


def silent_progress(_message: str, _key: str = "") -> None:
    return None
