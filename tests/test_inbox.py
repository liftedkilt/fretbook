"""The watched inbox folder (fretbook/inbox.py)."""

from dataclasses import replace
from pathlib import Path

from tests.test_api import SHEET, XML

from fretbook.config import Settings
from fretbook.db.migrate import migrate
from fretbook.inbox import InboxWatcher, is_temporary
from fretbook.storage.media import MediaStore
from fretbook.storage.repository import SongRepository
from fretbook.storage.users import UserStore

TAB = (Path(__file__).parent / "fixtures" / "corpus" / "asciitab" / "standard-guitar.tab").read_text()


def _watcher(tmp_path: Path, **changes) -> tuple[InboxWatcher, SongRepository, Path]:
    watch = tmp_path / "watch"
    watch.mkdir(exist_ok=True)
    settings = replace(Settings.for_tests(tmp_path / "data"), inbox_watch_dir=watch, **changes)
    migrate(settings.database_path, backups_dir=settings.backups_dir, backup_keep=1)
    songs = SongRepository(settings)
    songs.ensure_user("local", "Local")
    return InboxWatcher(settings, songs, MediaStore(settings)), songs, watch


def _titles(songs: SongRepository, owner: str = "local") -> list[str]:
    return sorted(song["title"] for song in songs.list_songs(owner)["items"])


def test_is_temporary() -> None:
    for name in (".hidden", "a.part", "b.crdownload", "c.tmp", "d~", "~$e.docx", ".syncthing.f.tmp"):
        assert is_temporary(name), name
    assert not is_temporary("riff.musicxml")


def test_a_file_is_imported_once_it_stops_changing_and_moved_to_processed(tmp_path: Path) -> None:
    watcher, songs, watch = _watcher(tmp_path)
    (watch / "riff.musicxml").write_text(XML)
    (watch / "notes.dat").write_text(SHEET)
    (watch / "half.musicxml.part").write_text("<score")

    assert watcher.poll() == 0  # first sighting: it might still be written
    assert _titles(songs) == []
    assert watcher.poll() == 2
    assert len(_titles(songs)) == 2
    assert sorted(p.name for p in (watch / "processed").iterdir()) == ["notes.dat", "riff.musicxml"]
    assert (watch / "half.musicxml.part").exists()
    assert not (watch / "riff.musicxml").exists()
    assert list(watcher.settings.inbox_dir.glob("*")) == []  # the spool copy is gone
    assert watcher.poll() == 0


def test_a_file_that_is_still_growing_waits(tmp_path: Path) -> None:
    watcher, songs, watch = _watcher(tmp_path)
    target = watch / "riff.musicxml"
    target.write_text(XML[:100])
    watcher.poll()
    target.write_text(XML)  # size changed between polls
    assert watcher.poll() == 0
    assert watcher.poll() == 1
    assert len(_titles(songs)) == 1


def test_a_bad_file_goes_to_failed_with_the_reason(tmp_path: Path) -> None:
    watcher, songs, watch = _watcher(tmp_path)
    (watch / "essay.dat").write_text("Dear diary, nothing musical happened today.")
    watcher.poll()
    assert watcher.poll() == 1
    assert (watch / "failed" / "essay.dat").exists()
    assert (watch / "failed" / "essay.dat.error.txt").read_text().strip()
    assert _titles(songs) == []
    # Dropping the same name again does not overwrite the earlier failure.
    (watch / "essay.dat").write_text("Still nothing musical.")
    watcher.poll()
    watcher.poll()
    assert sorted(p.name for p in (watch / "failed").iterdir()) == [
        "essay-2.dat",
        "essay-2.dat.error.txt",
        "essay.dat",
        "essay.dat.error.txt",
    ]


def test_a_file_already_in_the_library_is_skipped_not_duplicated(tmp_path: Path) -> None:
    watcher, songs, watch = _watcher(tmp_path)
    (watch / "a.tab").write_text(TAB)
    watcher.poll()
    watcher.poll()
    (watch / "again.tab").write_text(TAB)
    watcher.poll()
    watcher.poll()
    assert len(_titles(songs)) == 1
    assert (watch / "processed" / "again.tab").exists()


def test_subfolders_are_read_but_processed_and_failed_are_not(tmp_path: Path) -> None:
    watcher, songs, watch = _watcher(tmp_path)
    (watch / "band").mkdir()
    (watch / "band" / "riff.musicxml").write_text(XML)
    (watch / "processed").mkdir()
    (watch / "processed" / "old.musicxml").write_text(XML)
    watcher.poll()
    assert watcher.poll() == 1
    assert (watch / "processed" / "band" / "riff.musicxml").exists()
    assert len(_titles(songs)) == 1


def test_library_mode_leaves_files_alone_and_reimports_only_changes(tmp_path: Path) -> None:
    watcher, songs, watch = _watcher(tmp_path, inbox_mode="library")
    (watch / "sets").mkdir()
    sheet = watch / "sets" / "song.cho"
    sheet.write_text(SHEET)
    watcher.poll()
    assert watcher.poll() == 1
    assert sorted(p.name for p in watch.rglob("*") if p.is_file()) == ["song.cho"]  # nothing moved or written
    [song] = songs.list_songs("local")["items"]
    assert watcher.poll() == 0  # unchanged: nothing to do

    # Touching the file without changing its bytes is not a change.
    sheet.write_text(SHEET)
    watcher.poll()
    assert watcher.poll() == 0

    sheet.write_text(SHEET + "\n[Outro]\nC G Am F\n")
    watcher.poll()
    assert watcher.poll() == 1
    items = songs.list_songs("local")["items"]
    assert [item["id"] for item in items] == [song["id"]]  # replaced in place, not duplicated
    assert "Outro" in songs.get_song("local", song["id"])["chordpro"]


def test_library_mode_remembers_a_failure_until_the_file_changes(tmp_path: Path) -> None:
    watcher, songs, watch = _watcher(tmp_path, inbox_mode="library")
    bad = watch / "essay.dat"
    bad.write_text("Dear diary, nothing musical happened today.")
    watcher.poll()
    assert watcher.poll() == 1
    assert watcher.poll() == 0
    assert [p.name for p in watch.iterdir()] == ["essay.dat"]
    bad.write_text(SHEET)  # fixed
    watcher.poll()
    assert watcher.poll() == 1
    assert len(_titles(songs)) == 1


def test_with_sign_in_each_user_has_a_subfolder(tmp_path: Path) -> None:
    watcher, songs, watch = _watcher(tmp_path, auth_mode="oidc")
    users = UserStore(watcher.settings)
    ada = users.sign_in(subject="sub-ada", display_name="Ada Lovelace", email="ada@example.com", role="user")
    uma = users.sign_in(subject="sub-uma", display_name="Uma", email="uma@example.com", role="user")
    for folder in ("ada", "Uma", "nobody"):
        (watch / folder).mkdir()
        (watch / folder / "riff.musicxml").write_text(XML)
    (watch / "stray.musicxml").write_text(XML)
    watcher.poll()
    assert watcher.poll() == 2
    assert len(_titles(songs, ada)) == 1
    assert len(_titles(songs, uma)) == 1
    assert _titles(songs) == []
    assert (watch / "ada" / "processed" / "riff.musicxml").exists()
    assert (watch / "nobody" / "riff.musicxml").exists()
    assert (watch / "stray.musicxml").exists()


def test_the_settings_come_from_the_environment(monkeypatch, tmp_path: Path) -> None:
    assert Settings.from_env().inbox_watch_dir is None
    monkeypatch.setenv("FRETBOOK_INBOX_DIR", str(tmp_path))
    monkeypatch.setenv("FRETBOOK_INBOX_MODE", "Library")
    monkeypatch.setenv("FRETBOOK_INBOX_INTERVAL", "0")
    settings = Settings.from_env()
    assert (settings.inbox_watch_dir, settings.inbox_mode, settings.inbox_interval_seconds) == (tmp_path, "library", 1)


def test_the_app_runs_the_watcher_in_the_background(tmp_path: Path) -> None:
    import time

    from fastapi.testclient import TestClient

    from fretbook.app import create_app

    watch = tmp_path / "watch"
    watch.mkdir()
    (watch / "riff.musicxml").write_text(XML)
    settings = replace(Settings.for_tests(tmp_path / "data"), inbox_watch_dir=watch, inbox_interval_seconds=1)
    with TestClient(create_app(settings)) as client:
        for _ in range(100):
            if (watch / "processed" / "riff.musicxml").exists():
                break
            time.sleep(0.1)
        assert client.get("/api/songs").json()["total"] == 1
