"""Environment-based configuration.

Every setting is read from a ``FRETBOOK_*`` variable so the same image can run
locally, in Docker, and behind a reverse proxy. Single-user mode is the
default. Issue #5 (Pocket ID / OIDC) switches ``FRETBOOK_AUTH_MODE`` to ``oidc``.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    host: str
    port: int
    data_dir: Path
    database_path: Path
    legacy_songs_dir: Path | None
    auth_mode: str
    root_path: str
    download_audio: bool
    forwarded_allow_ips: str
    max_upload_bytes: int
    static_dir: Path | None
    oidc_issuer: str
    oidc_client_id: str
    oidc_client_secret: str
    oidc_redirect_uri: str
    session_secret: str

    @classmethod
    def from_env(cls) -> Settings:
        data_dir = Path(os.environ.get("FRETBOOK_DATA_DIR", "data")).expanduser()
        database = Path(os.environ.get("FRETBOOK_DATABASE", str(data_dir / "fretbook.sqlite")))
        legacy_raw = os.environ.get("FRETBOOK_LEGACY_SONGS_DIR", "songs")
        legacy = Path(legacy_raw).expanduser() if legacy_raw else None
        static_raw = os.environ.get("FRETBOOK_STATIC_DIR")
        return cls(
            host=os.environ.get("FRETBOOK_HOST", "127.0.0.1"),
            port=int(os.environ.get("FRETBOOK_PORT", "8137")),
            data_dir=data_dir,
            database_path=database,
            legacy_songs_dir=legacy,
            auth_mode=os.environ.get("FRETBOOK_AUTH_MODE", "single").strip().lower() or "single",
            root_path=os.environ.get("FRETBOOK_ROOT_PATH", "").strip(),
            download_audio=_flag("FRETBOOK_DOWNLOAD_AUDIO", True),
            forwarded_allow_ips=os.environ.get("FRETBOOK_FORWARDED_ALLOW_IPS", "*"),
            max_upload_bytes=int(os.environ.get("FRETBOOK_MAX_UPLOAD_BYTES", str(80 * 1024 * 1024))),
            static_dir=Path(static_raw).expanduser() if static_raw else None,
            oidc_issuer=os.environ.get("FRETBOOK_OIDC_ISSUER", "").strip(),
            oidc_client_id=os.environ.get("FRETBOOK_OIDC_CLIENT_ID", "").strip(),
            oidc_client_secret=os.environ.get("FRETBOOK_OIDC_CLIENT_SECRET", "").strip(),
            oidc_redirect_uri=os.environ.get("FRETBOOK_OIDC_REDIRECT_URI", "").strip(),
            session_secret=os.environ.get("FRETBOOK_SESSION_SECRET", "").strip(),
        )

    @classmethod
    def for_tests(cls, data_dir: Path, legacy_songs_dir: Path | None = None) -> Settings:
        data_dir.mkdir(parents=True, exist_ok=True)
        return cls(
            host="127.0.0.1",
            port=8137,
            data_dir=data_dir,
            database_path=data_dir / "fretbook.sqlite",
            legacy_songs_dir=legacy_songs_dir or (data_dir / "empty-legacy"),
            auth_mode="single",
            root_path="",
            download_audio=False,
            forwarded_allow_ips="*",
            max_upload_bytes=2_000_000,
            static_dir=None,
            oidc_issuer="",
            oidc_client_id="",
            oidc_client_secret="",
            oidc_redirect_uri="",
            session_secret="test-secret",
        )

    @property
    def media_dir(self) -> Path:
        return self.data_dir / "media"

    @property
    def inbox_dir(self) -> Path:
        return self.data_dir / "inbox"
