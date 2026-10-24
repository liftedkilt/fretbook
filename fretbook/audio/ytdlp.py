"""Download a YouTube audio track with yt-dlp.

Songsterr sync points name a YouTube video. This is not the issue #6 frame
importer; it only saves an mp3 the player can sync against.
"""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
import sys
import threading
from collections import deque
from collections.abc import Callable
from pathlib import Path
from typing import Any

from fretbook.audio.ytdlp_health import classify_failure, subprocess_env
from fretbook.config import Settings

logger = logging.getLogger(__name__)


class AudioDownloadError(RuntimeError):
    def __init__(self, message: str, key: str = "audio.failed", **params: Any) -> None:
        super().__init__(message)
        self.key = key
        self.params = params


def download_audio(
    video_id: str,
    dest: Path,
    progress: Callable[[str, str], None],
    *,
    timeout_seconds: int = 600,
    settings: Settings | None = None,
) -> None:
    """Write ``dest`` (an mp3). yt-dlp is killed after ``timeout_seconds``, so a hung download cannot
    stall the queue. ``settings`` selects the updated yt-dlp and the cookies file, when configured.
    """
    if not re.fullmatch(r"[\w-]{11}", video_id):
        raise AudioDownloadError("unexpected video id", "audio.badVideo")
    dest.parent.mkdir(parents=True, exist_ok=True)
    target = dest if dest.suffix == ".mp3" else dest.with_suffix(".mp3")
    template = str(target.with_suffix("")) + ".%(ext)s"
    progress("Downloading audio", "import.downloadingAudio")
    command = [
        sys.executable,
        "-m",
        "yt_dlp",
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "0",
        "--no-playlist",
        "--newline",
        "--socket-timeout",
        "30",
        "-o",
        template,
        f"https://www.youtube.com/watch?v={video_id}",
    ]
    env = None
    cookies_copy: Path | None = None
    if settings is not None:
        env = subprocess_env(settings)
        cookies_copy = stage_cookies(settings, target)
        if cookies_copy:
            command[3:3] = ["--cookies", str(cookies_copy)]
    try:
        run_ytdlp(command, env, target, progress, timeout_seconds)
    finally:
        if cookies_copy:
            cookies_copy.unlink(missing_ok=True)


def stage_cookies(settings: Settings, target: Path) -> Path | None:
    """A private copy of the cookies file, because yt-dlp writes the jar back when it exits."""
    source = settings.ytdlp_cookies
    if source is None:
        return None
    if not source.is_file():
        logger.warning("FRETBOOK_YTDLP_COOKIES points at %s, which is not a file", source)
        return None
    staged = target.with_name(f"{target.stem}.cookies.txt")
    shutil.copyfile(source, staged)
    staged.chmod(0o600)
    return staged


def run_ytdlp(
    command: list[str],
    env: dict[str, str] | None,
    target: Path,
    progress: Callable[[str, str], None],
    timeout_seconds: int,
    *,
    label: str = "Downloading audio",
    key: str = "import.downloadingAudio",
) -> None:
    """Run yt-dlp, report its percentage as ``label``, and raise :class:`AudioDownloadError` with a classified key.
    The video importer shares this and maps the ``audio.*`` keys to its own messages."""
    proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env)
    tail: deque[str] = deque(maxlen=40)
    timed_out = threading.Event()

    def kill() -> None:
        timed_out.set()
        proc.kill()

    watchdog = threading.Timer(timeout_seconds, kill)
    watchdog.daemon = True
    watchdog.start()
    try:
        assert proc.stdout is not None
        last = -10.0
        for line in proc.stdout:
            tail.append(line)
            match = re.search(r"\[download\]\s+([\d.]+)%", line)
            if match and float(match.group(1)) >= last + 10:
                last = float(match.group(1))
                progress(f"{label} {int(last)}%", key)
            elif "[ExtractAudio]" in line:
                progress("Converting to mp3", "import.convertingAudio")
        code = proc.wait()
    finally:
        watchdog.cancel()
        if proc.stdout is not None:
            proc.stdout.close()
    if timed_out.is_set():
        raise AudioDownloadError(
            f"audio download took longer than {timeout_seconds}s; the tab was saved and you can upload an mp3",
            "audio.timeout",
            seconds=timeout_seconds,
        )
    if code != 0:
        output = "".join(tail)
        key = classify_failure(output)
        logger.warning("yt-dlp exited with %s (%s): %s", code, key, output.strip()[-500:])
        raise AudioDownloadError("audio download failed; the tab was saved and you can upload an mp3", key)
    if not target.is_file():
        raise AudioDownloadError("yt-dlp finished without writing an mp3")
