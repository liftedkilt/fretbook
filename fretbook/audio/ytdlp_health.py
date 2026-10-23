"""Keep yt-dlp usable: report its version, explain its failures, and update it.

YouTube changes often and an old yt-dlp stops working, so the version and its
age are shown in ``GET /api/meta``. With ``FRETBOOK_YTDLP_AUTO_UPDATE`` the
server installs a newer yt-dlp into ``<data dir>/ytdlp`` and runs downloads
from there when it is newer than the copy in the image.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import sys
import threading
from dataclasses import dataclass
from datetime import date
from importlib import metadata
from pathlib import Path

from fretbook.config import Settings

logger = logging.getLogger(__name__)

STALE_AFTER_DAYS = 30
UPDATE_INTERVAL_SECONDS = 24 * 3600
UPDATE_TIMEOUT_SECONDS = 300

_VERSION = re.compile(r"^(\d{4})\.(\d{1,2})\.(\d{1,2})")
_DIST_INFO = re.compile(r"^yt_dlp-(?P<version>[^-]+)\.dist-info$", re.IGNORECASE)


def update_dir(settings: Settings) -> Path:
    return settings.data_dir / "ytdlp"


def parse_version(version: str | None) -> tuple[int, ...] | None:
    """``2025.10.22`` or ``2025.10.22.232845`` as a tuple that orders by release."""
    if not version or not _VERSION.match(version):
        return None
    try:
        return tuple(int(part) for part in version.split("."))
    except ValueError:
        return None


def release_date(version: str | None) -> date | None:
    match = _VERSION.match(version or "")
    if not match:
        return None
    try:
        return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    except ValueError:
        return None


def bundled_version() -> str | None:
    try:
        return metadata.version("yt-dlp")
    except metadata.PackageNotFoundError:
        return None


def updated_version(directory: Path) -> str | None:
    """The version pip installed into ``directory``, read from its ``*.dist-info`` folder."""
    if not directory.is_dir():
        return None
    for entry in directory.iterdir():
        found = _DIST_INFO.match(entry.name)
        if found and (entry / "METADATA").is_file():
            return found.group("version")
    return None


def _is_newer(candidate: str | None, current: str | None) -> bool:
    new, old = parse_version(candidate), parse_version(current)
    if new is None:
        return False
    return old is None or new > old


def active_directory(settings: Settings) -> Path | None:
    """The update folder when it holds a yt-dlp newer than the bundled one, else ``None``."""
    directory = update_dir(settings)
    if _is_newer(updated_version(directory), bundled_version()):
        return directory
    return None


def active_version(settings: Settings) -> str | None:
    directory = active_directory(settings)
    return updated_version(directory) if directory else bundled_version()


def subprocess_env(settings: Settings) -> dict[str, str]:
    """The environment for ``python -m yt_dlp``, preferring the updated copy."""
    env = dict(os.environ)
    directory = active_directory(settings)
    if directory:
        existing = env.get("PYTHONPATH")
        env["PYTHONPATH"] = f"{directory}{os.pathsep}{existing}" if existing else str(directory)
    return env


@dataclass(frozen=True)
class YtDlpStatus:
    version: str | None
    released: str | None
    age_days: int | None
    stale: bool
    auto_update: bool
    cookies: bool


def status(settings: Settings, today: date | None = None) -> YtDlpStatus:
    version = active_version(settings)
    released = release_date(version)
    age = ((today or date.today()) - released).days if released else None
    return YtDlpStatus(
        version=version,
        released=released.isoformat() if released else None,
        age_days=age,
        stale=age is not None and age > STALE_AFTER_DAYS,
        auto_update=settings.ytdlp_auto_update,
        cookies=settings.ytdlp_cookies is not None,
    )


def update_ytdlp(settings: Settings) -> bool:
    """Install the newest yt-dlp into the update folder. ``True`` when pip succeeded.

    pip installs into a staging folder first, so a download that starts during
    the update never sees half an install.
    """
    target = update_dir(settings)
    staging = target.with_name(target.name + ".new")
    shutil.rmtree(staging, ignore_errors=True)
    staging.parent.mkdir(parents=True, exist_ok=True)
    command = [
        sys.executable,
        "-m",
        "pip",
        "install",
        "--upgrade",
        "--no-cache-dir",
        "--disable-pip-version-check",
        "--quiet",
        "--target",
        str(staging),
        "yt-dlp",
    ]
    try:
        done = subprocess.run(command, capture_output=True, text=True, timeout=UPDATE_TIMEOUT_SECONDS)
    except (OSError, subprocess.TimeoutExpired) as exc:
        logger.warning("could not update yt-dlp: %s", exc)
        shutil.rmtree(staging, ignore_errors=True)
        return False
    if done.returncode != 0 or updated_version(staging) is None:
        logger.warning("could not update yt-dlp: %s", (done.stderr or done.stdout).strip()[-500:])
        shutil.rmtree(staging, ignore_errors=True)
        return False
    old = target.with_name(target.name + ".old")
    shutil.rmtree(old, ignore_errors=True)
    if target.exists():
        target.rename(old)
    staging.rename(target)
    shutil.rmtree(old, ignore_errors=True)
    logger.info("yt-dlp updated to %s", updated_version(target))
    return True


class AutoUpdater:
    """Updates yt-dlp when the server starts and then once a day, in a background thread."""

    def __init__(self, settings: Settings, interval_seconds: float = UPDATE_INTERVAL_SECONDS) -> None:
        self.settings = settings
        self.interval_seconds = interval_seconds
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if not self.settings.ytdlp_auto_update or self._thread is not None:
            return
        self._thread = threading.Thread(target=self._run, name="ytdlp-update", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                update_ytdlp(self.settings)
            except Exception:  # noqa: BLE001 - the loop must survive any failure
                logger.exception("yt-dlp update failed")
            self._stop.wait(self.interval_seconds)


# Output fragments, lowercased. The first class with a match wins, so the more specific ones come first.
_FAILURES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "audio.geoBlocked",
        (
            "in your country",
            "geo restriction",
            "geo-restricted",
            "geo restricted",
            "from your location",
        ),
    ),
    (
        "audio.signIn",
        (
            "confirm you’re not a bot",
            "confirm you're not a bot",
            "sign in to confirm",
            "sign in to view",
            "use --cookies",
            "cookies-from-browser",
            "login required",
            "members-only",
            "age-restricted",
            "confirm your age",
        ),
    ),
    (
        "audio.unavailable",
        (
            "video unavailable",
            "this video is unavailable",
            "this video is not available",
            "video is private",
            "private video",
            "has been removed",
            "no longer available",
            "account associated with this video has been terminated",
            "copyright",
        ),
    ),
    (
        "audio.outdated",
        (
            "unable to extract",
            "nsig extraction failed",
            "signature extraction failed",
            "please report this issue",
            "update to the latest version",
            "player response",
            "requested format is not available",
            "only images are available",
            "http error 403",
            "unsupported url",
        ),
    ),
)

FAILURE_KEYS = ("audio.failed", "audio.timeout", *(key for key, _ in _FAILURES))


def classify_failure(output: str) -> str:
    """The ``errors.audio.*`` key that best explains yt-dlp's output."""
    text = output.lower()
    for key, fragments in _FAILURES:
        if any(fragment in text for fragment in fragments):
            return key
    return "audio.failed"
