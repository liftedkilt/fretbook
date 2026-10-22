"""Issue #6: extract tablature from YouTube videos that show it on screen.

Do not implement recognition here. The job kind ``import.youtube_frames`` is
already registered in ``fretbook.jobs.handlers``. A follow-up should fill in
the methods below and then set ``can_handle`` for YouTube watch URLs.

Suggested pipeline, matching the issue:

1. ``download_video`` — yt-dlp, the same tool Songsterr audio already uses,
   but as a video file rather than an mp3. Run it inside the job.
2. ``extract_frames`` — sample frames, keep the ones where a tab region is
   visible and stable, and drop near-duplicates. Track scrolling.
3. ``recognize_tab`` — OCR, a vision model, or both, on the local GPU
   mentioned in the issue (RTX 5070 Ti, 16 GB). Return fret numbers, string
   lines, and rough timing.
4. ``stitch`` — merge the segments into one :class:`ScoreDocument` and align
   it with the audio via :class:`fretbook.score.model.SyncMap`.
5. Leave the result unpublished until a review screen (a normal editor page
   over the saved song) lets the user fix recognition mistakes.

``can_handle`` stays false so a pasted YouTube URL is not mistaken for a
Songsterr import.
"""

from __future__ import annotations

from pathlib import Path

from fretbook.importers.base import ImporterNotImplemented, ImportRequest, ImportResult, Progress
from fretbook.score.model import ScoreDocument


class YouTubeFrameImporter:
    kind = "youtube-frames"

    def can_handle(self, request: ImportRequest) -> bool:
        return False

    def import_score(self, request: ImportRequest, progress: Progress) -> ImportResult:
        del request, progress
        raise ImporterNotImplemented(
            "YouTube frame extraction is issue #6 and is not implemented yet. "
            "See fretbook/importers/youtube_frames.py."
        )

    def download_video(self, video_url: str, dest: Path, progress: Progress) -> Path:
        del video_url, dest, progress
        raise ImporterNotImplemented("download_video is part of issue #6")

    def extract_frames(self, video_path: Path, work_dir: Path, progress: Progress) -> list[Path]:
        del video_path, work_dir, progress
        raise ImporterNotImplemented("extract_frames is part of issue #6")

    def recognize_tab(self, frames: list[Path], progress: Progress) -> list[dict]:
        del frames, progress
        raise ImporterNotImplemented("recognize_tab is part of issue #6")

    def stitch(self, segments: list[dict], progress: Progress) -> ScoreDocument:
        del segments, progress
        raise ImporterNotImplemented("stitch is part of issue #6")
