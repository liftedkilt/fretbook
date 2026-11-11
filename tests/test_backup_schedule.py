"""Scheduled snapshots: due logic, pruning, failures, demo mode, the config and the admin routes."""

from __future__ import annotations

import time
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from tests.test_oidc import MockProvider, _settings, sign_in  # noqa: F401

from fretbook.app import create_app
from fretbook.backup.schedule import BackupBusy, BackupScheduler
from fretbook.backup.snapshot import PREFIX, list_snapshots
from fretbook.config import Settings
from fretbook.db.migrate import migrate


class Clock:
    def __init__(self, moment: datetime) -> None:
        self.moment = moment

    def __call__(self) -> datetime:
        return self.moment


def _ready(tmp_path: Path, **changes) -> Settings:
    settings = replace(Settings.for_tests(tmp_path / "data"), **changes)
    migrate(settings.database_path, backups_dir=settings.backups_dir)
    return settings


def _folder(dest: Path, moment: datetime) -> Path:
    path = dest / f"{PREFIX}{moment.strftime('%Y%m%dT%H%M%SZ')}"
    path.mkdir(parents=True)
    (path / "fretbook.sqlite").write_bytes(b"x" * 10)
    return path


START = datetime(2026, 3, 1, 12, 0, tzinfo=UTC)


def test_settings_from_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FRETBOOK_DATA_DIR", str(tmp_path))
    settings = Settings.from_env()
    assert (settings.backup_schedule, settings.backup_keep) == ("off", 7)
    assert settings.snapshots_dir == tmp_path / "backups" / "snapshots"
    monkeypatch.setenv("FRETBOOK_BACKUP_SCHEDULE", " Weekly ")
    monkeypatch.setenv("FRETBOOK_BACKUP_DIR", str(tmp_path / "elsewhere"))
    monkeypatch.setenv("FRETBOOK_BACKUP_KEEP", "0")
    settings = Settings.from_env()
    assert (settings.backup_schedule, settings.backup_keep) == ("weekly", 1)
    assert settings.snapshots_dir == tmp_path / "elsewhere"
    monkeypatch.setenv("FRETBOOK_BACKUP_SCHEDULE", "hourly")
    assert Settings.from_env().backup_schedule == "off"


def test_due_logic_follows_the_newest_snapshot_on_disk(tmp_path: Path) -> None:
    settings = _ready(tmp_path, backup_schedule="daily")
    clock = Clock(START)
    scheduler = BackupScheduler(settings, clock=clock, check_seconds=600)
    # Nothing on disk yet: due at once.
    assert scheduler.is_due()
    _folder(settings.snapshots_dir, START)
    assert not scheduler.is_due()
    assert scheduler.next_due() == START + timedelta(days=1)
    clock.moment = START + timedelta(hours=23, minutes=45)
    assert not scheduler.is_due()
    # Within one check of the due time: taken now rather than ten minutes late.
    clock.moment = START + timedelta(hours=23, minutes=55)
    assert scheduler.is_due()
    # A new scheduler (a restart) reads the same folder and agrees.
    clock.moment = START + timedelta(hours=1)
    assert not BackupScheduler(settings, clock=clock, check_seconds=600).is_due()
    weekly = BackupScheduler(replace(settings, backup_schedule="weekly"), clock=Clock(START + timedelta(days=2)))
    assert weekly.next_due() == START + timedelta(days=7)
    assert not weekly.is_due()


def test_off_and_demo_mode_never_run(tmp_path: Path) -> None:
    for settings in (_ready(tmp_path / "off"), _ready(tmp_path / "demo", backup_schedule="daily", demo_mode=True)):
        scheduler = BackupScheduler(settings)
        assert scheduler.interval is None and not scheduler.is_due()
        assert scheduler.check() is None
        scheduler.start()
        assert scheduler._thread is None
        assert scheduler.status()["schedule"] == "off"
        assert not settings.snapshots_dir.exists()


def test_check_takes_a_snapshot_and_keeps_only_keep(tmp_path: Path) -> None:
    settings = _ready(tmp_path, backup_schedule="daily", backup_keep=3)
    for day in range(5):
        _folder(settings.snapshots_dir, datetime(2020, 1, day + 1, tzinfo=UTC))
    pre_migrate = settings.backups_dir / "pre-migrate-1.sqlite"
    pre_migrate.write_bytes(b"old")
    scheduler = BackupScheduler(settings)
    path = scheduler.check()
    assert path is not None and (path / "fretbook.sqlite").is_file()
    snapshots = list_snapshots(settings.snapshots_dir)
    assert len(snapshots) == 3 and snapshots[-1] == path
    assert pre_migrate.read_bytes() == b"old"
    # Just taken, so not due again.
    assert scheduler.check() is None
    status = scheduler.status()
    assert status["last_snapshot"]["path"] == str(path)
    assert status["last_snapshot"]["bytes"] > 0
    assert status["last_error"] is None and status["running"] is False


def test_an_unwritable_directory_is_reported_not_fatal(tmp_path: Path) -> None:
    blocker = tmp_path / "a-file"
    blocker.write_text("not a folder")
    settings = _ready(tmp_path, backup_schedule="daily", backup_snapshot_dir=blocker / "snapshots")
    scheduler = BackupScheduler(settings, clock=Clock(START))
    assert scheduler.check() is None
    status = scheduler.status()
    assert status["last_error"] and status["last_error_at"] == START.isoformat()
    assert status["last_snapshot"] is None
    with pytest.raises(OSError):
        scheduler.run_now()


def test_a_second_run_while_one_is_writing_is_refused(tmp_path: Path) -> None:
    scheduler = BackupScheduler(_ready(tmp_path))
    scheduler._lock.acquire()
    try:
        assert scheduler.status()["running"] is True
        with pytest.raises(BackupBusy):
            scheduler.run_now()
    finally:
        scheduler._lock.release()


def test_the_thread_checks_on_start_and_survives_errors(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    scheduler = BackupScheduler(_ready(tmp_path, backup_schedule="daily"), check_seconds=0.01)
    calls: list[int] = []

    def flaky() -> None:
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("boom")

    monkeypatch.setattr(scheduler, "check", flaky)
    scheduler.start()
    scheduler.start()
    deadline = time.monotonic() + 5
    while len(calls) < 2 and time.monotonic() < deadline:
        time.sleep(0.01)
    scheduler.stop()
    assert len(calls) >= 2


def test_lifespan_takes_the_first_scheduled_snapshot(tmp_path: Path) -> None:
    settings = replace(Settings.for_tests(tmp_path / "data"), backup_schedule="daily")
    with TestClient(create_app(settings)) as client:
        deadline = time.monotonic() + 10
        while not list_snapshots(settings.snapshots_dir) and time.monotonic() < deadline:
            time.sleep(0.05)
        assert len(list_snapshots(settings.snapshots_dir)) == 1
        assert client.app.state.ctx.backups is not None


@pytest.fixture
def provider() -> MockProvider:
    return MockProvider()


def test_admin_routes_are_admin_only(tmp_path: Path, provider: MockProvider) -> None:
    with TestClient(create_app(_settings(tmp_path), oidc_transport=provider.transport())) as user:
        sign_in(user, provider, "uma", ["fretbook_users"])
        for method in ("get", "post"):
            response = getattr(user, method)("/api/admin/backups")
            assert response.status_code == 403
            assert response.json()["detail"]["key"] == "auth.adminOnly"
    with TestClient(create_app(Settings.for_tests(tmp_path / "single"))) as local:
        assert local.get("/api/admin/backups").status_code == 403


def test_admin_status_and_back_up_now(tmp_path: Path, provider: MockProvider) -> None:
    app = create_app(_settings(tmp_path), oidc_transport=provider.transport())
    with TestClient(app) as client:
        sign_in(client, provider, "ada", ["fretbook_admins"])
        status = client.get("/api/admin/backups").json()
        assert status["schedule"] == "off" and status["keep"] == 7
        assert status["last_snapshot"] is None and status["next_due_at"] is None
        response = client.post("/api/admin/backups")
        assert response.status_code == 200
        last = response.json()["last_snapshot"]
        assert Path(last["path"]).parent == app.state.ctx.settings.snapshots_dir
        assert Path(last["path"], "manifest.json").is_file()
        # Without a scheduler on the context, the route makes one.
        app.state.ctx.backups = None
        assert client.get("/api/admin/backups").json()["last_snapshot"]["path"] == last["path"]
        app.state.ctx.backups._lock.acquire()
        try:
            assert client.post("/api/admin/backups").json()["detail"]["key"] == "backupSchedule.busy"
        finally:
            app.state.ctx.backups._lock.release()


def test_back_up_now_reports_a_failure(tmp_path: Path, provider: MockProvider) -> None:
    blocker = tmp_path / "a-file"
    blocker.write_text("x")
    app = create_app(_settings(tmp_path, backup_snapshot_dir=blocker / "s"), oidc_transport=provider.transport())
    with TestClient(app) as client:
        sign_in(client, provider, "ada", ["fretbook_admins"])
        response = client.post("/api/admin/backups")
        assert response.status_code == 500
        detail = response.json()["detail"]
        assert detail["key"] == "backupSchedule.failed" and detail["params"]["reason"]
        assert client.get("/api/admin/backups").json()["last_error"] == detail["params"]["reason"]


def test_back_up_now_is_refused_in_demo_mode(tmp_path: Path, provider: MockProvider) -> None:
    from fretbook.api.backup_schedule_routes import admin_backup_now

    app = create_app(_settings(tmp_path, demo_mode=True), oidc_transport=provider.transport())
    with pytest.raises(Exception) as caught:
        admin_backup_now(app.state.ctx, None)  # type: ignore[arg-type]
    assert caught.value.detail["key"] == "backupSchedule.demoMode"  # type: ignore[attr-defined]
