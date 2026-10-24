"""The admin dashboard API: storage, orphaned media, the job queue, workers, system info, and the user quota."""

from __future__ import annotations

import os
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from tests.test_oidc import MockProvider, _settings, sign_in  # noqa: F401

from fretbook.app import create_app
from fretbook.storage.media import QuotaExceeded

PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 64


@pytest.fixture
def provider() -> MockProvider:
    return MockProvider()


def _make(tmp_path: Path, provider: MockProvider, **changes):
    return create_app(_settings(tmp_path, **changes), oidc_transport=provider.transport())


def _song(client: TestClient) -> dict:
    return client.post("/api/songs", json={"content_kind": "chords", "title": "S", "chordpro": "[C]Yo"}).json()


def test_dashboard_is_admin_only(tmp_path: Path, provider: MockProvider) -> None:
    with TestClient(_make(tmp_path, provider)) as user:
        sign_in(user, provider, "uma", ["fretbook_users"])
        for method, path in (
            ("get", "/api/admin/storage"),
            ("post", "/api/admin/storage/cleanup"),
            ("get", "/api/admin/jobs"),
            ("post", "/api/admin/jobs/x/retry"),
            ("post", "/api/admin/jobs/x/cancel"),
            ("get", "/api/admin/workers"),
            ("get", "/api/admin/system"),
        ):
            response = getattr(user, method)(path)
            assert response.status_code == 403, path
            assert response.json()["detail"]["key"] == "auth.adminOnly"


def test_storage_counts_media_and_rows_per_user(tmp_path: Path, provider: MockProvider) -> None:
    app = _make(tmp_path, provider, user_quota_mb=5)
    with TestClient(app) as admin:
        sign_in(admin, provider, "ada", ["fretbook_admins"])
        song = _song(admin)
        app.state.ctx.media.save(
            admin.get("/api/me").json()["user_id"],
            song["id"],
            kind="cover",
            filename="c.png",
            content_type="image/png",
            data=PNG,
        )
        report = admin.get("/api/admin/storage").json()
        ada = next(row for row in report["users"] if row["display_name"] == "Ada")
        assert ada["song_count"] == 1 and ada["db_rows"] >= 1
        assert ada["media_files"] == 1 and ada["media_bytes"] == len(PNG)
        assert ada["quota_bytes"] == 5 * 1024 * 1024
        assert report["orphans"] == {"files": 0, "bytes": 0, "empty_dirs": 0}


def test_orphan_cleanup_removes_old_unreferenced_files_only(tmp_path: Path, provider: MockProvider) -> None:
    app = _make(tmp_path, provider)
    media = app.state.ctx.settings.media_dir
    with TestClient(app) as admin:
        sign_in(admin, provider, "ada", ["fretbook_admins"])
        owner = admin.get("/api/me").json()["user_id"]
        song = _song(admin)
        app.state.ctx.media.save(owner, song["id"], kind="cover", filename="c.png", content_type="image/png", data=PNG)
        stray = media / "gone" / "song" / "audio-old.mp3"
        stray.parent.mkdir(parents=True)
        stray.write_bytes(b"x" * 10)
        old = time.time() - 7200
        os.utime(stray, (old, old))
        fresh = media / "gone" / "song" / "audio-new.mp3"
        fresh.write_bytes(b"y" * 5)
        (media / "empty" / "dir").mkdir(parents=True)
        outside = tmp_path / "outside.txt"
        outside.write_text("keep")
        (media / "link.txt").symlink_to(outside)

        assert admin.get("/api/admin/storage").json()["orphans"] == {"files": 1, "bytes": 10, "empty_dirs": 1}
        cleaned = admin.post("/api/admin/storage/cleanup").json()
        assert cleaned["files"] == 1 and cleaned["bytes"] == 10
        assert not stray.exists() and fresh.exists() and outside.exists()
        assert not (media / "empty").exists()
        # The referenced cover survives.
        assert admin.get("/api/admin/storage").json()["orphans"]["files"] == 0
        assert app.state.ctx.media.audio_for(owner, song["id"]) is None
        assert app.state.ctx.media.latest_of_kind(owner, song["id"], "cover") is not None


def test_job_overview_cancel_and_retry(tmp_path: Path, provider: MockProvider) -> None:
    app = _make(tmp_path, provider)
    jobs = app.state.ctx.jobs
    with TestClient(app) as admin, TestClient(app) as user:
        sign_in(admin, provider, "ada", ["fretbook_admins"])
        sign_in(user, provider, "uma", ["fretbook_users"])
        uma = user.get("/api/me").json()["user_id"]
        # No handler is registered for this kind, so nothing claims it.
        queued = jobs.enqueue(uma, "test.unclaimed", {"filename": "tab.gp"})

        overview = admin.get("/api/admin/jobs").json()
        assert overview["counts"] == [{"kind": "test.unclaimed", "status": "queued", "count": 1}]
        row = overview["jobs"][0]
        assert row["id"] == queued and row["owner_name"] == "Uma" and row["label"] == "tab.gp"
        assert "payload" not in row
        assert admin.get("/api/admin/jobs", params={"status": "error"}).json()["jobs"] == []
        assert admin.get("/api/admin/jobs", params={"kind": "other"}).json()["jobs"] == []

        assert admin.post("/api/admin/jobs/nope/cancel").status_code == 404
        assert admin.post(f"/api/admin/jobs/{queued}/retry").json()["detail"]["key"] == "job.notFailed"
        assert admin.post(f"/api/admin/jobs/{queued}/cancel").json() == {"job_id": queued}
        cancelled = jobs.get_any(queued)
        assert cancelled and cancelled["status"] == "error" and cancelled["error_key"] == "job.cancelled"
        again = admin.post(f"/api/admin/jobs/{queued}/cancel")
        assert again.status_code == 400 and again.json()["detail"]["key"] == "job.notQueued"

        assert admin.post(f"/api/admin/jobs/{queued}/retry").status_code == 202
        retried = jobs.get_any(queued)
        assert retried and retried["status"] == "queued" and retried["error_key"] == ""
        assert admin.post("/api/admin/jobs/nope/retry").status_code == 404


def test_retry_reports_an_expired_upload(tmp_path: Path, provider: MockProvider) -> None:
    app = _make(tmp_path, provider)
    jobs = app.state.ctx.jobs
    with TestClient(app) as admin:
        sign_in(admin, provider, "ada", ["fretbook_admins"])
        owner = admin.get("/api/me").json()["user_id"]
        job_id = jobs.enqueue(owner, "test.unclaimed", {"path": str(tmp_path / "missing.zip")})
        jobs.cancel(job_id)
        response = admin.post(f"/api/admin/jobs/{job_id}/retry")
        assert response.status_code == 400 and response.json()["detail"]["key"] == "job.uploadExpired"


def test_workers_and_system_info(tmp_path: Path, provider: MockProvider) -> None:
    app = _make(tmp_path, provider)
    jobs = app.state.ctx.jobs
    with TestClient(app) as admin:
        sign_in(admin, provider, "ada", ["fretbook_admins"])
        assert admin.get("/api/admin/workers").json()["workers"] == []
        jobs.worker_id = "gpu-1"
        jobs.heartbeat(["stems"], host="box", pid=7)
        workers = admin.get("/api/admin/workers").json()
        assert [(w["id"], w["kinds"], w["alive"], w["pid"]) for w in workers["workers"]] == [
            ("gpu-1", ["stems"], True, 7)
        ]
        assert "stems" not in workers["local_kinds"]
        assert jobs.list_workers(ttl=-60)[0]["alive"] is False

        info = admin.get("/api/admin/system").json()
        assert info["schema_version"] >= 18 and info["python_version"].count(".") == 2
        assert info["disk_free_bytes"] > 0 and info["database_bytes"] > 0 and info["user_quota_mb"] == 0
        assert info["version"]


def test_quota_refuses_uploads_over_the_limit(tmp_path: Path, provider: MockProvider) -> None:
    app = _make(tmp_path, provider, user_quota_mb=1)
    media = app.state.ctx.media
    with TestClient(app) as user:
        sign_in(user, provider, "uma", ["fretbook_users"])
        owner = user.get("/api/me").json()["user_id"]
        song = _song(user)
        big = PNG + b"\0" * 700_000
        media.save(owner, song["id"], kind="audio", filename="a.mp3", content_type="audio/mpeg", data=big)
        assert media.usage(owner) == len(big)
        with pytest.raises(QuotaExceeded) as excinfo:
            media.save(owner, song["id"], kind="stem-bass", filename="b.mp3", content_type="audio/mpeg", data=big)
        assert excinfo.value.key == "storage.quotaExceeded"
        assert excinfo.value.params["quota_bytes"] == 1024 * 1024
        assert media.usage(owner) == len(big)
        # Replacing a file of the same kind frees its bytes first.
        media.save(
            owner, song["id"], kind="audio", filename="a.mp3", content_type="audio/mpeg", data=big, replace_kind=True
        )
        assert media.usage(owner) == len(big)

        response = user.post(f"/api/songs/{song['id']}/audio", files={"file": ("x.mp3", b"\0" * 400_000, "audio/mpeg")})
        assert response.status_code == 200, response.text
        full = user.post(
            f"/api/songs/{song['id']}/cover", files={"file": ("c.png", PNG + b"\0" * 700_000, "image/png")}
        )
        assert full.status_code == 413
        assert full.json()["detail"]["key"] == "storage.quotaExceeded"
