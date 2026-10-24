from pathlib import Path

from fretbook.app import import_legacy
from fretbook.auth.single_user import SingleUserAuth
from fretbook.config import Settings
from fretbook.context import AppContext
from fretbook.db.migrate import migrate
from fretbook.jobs.runner import JobRunner
from fretbook.llm.service import LlmService
from fretbook.score.legacy import legacy_document
from fretbook.storage.media import MediaStore
from fretbook.storage.repository import SongRepository
from fretbook.storage.users import UserStore

TAB = (
    'const TAB = {"title": "Old Song", "artist": "Old Artist", "bpm": 100, '
    '"strings": ["G", "D", "A", "E"], '
    '"measures": [[4, [[0, [[0, 3]]], [1, [[1, 5]]]]], [3, [[0, [[3, 0]]]]]], '
    '"songId": 1};\n'
)
PRESET = """const PRESET = {"videoId": "bbbbbbbbbbb", "points": [0.2, 2.2]};
"""


def test_legacy_folder_becomes_a_song(tmp_path: Path) -> None:
    songs = tmp_path / "songs" / "old-song"
    songs.mkdir(parents=True)
    (songs / "tab-data.js").write_text(TAB, encoding="utf-8")
    (songs / "sync-preset.js").write_text(PRESET, encoding="utf-8")
    (songs / "audio.mp3").write_bytes(b"not-really-mp3")
    settings = Settings.for_tests(tmp_path / "data", legacy_songs_dir=tmp_path / "songs")
    migrate(settings.database_path)
    repo = SongRepository(settings)
    repo.ensure_user("local", "Local")
    ctx = AppContext(
        settings=settings,
        songs=repo,
        media=MediaStore(settings),
        jobs=JobRunner(settings),
        users=UserStore(settings),
        auth=SingleUserAuth(),
        llm=LlmService(settings),
    )
    assert import_legacy(ctx) == 1
    assert import_legacy(ctx) == 0
    # The source folder is left alone (it is mounted read-only in Docker).
    assert (songs / "audio.mp3").is_file()
    listed = repo.list_songs("local")["items"]
    assert listed[0]["title"] == "Old Song"
    assert listed[0]["has_audio"] is True
    detail = repo.get_song("local", listed[0]["id"])
    assert detail is not None
    assert detail["document"]["sync"]["points"] == [0.2, 2.2]
    assert detail["document"]["tracks"][0]["tuning_midi"] == [43, 38, 33, 28]
    assert [bar["signature"] for bar in detail["document"]["bars"]] == [[4, 4], [3, 4]]
    assert detail["source_kind"] == "legacy"


def test_legacy_document_duration_is_the_gap_to_the_next_event() -> None:
    document = legacy_document(
        {
            "bpm": 90,
            "strings": ["E", "B", "G", "D", "A", "E"],
            "measures": [[4, [[0, [[5, 0]]], [2, [[5, 3]]]]]],
        }
    )
    beats = document.tracks[0].bars[0].voices[0].beats
    assert document.tracks[0].tuning_midi[0] == 64
    assert (beats[0].position, beats[0].duration) == (0, 1920)
    assert (beats[1].position, beats[1].duration) == (1920, 1920)
    assert beats[1].notes[0].fret == 3
