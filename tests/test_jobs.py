from pathlib import Path

from fretbook.config import Settings
from fretbook.db.migrate import migrate
from fretbook.importers.base import ImportRequest, ImportResult, silent_progress
from fretbook.importers.youtube_frames import YouTubeFrameImporter
from fretbook.jobs.handlers import _store_result, register_handlers
from fretbook.jobs.runner import JobRunner
from fretbook.score.model import Bar, Beat, Note, ScoreDocument, SyncMap, Track, TrackBar, Voice
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
          <staff-tuning line="1"><tuning-step>E</tuning-step><tuning-octave>1</tuning-octave></staff-tuning>
          <staff-tuning line="2"><tuning-step>A</tuning-step><tuning-octave>1</tuning-octave></staff-tuning>
          <staff-tuning line="3"><tuning-step>D</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
          <staff-tuning line="4"><tuning-step>G</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
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


def _runner(tmp_path: Path) -> tuple[JobRunner, SongRepository, Settings]:
    settings = Settings.for_tests(tmp_path)
    migrate(settings.database_path)
    songs = SongRepository(settings)
    songs.ensure_user("local", "Local")
    songs.ensure_user("other", "Other")
    jobs = JobRunner(settings)
    register_handlers(jobs, songs, MediaStore(settings))
    return jobs, songs, settings


def _songsterr_result(fret: int = 1, bars: int = 2) -> ImportResult:
    document = ScoreDocument(
        bars=[Bar() for _ in range(bars)],
        tracks=[
            Track(
                id="trk_2",
                name="Bass",
                instrument="bass-guitar",
                tuning_midi=[43, 38, 33, 28],
                preferred=True,
                bars=[
                    TrackBar(voices=[Voice(beats=[Beat(position=0, duration=3840, notes=[Note(string=0, fret=fret)])])])
                    for _ in range(bars)
                ],
            )
        ],
        sync=SyncMap(points=[0.5 + 2 * index for index in range(bars)]),
    )
    return ImportResult(
        title="Fixture",
        artist="Ada",
        slug="fixture",
        document=document,
        source_kind="songsterr",
        source_ref={"song_id": 42, "revision_id": fret},
    )


def test_file_job_cleans_the_inbox_and_isolates_owners(tmp_path: Path) -> None:
    jobs, songs, settings = _runner(tmp_path)
    settings.inbox_dir.mkdir(parents=True, exist_ok=True)
    path = settings.inbox_dir / "abc-song.musicxml"
    path.write_text(XML, encoding="utf-8")
    job_id = jobs.enqueue("local", "import.file", {"path": str(path), "filename": "song.musicxml"})
    assert jobs.run_once() is True
    done = jobs.get("local", job_id)
    assert done is not None and done["status"] == "done", done
    assert not path.exists()
    assert jobs.get("other", job_id) is None
    song_id = done["result"]["song_id"]
    song = songs.get_song("local", song_id)
    assert song is not None and song["document"]["tracks"][0]["tuning_midi"] == [43, 38, 33, 28]
    assert songs.get_song("other", song_id) is None
    own = songs.create_blank(
        "other", title="Secret", artist="", preset_id="guitar-6", bpm=100, measures=1, signature=(4, 4)
    )
    assert songs.get_song("local", own["id"]) is None
    assert all(row["title"] != "Secret" for row in songs.list_songs("local"))


def test_failed_file_job_still_cleans_the_inbox(tmp_path: Path) -> None:
    jobs, _songs, settings = _runner(tmp_path)
    settings.inbox_dir.mkdir(parents=True, exist_ok=True)
    path = settings.inbox_dir / "abc-bad.musicxml"
    path.write_text("<not-xml", encoding="utf-8")
    job_id = jobs.enqueue("local", "import.file", {"path": str(path), "filename": "bad.musicxml"})
    jobs.run_once()
    job = jobs.get("local", job_id)
    assert job is not None and job["status"] == "error"
    assert job["error_key"] == "musicxml.parse"
    assert not path.exists()


def test_interrupted_jobs_are_retried_once(tmp_path: Path) -> None:
    jobs, _songs, settings = _runner(tmp_path)
    job_id = jobs.enqueue("local", "import.youtube_frames", {})
    assert jobs._claim(["import.youtube_frames"]) is not None  # a restart happens here
    restarted = JobRunner(settings)
    assert restarted.recover() == 1
    job = restarted.get("local", job_id)
    assert job is not None and job["status"] == "queued"
    assert restarted._claim(["import.youtube_frames"]) is not None  # and again
    assert restarted.recover() == 0
    job = restarted.get("local", job_id)
    assert job is not None and job["status"] == "error" and job["error_key"] == "job.interrupted"


def test_reimport_keeps_taps_but_not_over_edits(tmp_path: Path) -> None:
    jobs, songs, _settings = _runner(tmp_path)
    media = MediaStore(_settings)
    job = {"owner_id": "local"}
    first = _store_result(job, _songsterr_result(fret=1), songs, media, silent_progress)
    song_id = first["song_id"]
    songs.update_sync("local", song_id, bpm=118, anchors={"0": 0.7, "1": 2.9})

    # An untouched import is refreshed in place and keeps the taps and the BPM.
    second = _store_result(job, _songsterr_result(fret=5), songs, media, silent_progress)
    assert second["song_id"] == song_id
    song = songs.get_song("local", song_id)
    assert song is not None
    assert song["document"]["sync"]["anchors"] == {"0": 0.7, "1": 2.9}
    assert song["document"]["bpm"] == 118
    assert song["document"]["tracks"][0]["bars"][0]["voices"][0]["beats"][0]["notes"][0]["fret"] == 5
    assert song["source_ref"]["revision_id"] == 5

    # After an edit, a re-import becomes a separate song and the edit survives.
    edited = ScoreDocument.model_validate(song["document"])
    edited.tracks[0].bars[1].voices[0].beats[0].notes[0].fret = 9
    songs.update_song("local", song_id, title="Fixture", artist="Ada", revision=song["revision"], document=edited)
    third = _store_result(job, _songsterr_result(fret=7), songs, media, silent_progress)
    assert third["song_id"] != song_id
    assert [warning["key"] for warning in third["warnings"]] == ["import.keptEditedCopy"]
    kept = songs.get_song("local", song_id)
    assert (
        kept is not None and kept["document"]["tracks"][0]["bars"][1]["voices"][0]["beats"][0]["notes"][0]["fret"] == 9
    )


def test_youtube_job_is_a_stub(tmp_path: Path) -> None:
    jobs, _songs, _settings = _runner(tmp_path)
    job_id = jobs.enqueue("local", "import.youtube_frames", {"url": "https://www.youtube.com/watch?v=bbbbbbbbbbb"})
    assert jobs.run_once() is True
    job = jobs.get("local", job_id)
    assert job is not None and job["status"] == "error"
    assert job["error_key"] == "import.notImplemented"


def test_youtube_importer_methods_stay_unimplemented() -> None:
    importer = YouTubeFrameImporter()
    request = ImportRequest(owner_id="local", url="https://youtu.be/bbbbbbbbbbb")
    assert importer.can_handle(request) is False
    for name in ("download_video", "extract_frames", "recognize_tab", "stitch"):
        assert hasattr(importer, name)
