"""Download a YouTube audio track with yt-dlp.

Songsterr sync points name a YouTube video. This is not the issue #6 frame
importer; it only saves an mp3 the player can sync against.
"""

from __future__ import annotations

import re
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path


class AudioDownloadError(RuntimeError):
    pass


def download_audio(video_id: str, dest: Path, progress: Callable[[str, str], None]) -> None:
    if not re.fullmatch(r"[\w-]{11}", video_id):
        raise AudioDownloadError("unexpected video id")
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
        "-o",
        template,
        f"https://www.youtube.com/watch?v={video_id}",
    ]
    proc = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    assert proc.stdout is not None
    last = -10.0
    for line in proc.stdout:
        match = re.search(r"\[download\]\s+([\d.]+)%", line)
        if match and float(match.group(1)) >= last + 10:
            last = float(match.group(1))
            progress(f"Downloading audio {int(last)}%", "import.downloadingAudio")
        elif "[ExtractAudio]" in line:
            progress("Converting to mp3", "import.convertingAudio")
    if proc.wait() != 0:
        raise AudioDownloadError(
            "audio download failed; the tab was saved and you can upload an mp3"
        )
    if not target.is_file():
        raise AudioDownloadError("yt-dlp finished without writing an mp3")
