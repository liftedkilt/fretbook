from __future__ import annotations

from dataclasses import dataclass

from fretbook.auth.base import AuthBackend
from fretbook.config import Settings
from fretbook.importers.safe_fetch import SafeFetcher
from fretbook.jobs.runner import JobRunner
from fretbook.llm.service import LlmService
from fretbook.storage.media import MediaStore
from fretbook.storage.repository import SongRepository
from fretbook.storage.users import UserStore


@dataclass
class AppContext:
    settings: Settings
    songs: SongRepository
    media: MediaStore
    jobs: JobRunner
    users: UserStore
    auth: AuthBackend
    llm: LlmService
    # Fetches what the server downloads for the user (metadata lookups). ``None`` where nothing is fetched.
    fetcher: SafeFetcher | None = None
