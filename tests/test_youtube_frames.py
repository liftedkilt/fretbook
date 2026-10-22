"""Spike for issue #6: synthetic on-screen tabs, no OpenCV and no network."""

import shutil
import subprocess
from pathlib import Path

import pytest

from fretbook.importers.base import ImportRequest, silent_progress
from fretbook.importers.tab_synth import bundled_font, evaluate, liberation_font, pieces, render_case
from fretbook.importers.tab_vision import (
    GrayImage,
    RecognizedTab,
    TabNote,
    estimate_scroll,
    load_image,
    select_stable_frames,
    stitch_tabs,
    write_pnm,
)
from fretbook.importers.youtube_frames import YouTubeFrameImporter, video_download_command
from fretbook.score.model import ScoreDocument

# Pillow 13, DejaVu Sans Mono, 1.2% salt, 0.7px blur. One salted staff "8" is missed.
MEASURED_EXPECTED = 264
MEASURED_MATCHED = 263


def test_synthetic_tabs_match_the_measured_accuracy() -> None:
    report = evaluate()
    assert report.expected == MEASURED_EXPECTED
    assert report.matched == MEASURED_MATCHED
    assert report.recognized == MEASURED_MATCHED
    assert report.clean_exact()
    assert report.f1 >= 0.99
    assert report.mean_iou >= 0.98
    if liberation_font() is not None:
        assert report.cross_font and report.cross_font[0].f1 >= 0.5


def test_folder_of_frames_becomes_a_score(tmp_path: Path) -> None:
    font = bundled_font()
    assert font is not None
    piece = pieces()[0]
    truth = render_case(piece, font, style="ascii", condition="clean")
    write_pnm(tmp_path / "frame-0001.ppm", truth.image)
    assert load_image(tmp_path / "frame-0001.ppm").pixels == truth.image.pixels

    importer = YouTubeFrameImporter()
    result = importer.import_score(
        ImportRequest(owner_id="local", file_path=tmp_path, filename="walk", options={"title": "Walk"}),
        silent_progress,
    )
    assert result.source_kind == "youtube-frames"
    assert result.source_ref["needs_review"] is True
    document = result.document
    assert isinstance(document, ScoreDocument)
    assert document.tracks[0].tuning_midi == [43, 38, 33, 28]
    assert _played(document) == {(note.bar, note.position, note.string, note.fret, note.dead) for note in truth.notes}

    segments = importer.recognize_tab([tmp_path / "frame-0001.ppm"], silent_progress)
    stitched = importer.stitch(segments, silent_progress)
    assert _played(stitched) == _played(document)


def test_duplicate_frames_and_scroll() -> None:
    font = bundled_font()
    assert font is not None
    image = render_case(pieces()[0], font, style="staff", condition="clean").image
    assert select_stable_frames([image, image, image]) == [0]
    blank = GrayImage(image.width, image.height, bytearray([image.pixels[0]]) * (image.width * image.height))
    assert select_stable_frames([image, blank, image]) == [0]
    assert estimate_scroll(image, _shift(image, 17)) == 17


def test_stitch_drops_the_overlapping_bar() -> None:
    first = _tab(
        [TabNote(0, 0, 0, 1, False), TabNote(1, 0, 0, 5, False)],
        bars=2,
        time=0.0,
    )
    second = _tab(
        [TabNote(0, 0, 0, 5, False), TabNote(1, 960, 1, 8, False)],
        bars=2,
        time=2.0,
    )
    notes, times, bars, strings = stitch_tabs([first, second])
    assert strings == 4
    assert bars == 3
    assert times == [0.0, 0.0, 2.0]
    assert [(note.bar, note.fret) for note in notes] == [(0, 1), (1, 5), (2, 8)]


def test_watch_urls_stay_unimplemented() -> None:
    importer = YouTubeFrameImporter()
    request = ImportRequest(owner_id="local", url="https://www.youtube.com/watch?v=bbbbbbbbbbb")
    assert importer.can_handle(request) is False
    with pytest.raises(Exception, match="not available") as raised:
        importer.import_score(request, silent_progress)
    assert getattr(raised.value, "key", "") == "import.notImplemented"


def test_video_download_command_rejects_other_hosts(tmp_path: Path) -> None:
    command = video_download_command("https://youtu.be/abcdefghijk", tmp_path / "clip.mp4")
    assert command[1:3] == ["-m", "yt_dlp"]
    assert command[-1] == "https://youtu.be/abcdefghijk"
    assert "--no-playlist" in command
    with pytest.raises(Exception, match="YouTube"):
        video_download_command("https://example.com/watch?v=abcdefghijk", tmp_path / "nope.mp4")


def test_local_frames_job_saves_a_song_for_review(tmp_path: Path) -> None:
    from fretbook.config import Settings
    from fretbook.db.migrate import migrate
    from fretbook.jobs.handlers import register_handlers
    from fretbook.jobs.runner import JobRunner
    from fretbook.storage.media import MediaStore
    from fretbook.storage.repository import SongRepository

    font = bundled_font()
    assert font is not None
    frames = tmp_path / "frames"
    frames.mkdir()
    write_pnm(frames / "frame-0001.ppm", render_case(pieces()[0], font, style="staff", condition="clean").image)
    settings = Settings.for_tests(tmp_path / "data")
    migrate(settings.database_path)
    songs = SongRepository(settings)
    songs.ensure_user("local", "Local")
    jobs = JobRunner(settings)
    register_handlers(jobs, songs, MediaStore(settings))
    job_id = jobs.enqueue("local", "import.youtube_frames", {"frames_dir": str(frames), "title": "Walk"})
    assert jobs.run_once() is True
    job = jobs.get("local", job_id)
    assert job is not None and job["status"] == "done", job
    song = songs.get_song("local", job["result"]["song_id"])
    assert song is not None
    assert song["source_kind"] == "youtube-frames"
    assert song["source_ref"]["needs_review"] is True
    assert song["document"]["tracks"][0]["bars"][0]["voices"][0]["beats"][0]["notes"][0]["fret"] == 0


def test_default_install_does_not_pull_opencv() -> None:
    requirements = Path("requirements.txt").read_text(encoding="utf-8").lower()
    dockerfile = Path("Dockerfile").read_text(encoding="utf-8").lower()
    dev = Path("requirements-dev.txt").read_text(encoding="utf-8").lower()
    for blob in (requirements, dockerfile, dev):
        assert "opencv" not in blob
        assert "tesseract" not in blob
        assert "paddle" not in blob
    assert "opencv-python-headless" in Path("requirements-vision.txt").read_text(encoding="utf-8")


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is not installed")
def test_local_video_round_trip(tmp_path: Path) -> None:
    font = bundled_font()
    assert font is not None
    image = render_case(pieces()[0], font, style="staff", condition="clean").image
    raw = tmp_path / "frames"
    raw.mkdir()
    for index in range(2):
        write_pnm(raw / f"frame-{index:04d}.ppm", image)
    video = tmp_path / "clip.mp4"
    encoded = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-framerate",
            "2",
            "-i",
            str(raw / "frame-%04d.ppm"),
            "-vf",
            "scale=trunc(iw/2)*2:trunc(ih/2)*2",
            "-c:v",
            "libx264",
            "-crf",
            "16",
            "-pix_fmt",
            "yuv420p",
            str(video),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert encoded.returncode == 0, encoded.stderr[-400:]
    result = YouTubeFrameImporter().import_score(
        ImportRequest(owner_id="local", file_path=video, filename="clip.mp4", options={"title": "Clip"}),
        silent_progress,
    )
    document = result.document
    assert isinstance(document, ScoreDocument)
    assert len(document.bars) == 1
    assert len(document.tracks[0].tuning_midi) == 4
    assert _played(document)


def _played(document: ScoreDocument) -> set[tuple[int, int, int, int, bool]]:
    found: set[tuple[int, int, int, int, bool]] = set()
    for bar_index, bar in enumerate(document.tracks[0].bars):
        for voice in bar.voices:
            for beat in voice.beats:
                for note in beat.notes:
                    found.add((bar_index, beat.position, note.string, note.fret, note.dead))
    return found


def _shift(image: GrayImage, dy: int) -> GrayImage:
    fill = image.pixels[0]
    out = bytearray([fill]) * (image.width * image.height)
    for y in range(image.height):
        source = y - dy
        if 0 <= source < image.height:
            start = y * image.width
            origin = source * image.width
            out[start : start + image.width] = image.pixels[origin : origin + image.width]
    return GrayImage(image.width, image.height, out)


def _tab(notes: list[TabNote], *, bars: int, time: float) -> RecognizedTab:
    return RecognizedTab(notes=notes, region=(0, 0, 10, 10), string_count=4, bar_count=bars, confidence=1, time=time)
