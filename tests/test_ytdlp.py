import json
import subprocess
from dataclasses import replace
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fretbook.app import create_app
from fretbook.audio import ytdlp_health
from fretbook.audio.ytdlp import AudioDownloadError, download_audio
from fretbook.audio.ytdlp_health import (
    FAILURE_KEYS,
    AutoUpdater,
    active_directory,
    classify_failure,
    parse_version,
    release_date,
    status,
    update_dir,
    update_ytdlp,
)
from fretbook.config import Settings

FAKE_MAIN = """
import json, os, sys
from pathlib import Path

Path(os.environ["FAKE_YTDLP_ARGV"]).write_text(json.dumps(sys.argv[1:]))
cookies = sys.argv[sys.argv.index("--cookies") + 1] if "--cookies" in sys.argv else None
if cookies:
    Path(os.environ["FAKE_YTDLP_COOKIES"]).write_text(Path(cookies).read_text())
message = os.environ.get("FAKE_YTDLP_ERROR")
if message:
    print("ERROR: [youtube] abc: " + message)
    sys.exit(1)
out = sys.argv[sys.argv.index("-o") + 1].replace("%(ext)s", "mp3")
Path(out).write_bytes(b"mp3")
"""


def _install(directory: Path, version: str, *, main: str = "") -> None:
    info = directory / f"yt_dlp-{version}.dist-info"
    info.mkdir(parents=True)
    (info / "METADATA").write_text(f"Name: yt-dlp\nVersion: {version}\n")
    if main:
        package = directory / "yt_dlp"
        package.mkdir()
        (package / "__init__.py").write_text("")
        (package / "__main__.py").write_text(main)


def _settings(tmp_path: Path, **changes: object) -> Settings:
    return replace(Settings.for_tests(tmp_path), **changes)


def test_version_parsing() -> None:
    assert parse_version("2025.10.22") == (2025, 10, 22)
    assert parse_version("2025.10.22.232845") > parse_version("2025.10.22")
    assert parse_version("nightly") is None
    assert release_date("2025.10.22.232845") == date(2025, 10, 22)
    assert release_date("2025.13.40") is None


def test_status_reports_age_and_staleness(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ytdlp_health, "bundled_version", lambda: "2026.09.01")
    settings = _settings(tmp_path)
    fresh = status(settings, today=date(2026, 9, 21))
    assert (fresh.version, fresh.released, fresh.age_days, fresh.stale) == ("2026.09.01", "2026-09-01", 20, False)
    old = status(settings, today=date(2026, 10, 15))
    assert (old.age_days, old.stale) == (44, True)
    assert status(settings, today=date(2026, 10, 1)).stale is False
    assert status(settings, today=date(2026, 10, 2)).stale is True


def test_status_without_yt_dlp(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ytdlp_health, "bundled_version", lambda: None)
    result = status(_settings(tmp_path))
    assert (result.version, result.released, result.age_days, result.stale) == (None, None, None, False)


def test_updated_copy_wins_only_when_newer(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ytdlp_health, "bundled_version", lambda: "2026.09.01")
    settings = _settings(tmp_path)
    assert active_directory(settings) is None
    _install(update_dir(settings), "2026.08.01")
    assert active_directory(settings) is None
    assert status(settings, today=date(2026, 9, 2)).version == "2026.09.01"

    newer = _settings(tmp_path / "newer")
    _install(update_dir(newer), "2026.10.01")
    assert active_directory(newer) == update_dir(newer)
    assert status(newer, today=date(2026, 10, 2)).version == "2026.10.01"
    assert ytdlp_health.subprocess_env(newer)["PYTHONPATH"].split(":")[0] == str(update_dir(newer))


def _fake_pip(version: str | None, code: int = 0):
    def run(command: list[str], **_kwargs: object) -> subprocess.CompletedProcess:
        assert command[1:4] == ["-m", "pip", "install"] and "--upgrade" in command and command[-1] == "yt-dlp"
        if version:
            _install(Path(command[command.index("--target") + 1]), version)
        return subprocess.CompletedProcess(command, code, "", "no network")

    return run


def test_update_installs_into_the_data_volume(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    settings = _settings(tmp_path)
    monkeypatch.setattr(ytdlp_health.subprocess, "run", _fake_pip("2026.10.20"))
    assert update_ytdlp(settings) is True
    assert ytdlp_health.updated_version(update_dir(settings)) == "2026.10.20"
    monkeypatch.setattr(ytdlp_health.subprocess, "run", _fake_pip("2026.10.22"))
    assert update_ytdlp(settings) is True
    assert ytdlp_health.updated_version(update_dir(settings)) == "2026.10.22"
    assert sorted(path.name for path in tmp_path.iterdir()) == ["ytdlp"]


def test_failed_update_keeps_the_working_copy(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    settings = _settings(tmp_path)
    _install(update_dir(settings), "2026.10.01")
    monkeypatch.setattr(ytdlp_health.subprocess, "run", _fake_pip(None, code=1))
    assert update_ytdlp(settings) is False
    assert ytdlp_health.updated_version(update_dir(settings)) == "2026.10.01"
    assert sorted(path.name for path in tmp_path.iterdir()) == ["ytdlp"]


def test_auto_update_is_off_by_default(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []
    monkeypatch.setattr(ytdlp_health, "update_ytdlp", lambda _settings: calls.append(1) or True)
    AutoUpdater(_settings(tmp_path)).start()
    assert Settings.from_env().ytdlp_auto_update is False
    assert calls == []


def test_auto_update_runs_at_start(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    done = __import__("threading").Event()
    monkeypatch.setattr(ytdlp_health, "update_ytdlp", lambda _settings: done.set() or True)
    updater = AutoUpdater(_settings(tmp_path, ytdlp_auto_update=True), interval_seconds=3600)
    updater.start()
    try:
        assert done.wait(5)
    finally:
        updater.stop()


@pytest.mark.parametrize(
    ("output", "key"),
    [
        ("ERROR: [youtube] x: Sign in to confirm you’re not a bot. Use --cookies-from-browser", "audio.signIn"),
        ("ERROR: [youtube] x: Sign in to confirm your age. This video may be inappropriate", "audio.signIn"),
        ("ERROR: [youtube] x: Video unavailable. This video is private", "audio.unavailable"),
        ("ERROR: [youtube] x: This video has been removed by the uploader", "audio.unavailable"),
        ("ERROR: [youtube] x: The uploader has not made this video available in your country", "audio.geoBlocked"),
        ("ERROR: [youtube] x: Video unavailable. The uploader has blocked it in your country", "audio.geoBlocked"),
        ("ERROR: [youtube] x: Unable to extract player response; please report this issue on", "audio.outdated"),
        ("ERROR: [youtube] x: nsig extraction failed: Some formats may be missing", "audio.outdated"),
        ("ERROR: something nobody has seen before", "audio.failed"),
        ("", "audio.failed"),
    ],
)
def test_failures_are_classified(output: str, key: str) -> None:
    assert classify_failure(output) == key


def test_every_failure_key_has_translated_advice() -> None:
    for locale in ("en", "pt-BR"):
        catalog = json.loads(Path(f"web/src/locales/{locale}.json").read_text(encoding="utf-8"))
        for key in FAILURE_KEYS:
            text = catalog["errors"]["audio"][key.split(".")[1]]
            assert isinstance(text, str) and text


@pytest.fixture
def fake_ytdlp(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Settings:
    settings = _settings(tmp_path / "data")
    _install(update_dir(settings), "2999.01.01", main=FAKE_MAIN)
    monkeypatch.setenv("FAKE_YTDLP_ARGV", str(tmp_path / "argv.json"))
    monkeypatch.setenv("FAKE_YTDLP_COOKIES", str(tmp_path / "cookies-seen.txt"))
    return settings


def _download(settings: Settings, tmp_path: Path) -> Path:
    dest = tmp_path / "out" / "audio.mp3"
    download_audio("abcdefghijk", dest, lambda *_: None, settings=settings)
    return dest


def test_download_uses_the_updated_copy(fake_ytdlp: Settings, tmp_path: Path) -> None:
    assert _download(fake_ytdlp, tmp_path).read_bytes() == b"mp3"
    argv = json.loads((tmp_path / "argv.json").read_text())
    assert "--cookies" not in argv


def test_download_failure_names_the_cause(
    fake_ytdlp: Settings, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FAKE_YTDLP_ERROR", "Sign in to confirm you’re not a bot")
    with pytest.raises(AudioDownloadError) as caught:
        _download(fake_ytdlp, tmp_path)
    assert caught.value.key == "audio.signIn"

    monkeypatch.setenv("FAKE_YTDLP_ERROR", "Unable to extract initial data")
    with pytest.raises(AudioDownloadError) as caught:
        _download(fake_ytdlp, tmp_path)
    assert caught.value.key == "audio.outdated"


def test_cookies_file_is_copied_and_removed(fake_ytdlp: Settings, tmp_path: Path) -> None:
    jar = tmp_path / "cookies.txt"
    jar.write_text("# Netscape HTTP Cookie File\n")
    jar.chmod(0o400)
    settings = replace(fake_ytdlp, ytdlp_cookies=jar)
    dest = _download(settings, tmp_path)
    argv = json.loads((tmp_path / "argv.json").read_text())
    used = argv[argv.index("--cookies") + 1]
    assert used != str(jar)
    assert (tmp_path / "cookies-seen.txt").read_text() == jar.read_text()
    assert not Path(used).exists()
    assert sorted(path.name for path in dest.parent.iterdir()) == ["audio.mp3"]


def test_missing_cookies_file_is_ignored(fake_ytdlp: Settings, tmp_path: Path) -> None:
    settings = replace(fake_ytdlp, ytdlp_cookies=tmp_path / "nope.txt")
    _download(settings, tmp_path)
    assert "--cookies" not in json.loads((tmp_path / "argv.json").read_text())


def test_meta_reports_ytdlp(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ytdlp_health, "bundled_version", lambda: "2020.01.01")
    with TestClient(create_app(_settings(tmp_path, ytdlp_auto_update=True))) as client:
        info = client.get("/api/meta").json()["ytdlp"]
    assert info["version"] == "2020.01.01"
    assert info["released"] == "2020-01-01"
    assert info["stale"] is True and info["age_days"] > 30
    assert info["auto_update"] is True and info["cookies"] is False


def test_settings_read_ytdlp_options(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FRETBOOK_YTDLP_AUTO_UPDATE", "true")
    monkeypatch.setenv("FRETBOOK_YTDLP_COOKIES", "/run/secrets/cookies.txt")
    settings = Settings.from_env()
    assert settings.ytdlp_auto_update is True
    assert settings.ytdlp_cookies == Path("/run/secrets/cookies.txt")
