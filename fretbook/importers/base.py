"""Importer contracts.

An importer turns an external source into a :class:`ScoreDocument`. Slow work
(network, audio, a future frame scan) runs inside a background job; the
importer itself should stay callable from tests with a fake fetcher.

Issue #6 implements :class:`fretbook.importers.youtube_frames.YouTubeFrameImporter`
against this same result type. Guitar Pro bytes are parsed in the browser by
alphaTab (see ``web/src/lib/alphatab/importScore.ts``) and then saved as a
normal document.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from fretbook.score.model import ScoreDocument

Progress = Callable[[str, str], None]


class ImportError(Exception):
    """A source was recognized but could not be turned into a score."""


class ImporterNotImplemented(ImportError):
    """The importer is registered so a job can find it, but not built yet."""


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
    document: ScoreDocument
    source_kind: str
    source_ref: dict
    audio: AudioFetch | None = None
    warnings: list[str] = field(default_factory=list)


class Importer(Protocol):
    kind: str

    def can_handle(self, request: ImportRequest) -> bool: ...

    def import_score(self, request: ImportRequest, progress: Progress) -> ImportResult: ...


def silent_progress(_message: str, _key: str = "") -> None:
    return None
