from __future__ import annotations

from dataclasses import dataclass

from fretbook.auth.base import AuthBackend
from fretbook.config import Settings
from fretbook.jobs.runner import JobRunner
from fretbook.storage.media import MediaStore
from fretbook.storage.repository import SongRepository


@dataclass
class AppContext:
    settings: Settings
    songs: SongRepository
    media: MediaStore
    jobs: JobRunner
    auth: AuthBackend
