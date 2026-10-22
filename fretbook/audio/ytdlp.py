"""Download a YouTube audio track with yt-dlp.

Songsterr sync points name a YouTube video. This is not the issue #6 frame
importer; it only saves an mp3 the player can sync against.
"""

from __future__ import annotations

import re
import subprocess
import sys
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any


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
) -> None:
    """Write ``dest`` (an mp3). yt-dlp is killed after ``timeout_seconds``, so a hung download cannot
    stall the queue.
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
    proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
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
            match = re.search(r"\[download\]\s+([\d.]+)%", line)
            if match and float(match.group(1)) >= last + 10:
                last = float(match.group(1))
                progress(f"Downloading audio {int(last)}%", "import.downloadingAudio")
            elif "[ExtractAudio]" in line:
                progress("Converting to mp3", "import.convertingAudio")
        code = proc.wait()
    finally:
        watchdog.cancel()
    if timed_out.is_set():
        raise AudioDownloadError(
            f"audio download took longer than {timeout_seconds}s; the tab was saved and you can upload an mp3",
            "audio.timeout",
            seconds=timeout_seconds,
        )
    if code != 0:
        raise AudioDownloadError("audio download failed; the tab was saved and you can upload an mp3")
    if not target.is_file():
        raise AudioDownloadError("yt-dlp finished without writing an mp3")
