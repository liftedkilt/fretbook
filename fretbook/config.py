"""Environment-based configuration.

Every setting is read from a ``FRETBOOK_*`` variable so the same image can run
locally, in Docker, and behind a reverse proxy. Single-user mode is the
default. Setting ``FRETBOOK_OIDC_ISSUER`` (or ``FRETBOOK_AUTH_MODE=oidc``)
turns on sign-in through an OIDC provider such as Pocket ID.

``FRETBOOK_FORWARDED_ALLOW_IPS`` defaults to ``127.0.0.1``: only a proxy on the
same host may set ``X-Forwarded-*``. Behind a proxy in another container, set it
to that proxy's address, never ``*`` on a port clients can reach directly.
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


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default


def _auth_mode() -> str:
    raw = os.environ.get("FRETBOOK_AUTH_MODE", "").strip().lower()
    if raw:
        return raw
    return "oidc" if os.environ.get("FRETBOOK_OIDC_ISSUER", "").strip() else "single"


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
    audio_timeout_seconds: int
    static_dir: Path | None
    oidc_issuer: str
    oidc_client_id: str
    oidc_client_secret: str
    oidc_redirect_uri: str
    session_secret: str
    oidc_scopes: str = "openid profile email groups"
    oidc_groups_claim: str = "groups"
    oidc_user_group: str = "fretbook_users"
    oidc_admin_group: str = "fretbook_admins"
    oidc_post_logout_redirect_uri: str = ""
    session_max_age: int = 7 * 24 * 3600
    ytdlp_auto_update: bool = False
    ytdlp_cookies: Path | None = None
    migration_backups_keep: int = 5
    max_restore_bytes: int = 4 * 1024**3
    max_restore_unpacked_bytes: int = 16 * 1024**3
    allow_private_urls: bool = False
    fetch_max_bytes: int = 25 * 1024 * 1024
    fetch_timeout_seconds: int = 30

    @classmethod
    def from_env(cls) -> Settings:
        data_dir = Path(os.environ.get("FRETBOOK_DATA_DIR", "data")).expanduser()
        database = Path(os.environ.get("FRETBOOK_DATABASE", str(data_dir / "fretbook.sqlite")))
        legacy_raw = os.environ.get("FRETBOOK_LEGACY_SONGS_DIR", "songs")
        legacy = Path(legacy_raw).expanduser() if legacy_raw else None
        static_raw = os.environ.get("FRETBOOK_STATIC_DIR")
        cookies = os.environ.get("FRETBOOK_YTDLP_COOKIES", "").strip()
        backups_keep_raw = os.environ.get("FRETBOOK_MIGRATION_BACKUPS_KEEP", "5").strip()
        try:
            backups_keep = int(backups_keep_raw)
        except ValueError:
            backups_keep = 5
        return cls(
            host=os.environ.get("FRETBOOK_HOST", "127.0.0.1"),
            port=int(os.environ.get("FRETBOOK_PORT", "8137")),
            data_dir=data_dir,
            database_path=database,
            legacy_songs_dir=legacy,
            auth_mode=_auth_mode(),
            root_path=os.environ.get("FRETBOOK_ROOT_PATH", "").strip(),
            download_audio=_flag("FRETBOOK_DOWNLOAD_AUDIO", True),
            forwarded_allow_ips=os.environ.get("FRETBOOK_FORWARDED_ALLOW_IPS", "127.0.0.1").strip() or "127.0.0.1",
            max_upload_bytes=int(os.environ.get("FRETBOOK_MAX_UPLOAD_BYTES", str(80 * 1024 * 1024))),
            audio_timeout_seconds=int(os.environ.get("FRETBOOK_AUDIO_TIMEOUT", "600")),
            static_dir=Path(static_raw).expanduser() if static_raw else None,
            oidc_issuer=os.environ.get("FRETBOOK_OIDC_ISSUER", "").strip(),
            oidc_client_id=os.environ.get("FRETBOOK_OIDC_CLIENT_ID", "").strip(),
            oidc_client_secret=os.environ.get("FRETBOOK_OIDC_CLIENT_SECRET", "").strip(),
            oidc_redirect_uri=os.environ.get("FRETBOOK_OIDC_REDIRECT_URI", "").strip(),
            session_secret=os.environ.get("FRETBOOK_SESSION_SECRET", "").strip(),
            oidc_scopes=os.environ.get("FRETBOOK_OIDC_SCOPES", "").strip() or "openid profile email groups",
            oidc_groups_claim=os.environ.get("FRETBOOK_OIDC_GROUPS_CLAIM", "").strip() or "groups",
            # An empty user group lets every account the provider signs in use Fretbook.
            oidc_user_group=os.environ.get("FRETBOOK_OIDC_USER_GROUP", "fretbook_users").strip(),
            oidc_admin_group=os.environ.get("FRETBOOK_OIDC_ADMIN_GROUP", "fretbook_admins").strip(),
            oidc_post_logout_redirect_uri=os.environ.get("FRETBOOK_OIDC_POST_LOGOUT_REDIRECT_URI", "").strip(),
            session_max_age=int(os.environ.get("FRETBOOK_SESSION_MAX_AGE", str(7 * 24 * 3600))),
            ytdlp_auto_update=_flag("FRETBOOK_YTDLP_AUTO_UPDATE", False),
            ytdlp_cookies=Path(cookies).expanduser() if cookies else None,
            migration_backups_keep=backups_keep,
            max_restore_bytes=_int("FRETBOOK_MAX_RESTORE_BYTES", 4 * 1024**3),
            max_restore_unpacked_bytes=_int("FRETBOOK_MAX_RESTORE_UNPACKED_BYTES", 16 * 1024**3),
            allow_private_urls=_flag("FRETBOOK_ALLOW_PRIVATE_URLS", False),
            fetch_max_bytes=_int("FRETBOOK_FETCH_MAX_BYTES", 25 * 1024 * 1024),
            fetch_timeout_seconds=_int("FRETBOOK_FETCH_TIMEOUT", 30),
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
            forwarded_allow_ips="127.0.0.1",
            max_upload_bytes=2_000_000,
            audio_timeout_seconds=30,
            static_dir=None,
            oidc_issuer="",
            oidc_client_id="",
            oidc_client_secret="",
            oidc_redirect_uri="",
            session_secret="test-secret",
            migration_backups_keep=5,
        )

    @property
    def base_path(self) -> str:
        """The public URL prefix with slashes on both ends, ``/`` without one."""
        cleaned = self.root_path.strip("/")
        return f"/{cleaned}/" if cleaned else "/"

    @property
    def oidc_enabled(self) -> bool:
        return self.auth_mode == "oidc"

    @property
    def media_dir(self) -> Path:
        return self.data_dir / "media"

    @property
    def inbox_dir(self) -> Path:
        return self.data_dir / "inbox"

    @property
    def backups_dir(self) -> Path:
        return self.data_dir / "backups"

    @property
    def backup_dir(self) -> Path:
        return self.backups_dir
