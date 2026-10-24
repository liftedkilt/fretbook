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
from typing import NamedTuple


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


class EnvVar(NamedTuple):
    """One documented setting: the name, the default as shown to people, and what it does."""

    name: str
    default: str
    purpose: str
    group: str


# The source of the generated configuration reference (docs/reference/configuration.md; see
# scripts/gen_config_docs.py). tests/test_config_docs.py fails when the code reads a FRETBOOK_*
# variable that is not listed here, so the reference cannot drift from the code.
ENV_VARS: tuple[EnvVar, ...] = (
    EnvVar("FRETBOOK_HOST", "`127.0.0.1`", "Bind address. The Docker image sets `0.0.0.0`.", "Server"),
    EnvVar("FRETBOOK_PORT", "`8137`", "Listen port.", "Server"),
    EnvVar(
        "FRETBOOK_ROOT_PATH",
        "empty",
        "URL prefix when a reverse proxy strips one, for example `/fretbook`.",
        "Server",
    ),
    EnvVar(
        "FRETBOOK_FORWARDED_ALLOW_IPS",
        "`127.0.0.1`",
        (
            "Proxies allowed to send `X-Forwarded-*`. Set it to your proxy's address, never `*` on a port clients"
            " can reach."
        ),
        "Server",
    ),
    EnvVar("FRETBOOK_STATIC_DIR", "built-in", "Serve the web app from another directory.", "Server"),
    EnvVar("FRETBOOK_MAX_UPLOAD_BYTES", "80 MB", "Largest upload and request body.", "Server"),
    EnvVar("FRETBOOK_DATA_DIR", "`data`", "SQLite database, media, backups and the upload inbox.", "Storage"),
    EnvVar("FRETBOOK_DATABASE", "`$FRETBOOK_DATA_DIR/fretbook.sqlite`", "Database file.", "Storage"),
    EnvVar(
        "FRETBOOK_MIGRATION_BACKUPS_KEEP",
        "`5`",
        "Number of automatic pre-migration backups to keep in `$FRETBOOK_DATA_DIR/backups`.",
        "Storage",
    ),
    EnvVar(
        "FRETBOOK_FAILED_UPLOAD_RETENTION_DAYS",
        "`7`",
        "Days to keep uploaded files from failed imports before cleaning them up.",
        "Storage",
    ),
    EnvVar(
        "FRETBOOK_USER_QUOTA_MB",
        "`0` (no limit)",
        "Most media (audio, stems, covers, kept uploads) one user may store, in MB. Uploads over it are refused.",
        "Storage",
    ),
    EnvVar(
        "FRETBOOK_MAX_RESTORE_BYTES",
        "4 GiB",
        "Largest library archive accepted by Settings → Backup and restore.",
        "Storage",
    ),
    EnvVar(
        "FRETBOOK_MAX_RESTORE_UNPACKED_BYTES",
        "16 GiB",
        "Largest total size a library archive may unpack to.",
        "Storage",
    ),
    EnvVar(
        "FRETBOOK_LEGACY_SONGS_DIR",
        "`songs`",
        "bass-tab-sync `songs/<slug>/` folders to import on start. Empty disables it.",
        "Importing",
    ),
    EnvVar(
        "FRETBOOK_INBOX_DIR",
        "empty",
        "Watched folder: files dropped here are imported. See [Watched inbox folder](../guides/inbox.md).",
        "Importing",
    ),
    EnvVar(
        "FRETBOOK_INBOX_MODE",
        "`move`",
        (
            "`move` (imported files go to `processed/`, failures to `failed/`) or `library` (the folder is read-"
            "only; changed files are imported again)."
        ),
        "Importing",
    ),
    EnvVar("FRETBOOK_INBOX_INTERVAL", "`10`", "Seconds between looks at the inbox folder.", "Importing"),
    EnvVar(
        "FRETBOOK_LESSONS_DIR",
        "`$FRETBOOK_DATA_DIR/lessons`",
        (
            "Folder of your own courses and lessons (`<course>/<lesson>.md`), added to the built-in ones. See "
            "[Writing lessons](../lessons.md)."
        ),
        "Storage",
    ),
    EnvVar(
        "FRETBOOK_ALLOW_PRIVATE_URLS",
        "`false`",
        (
            "Let pasted links point at private, loopback and link-local addresses (for example a tab server on "
            "your LAN). Off by default so a link cannot reach services on the server's own network."
        ),
        "Importing",
    ),
    EnvVar(
        "FRETBOOK_METADATA_LOOKUP",
        "`false`",
        (
            "Let a song's metadata lookup ask [MusicBrainz](https://musicbrainz.org) for its album and year, and the"
            " [Cover Art Archive](https://coverartarchive.org) for its cover, by artist and title. Off by default:"
            " the lookup sends the song's artist and title to those services."
        ),
        "Importing",
    ),
    EnvVar("FRETBOOK_FETCH_MAX_BYTES", "25 MB", "Largest download when importing from a pasted link.", "Importing"),
    EnvVar("FRETBOOK_FETCH_TIMEOUT", "`30`", "Seconds a pasted link may take to download.", "Importing"),
    EnvVar(
        "FRETBOOK_GP_CONVERTER",
        "_(auto)_",
        (
            "Path to `gp-to-document.mjs`, the Node script that reads Guitar Pro files on the server. The Docker "
            "image has it; a checkout needs `npm run build:gp-cli` in `web/`. Without it, Guitar Pro still "
            "imports from the browser."
        ),
        "Importing",
    ),
    EnvVar("FRETBOOK_NODE", "`node`", "The Node 22 binary used for Guitar Pro files.", "Importing"),
    EnvVar(
        "FRETBOOK_DOWNLOAD_AUDIO",
        "`true`",
        "Download the audio of the video a Songsterr tab is synced to, with yt-dlp.",
        "Audio downloads",
    ),
    EnvVar("FRETBOOK_AUDIO_TIMEOUT", "`600`", "Seconds before a yt-dlp download is abandoned.", "Audio downloads"),
    EnvVar(
        "FRETBOOK_YTDLP_AUTO_UPDATE",
        "`false`",
        (
            "Install the newest yt-dlp into `$FRETBOOK_DATA_DIR/ytdlp` at start and once a day, and use it. See "
            "[Keeping yt-dlp working](../guides/ytdlp.md)."
        ),
        "Audio downloads",
    ),
    EnvVar(
        "FRETBOOK_YTDLP_COOKIES",
        "empty",
        (
            "Path to a Netscape-format cookies file for yt-dlp. See the warning in [Keeping yt-dlp "
            "working](../guides/ytdlp.md#cookies-optional)."
        ),
        "Audio downloads",
    ),
    EnvVar(
        "FRETBOOK_WORKER_KINDS",
        "empty",
        (
            "Comma-separated job kinds the web process leaves for a separate `python -m fretbook.worker` process."
            " Worker-only kinds are always left to the worker. See [The job worker](../self-hosting/worker.md)."
        ),
        "Job worker",
    ),
    EnvVar(
        "FRETBOOK_DEMO_MODE",
        "`false`",
        (
            "Run a public, read-only demo: no uploads, imports, edits or deletes, and the library is reset to the demo "
            "songs at start and every night at 03:00 UTC. For single-user mode. See [Demo library and demo mode]"
            "(../guides/demo.md)."
        ),
        "Server",
    ),
    EnvVar(
        "FRETBOOK_AUTH_MODE",
        "`single`, or `oidc` when `FRETBOOK_OIDC_ISSUER` is set",
        "`single` (no login, one library) or `oidc` (sign-in, one library per user).",
        "Sign-in (OIDC)",
    ),
    EnvVar(
        "FRETBOOK_OIDC_ISSUER",
        "empty",
        "Provider URL, for example `https://id.example.com`. Setting it turns on sign-in.",
        "Sign-in (OIDC)",
    ),
    EnvVar("FRETBOOK_OIDC_CLIENT_ID", "empty", "Client id from the provider.", "Sign-in (OIDC)"),
    EnvVar(
        "FRETBOOK_OIDC_CLIENT_SECRET",
        "empty",
        "Optional. Leave empty for a public (PKCE-only) client.",
        "Sign-in (OIDC)",
    ),
    EnvVar(
        "FRETBOOK_OIDC_REDIRECT_URI",
        "empty",
        "The public callback URL, `https://<your host>[/prefix]/auth/callback`.",
        "Sign-in (OIDC)",
    ),
    EnvVar(
        "FRETBOOK_SESSION_SECRET",
        "empty",
        "At least 32 characters, for example `openssl rand -hex 32`. Signs the short-lived sign-in cookie.",
        "Sign-in (OIDC)",
    ),
    EnvVar(
        "FRETBOOK_SECRET_KEY",
        "generated",
        (
            "Encrypts the LLM API keys stored in the database. Empty: a random key is created once in"
            " `$FRETBOOK_DATA_DIR/secret.key`. Keep it out of backups that sit next to the database."
        ),
        "Storage",
    ),
    EnvVar(
        "FRETBOOK_OIDC_USER_GROUP",
        "`fretbook_users`",
        "Members get their own library. Empty admits everyone the provider signs in.",
        "Sign-in (OIDC)",
    ),
    EnvVar(
        "FRETBOOK_OIDC_ADMIN_GROUP",
        "`fretbook_admins`",
        "Members are users who also manage the Users page.",
        "Sign-in (OIDC)",
    ),
    EnvVar(
        "FRETBOOK_OIDC_GROUPS_CLAIM",
        "`groups`",
        "Claim that lists the groups, read from the ID token or else from userinfo.",
        "Sign-in (OIDC)",
    ),
    EnvVar("FRETBOOK_OIDC_SCOPES", "`openid profile email groups`", "Requested scopes.", "Sign-in (OIDC)"),
    EnvVar(
        "FRETBOOK_OIDC_POST_LOGOUT_REDIRECT_URI",
        "empty",
        "Where the provider sends the browser after sign-out. It must be registered with the provider.",
        "Sign-in (OIDC)",
    ),
    EnvVar("FRETBOOK_SESSION_MAX_AGE", "`604800`", "Session length in seconds (7 days).", "Sign-in (OIDC)"),
)

# Read from the environment but not settings a server operator sets: the command-line client's own
# variables, and build information the Docker build stamps into the image.
ENV_VARS_NOT_DOCUMENTED_HERE = frozenset({"FRETBOOK_URL", "FRETBOOK_TOKEN", "FRETBOOK_GIT_SHA"})


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
    secret_key: str = ""
    oidc_scopes: str = "openid profile email groups"
    oidc_groups_claim: str = "groups"
    oidc_user_group: str = "fretbook_users"
    oidc_admin_group: str = "fretbook_admins"
    oidc_post_logout_redirect_uri: str = ""
    session_max_age: int = 7 * 24 * 3600
    ytdlp_auto_update: bool = False
    ytdlp_cookies: Path | None = None
    migration_backups_keep: int = 5
    user_quota_mb: int = 0
    max_restore_bytes: int = 4 * 1024**3
    max_restore_unpacked_bytes: int = 16 * 1024**3
    allow_private_urls: bool = False
    fetch_max_bytes: int = 25 * 1024 * 1024
    fetch_timeout_seconds: int = 30
    # FRETBOOK_METADATA_LOOKUP: look up album, year and cover art on MusicBrainz. See fretbook/metadata.py.
    metadata_lookup: bool = False
    failed_upload_retention_days: int = 7
    # Job kinds the web process leaves for a separate worker (python -m fretbook.worker).
    worker_kinds: tuple[str, ...] = ()
    # Watched folder (FRETBOOK_INBOX_DIR; not the upload spool, ``inbox_dir``). See fretbook/inbox.py.
    inbox_watch_dir: Path | None = None
    inbox_mode: str = "move"
    inbox_interval_seconds: int = 10
    # FRETBOOK_LESSONS_DIR: the user's own courses; ``lessons_path`` is where they live when unset.
    lessons_dir: Path | None = None
    # FRETBOOK_DEMO_MODE: a read-only public demo that resets nightly. See fretbook/demo/.
    demo_mode: bool = False

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
        watch_raw = os.environ.get("FRETBOOK_INBOX_DIR", "").strip()
        inbox_mode = os.environ.get("FRETBOOK_INBOX_MODE", "").strip().lower() or "move"
        lessons_raw = os.environ.get("FRETBOOK_LESSONS_DIR", "").strip()
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
            secret_key=os.environ.get("FRETBOOK_SECRET_KEY", "").strip(),
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
            user_quota_mb=max(0, _int("FRETBOOK_USER_QUOTA_MB", 0)),
            max_restore_bytes=_int("FRETBOOK_MAX_RESTORE_BYTES", 4 * 1024**3),
            max_restore_unpacked_bytes=_int("FRETBOOK_MAX_RESTORE_UNPACKED_BYTES", 16 * 1024**3),
            allow_private_urls=_flag("FRETBOOK_ALLOW_PRIVATE_URLS", False),
            fetch_max_bytes=_int("FRETBOOK_FETCH_MAX_BYTES", 25 * 1024 * 1024),
            fetch_timeout_seconds=_int("FRETBOOK_FETCH_TIMEOUT", 30),
            metadata_lookup=_flag("FRETBOOK_METADATA_LOOKUP", False),
            failed_upload_retention_days=_int("FRETBOOK_FAILED_UPLOAD_RETENTION_DAYS", 7),
            worker_kinds=tuple(k.strip() for k in os.environ.get("FRETBOOK_WORKER_KINDS", "").split(",") if k.strip()),
            inbox_watch_dir=Path(watch_raw).expanduser() if watch_raw else None,
            inbox_mode="library" if inbox_mode == "library" else "move",
            inbox_interval_seconds=max(1, _int("FRETBOOK_INBOX_INTERVAL", 10)),
            lessons_dir=Path(lessons_raw).expanduser() if lessons_raw else None,
            demo_mode=_flag("FRETBOOK_DEMO_MODE", False),
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
            failed_upload_retention_days=7,
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
    def lessons_path(self) -> Path:
        return self.lessons_dir or self.data_dir / "lessons"

    @property
    def backups_dir(self) -> Path:
        return self.data_dir / "backups"

    @property
    def backup_dir(self) -> Path:
        return self.backups_dir
