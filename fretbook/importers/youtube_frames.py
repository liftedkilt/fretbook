"""Issue #6 spike: read tablature that is visible in a video.

YouTube watch URLs still do not import. ``can_handle`` stays false so a pasted
link is not mistaken for a Songsterr import, and ``import_score`` without a
local file raises :class:`ImporterNotImplemented`. A folder of frames, or a
local video, is the spike: it detects the tab, OCRs fret numbers, and returns
a score marked ``needs_review``.

The measured path renders synthetic tabs with Pillow (a dev dependency) and the
bundled DejaVu Sans Mono. OpenCV and Tesseract are not required; see
``requirements-vision.txt`` and ``docs/design/youtube-tab-import.md``.
"""

from __future__ import annotations

import argparse
import importlib
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from fretbook.importers.base import ImporterNotImplemented, ImportError, ImportRequest, ImportResult, Progress
from fretbook.importers.tab_synth import build_templates, bundled_font
from fretbook.importers.tab_vision import (
    GrayImage,
    RecognizedTab,
    TabNote,
    TabVisionError,
    extract_video_frames,
    frames_in,
    load_image,
    notes_to_document,
    recognize_image,
    recognize_images,
    stitch_tabs,
)
from fretbook.score.model import ScoreDocument

_WATCH = re.compile(
    r"^https?://(?:www\.|m\.)?(?:youtube\.com/watch\?v=|youtube\.com/shorts/|youtu\.be/)([\w-]{11})(?:\S*)?$"
)
_VIDEO_SUFFIXES = {".mp4", ".mkv", ".webm", ".mov", ".avi"}


class YouTubeFrameImporter:
    kind = "youtube-frames"

    def can_handle(self, request: ImportRequest) -> bool:
        # A YouTube link is not claimed here. Songsterr owns audio downloads, and
        # turning a watch URL into a tab is still the rest of issue #6.
        del request
        return False

    def import_score(self, request: ImportRequest, progress: Progress) -> ImportResult:
        if request.file_path is None:
            raise ImporterNotImplemented(
                "YouTube frame extraction is not available for links yet. "
                "The spike reads a local video or a folder of frames."
            )
        if not request.file_path.exists():
            raise ImportError("the video or frames folder was not found", "import.needsFile")
        progress("Reading the file", "import.readingFile")
        try:
            images = load_frames(request.file_path)
            document = recognize_images(images, _templates(), video_id=_video_id(request))
        except TabVisionError as exc:
            raise ImportError(str(exc), "import.failed") from exc
        stem = Path(request.filename or request.file_path.name).stem
        title = str(request.options.get("title") or stem or "Imported tab")
        artist = str(request.options.get("artist") or "")
        slug = _slug(title)
        progress("Tab ready", "import.tabReady")
        return ImportResult(
            title=title,
            artist=artist,
            slug=slug,
            source_kind="youtube-frames",
            source_ref={
                "needs_review": True,
                "pipeline": "classical-cv-spike",
                "frame_count": len(images),
                "video_id": _video_id(request),
            },
            document=document,
        )

    def download_video(self, video_url: str, dest: Path, progress: Progress) -> Path:
        """Download a watch URL with yt-dlp. Not used for links until the feature is finished."""
        progress("Reading the file", "import.readingFile")
        command = video_download_command(video_url, dest)
        completed = subprocess.run(command, capture_output=True, text=True, check=False)
        if completed.returncode != 0 or not dest.is_file():
            raise ImportError("video download failed", "import.failed")
        return dest

    def extract_frames(self, video_path: Path, work_dir: Path, progress: Progress) -> list[Path]:
        progress("Reading the file", "import.readingFile")
        try:
            return extract_video_frames(video_path, work_dir)
        except TabVisionError as exc:
            raise ImportError(str(exc), "import.failed") from exc

    def recognize_tab(self, frames: list[Path], progress: Progress) -> list[dict[str, Any]]:
        progress("Reading the file", "import.readingFile")
        templates = _templates()
        segments: list[dict[str, Any]] = []
        try:
            for index, frame in enumerate(frames):
                tab = recognize_image(load_image(frame), templates)
                tab.frame_index = index
                tab.time = index / 2
                segments.append(_segment(tab))
        except TabVisionError as exc:
            raise ImportError(str(exc), "import.failed") from exc
        return segments

    def stitch(self, segments: list[dict[str, Any]], progress: Progress) -> ScoreDocument:
        progress("Tab ready", "import.tabReady")
        if not segments:
            raise ImportError("no tab frames to stitch", "import.failed")
        tabs = [_from_segment(segment) for segment in segments]
        try:
            notes, points, bars, strings = stitch_tabs(tabs)
            return notes_to_document(notes, string_count=strings, bar_count=bars, points=points)
        except TabVisionError as exc:
            raise ImportError(str(exc), "import.failed") from exc


def video_download_command(video_url: str, dest: Path) -> list[str]:
    """yt-dlp argv for a 720p mp4. The URL is one argument, never a shell string."""
    if _WATCH.fullmatch(video_url) is None:
        raise ImportError("not a YouTube watch URL", "import.failed")
    dest.parent.mkdir(parents=True, exist_ok=True)
    return [
        sys.executable,
        "-m",
        "yt_dlp",
        "--no-playlist",
        "--newline",
        "-f",
        "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]/b",
        "--merge-output-format",
        "mp4",
        "-o",
        str(dest),
        video_url,
    ]


def load_frames(path: Path) -> list[GrayImage]:
    """Load a folder of frames, one image, or sample a local video with ffmpeg."""
    if path.is_dir():
        return [load_image(frame) for frame in frames_in(path)]
    if path.suffix.lower() in _VIDEO_SUFFIXES:
        with tempfile.TemporaryDirectory(prefix="fretbook-frames-") as tmp:
            saved = extract_video_frames(path, Path(tmp), fps=2)
            return [load_image(frame) for frame in saved]
    return [load_image(path)]


def _templates():
    font = bundled_font()
    if font is None:
        raise TabVisionError("DejaVu Sans Mono was not found")
    try:
        importlib.import_module("PIL")
    except ModuleNotFoundError as exc:
        raise TabVisionError("reading frames needs Pillow") from exc
    return build_templates(font)


def _video_id(request: ImportRequest) -> str | None:
    value = request.options.get("video_id")
    if isinstance(value, str) and value:
        return value
    if request.url:
        match = _WATCH.fullmatch(request.url.strip())
        if match:
            return match.group(1)
    return None


def _slug(title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return (slug or "song")[:60]


def _segment(tab: RecognizedTab) -> dict[str, Any]:
    return {
        "string_count": tab.string_count,
        "bar_count": tab.bar_count,
        "confidence": tab.confidence,
        "region": list(tab.region),
        "time": tab.time,
        "notes": [
            {"bar": note.bar, "position": note.position, "string": note.string, "fret": note.fret, "dead": note.dead}
            for note in tab.notes
        ],
    }


def _from_segment(segment: dict[str, Any]) -> RecognizedTab:
    notes = [
        TabNote(
            int(note["bar"]),
            int(note["position"]),
            int(note["string"]),
            int(note["fret"]),
            bool(note.get("dead")),
        )
        for note in segment.get("notes", [])
    ]
    region = segment.get("region") or [0, 0, 0, 0]
    return RecognizedTab(
        notes=notes,
        region=(int(region[0]), int(region[1]), int(region[2]), int(region[3])),
        string_count=int(segment["string_count"]),
        bar_count=int(segment["bar_count"]),
        confidence=float(segment.get("confidence") or 0),
        time=float(segment.get("time") or 0),
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Spike: read an on-screen tab into a Fretbook score")
    parser.add_argument("path", nargs="?", help="Local video or a folder of frames")
    parser.add_argument("--self-test", action="store_true", help="Render synthetic tabs and print measured accuracy")
    args = parser.parse_args(argv)
    if args.self_test:
        from fretbook.importers.tab_synth import evaluate

        report = evaluate()
        print(report.text())
        if not report.clean_exact() or report.f1 < 0.99:
            return 1
        return 0
    if not args.path:
        parser.error("give a video or a frames folder, or pass --self-test")
    importer = YouTubeFrameImporter()
    result = importer.import_score(
        ImportRequest(owner_id="local", file_path=Path(args.path), filename=Path(args.path).name),
        lambda message, key="": print(message),
    )
    document = result.document
    assert document is not None
    print(f"{result.title}: {len(document.bars)} bars, {len(document.tracks[0].tuning_midi)} strings")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
