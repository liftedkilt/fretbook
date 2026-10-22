from pathlib import Path

from fretbook.config import Settings
from fretbook.db.migrate import migrate
from fretbook.importers.base import ImportRequest
from fretbook.importers.youtube_frames import YouTubeFrameImporter
from fretbook.jobs.handlers import register_handlers
from fretbook.jobs.runner import JobRunner
from fretbook.storage.media import MediaStore
from fretbook.storage.repository import SongRepository

XML = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <work><work-title>Job Song</work-title></work>
  <part-list><score-part id="P1"><part-name>Bass</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <staff-details>
          <staff-tuning line="1"><tuning-step>G</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
          <staff-tuning line="2"><tuning-step>D</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
          <staff-tuning line="3"><tuning-step>A</tuning-step><tuning-octave>1</tuning-octave></staff-tuning>
          <staff-tuning line="4"><tuning-step>E</tuning-step><tuning-octave>1</tuning-octave></staff-tuning>
        </staff-details>
      </attributes>
      <note>
        <duration>4</duration>
        <notations><technical><string>1</string><fret>1</fret></technical></notations>
      </note>
    </measure>
  </part>
</score-partwise>
"""


def _runner(tmp_path: Path) -> tuple[JobRunner, SongRepository]:
    settings = Settings.for_tests(tmp_path)
    migrate(settings.database_path)
    songs = SongRepository(settings)
    songs.ensure_user("local", "Local")
    songs.ensure_user("other", "Other")
    jobs = JobRunner(settings)
    register_handlers(jobs, songs, MediaStore(settings))
    return jobs, songs


def test_file_job_and_owner_isolation(tmp_path: Path) -> None:
    jobs, songs = _runner(tmp_path)
    path = tmp_path / "song.musicxml"
    path.write_text(XML, encoding="utf-8")
    job_id = jobs.enqueue("local", "import.file", {"path": str(path), "filename": path.name})
    assert jobs.run_once() is True
    done = jobs.get("local", job_id)
    assert done is not None and done["status"] == "done"
    assert jobs.get("other", job_id) is None
    song_id = done["result"]["song_id"]
    assert songs.get_song("other", song_id) is None
    own = songs.create_blank(
        "other",
        title="Secret",
        artist="",
        preset_id="guitar-6",
        bpm=100,
        measures=1,
        signature=(4, 4),
    )
    assert songs.get_song("local", own["id"]) is None
    assert all(row["title"] != "Secret" for row in songs.list_songs("local"))


def test_youtube_job_is_a_stub(tmp_path: Path) -> None:
    jobs, _songs = _runner(tmp_path)
    job_id = jobs.enqueue("local", "import.youtube_frames", {"url": "https://www.youtube.com/watch?v=bbbbbbbbbbb"})
    assert jobs.run_once() is True
    job = jobs.get("local", job_id)
    assert job is not None and job["status"] == "error"
    assert "not implemented" in (job["error"] or "").lower() or "issue #6" in (job["error"] or "").lower()


def test_youtube_importer_methods_stay_unimplemented() -> None:
    importer = YouTubeFrameImporter()
    request = ImportRequest(owner_id="local", url="https://youtu.be/bbbbbbbbbbb")
    assert importer.can_handle(request) is False
    for name in ("download_video", "extract_frames", "recognize_tab", "stitch"):
        assert hasattr(importer, name)
