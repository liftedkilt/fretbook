import sqlite3
import threading
import time
from contextlib import closing
from pathlib import Path

from fastapi.testclient import TestClient

from fretbook.app import create_app
from fretbook.config import Settings
from fretbook.db.migrate import migrate
from fretbook.jobs.registry import register_kinds
from fretbook.jobs.runner import JobRunner
from fretbook.storage.repository import SongRepository
from fretbook.worker import build_runner, run


def _settings(tmp_path: Path, **changes) -> Settings:
    from dataclasses import replace

    settings = replace(Settings.for_tests(tmp_path), **changes)
    migrate(settings.database_path)
    SongRepository(settings).ensure_user("local", "Local")
    return settings


def test_web_never_claims_worker_only_kinds(tmp_path: Path):
    settings = _settings(tmp_path)
    web = JobRunner(settings)
    register_kinds(web)
    job_id = web.enqueue("local", "echo", {"text": "hi"})
    assert "echo" not in web.local_kinds()
    assert web.run_once() is False
    assert web.get("local", job_id)["status"] == "queued"

    worker = build_runner(settings, "w1")
    assert worker.run_once(["echo"]) is True
    job = web.get("local", job_id)
    assert job["status"] == "done"
    assert job["result"] == {"echo": {"text": "hi"}, "worker_id": "w1"}
    assert job["progress_key"] == "job.echo"


def test_settings_can_reserve_a_kind_for_the_worker(tmp_path: Path):
    settings = _settings(tmp_path, worker_kinds=("import.file",))
    web = JobRunner(settings)
    web.register("import.file", lambda job, progress: {})
    web.register("import.url", lambda job, progress: {})
    assert web.local_kinds() == ["import.url"]


def test_two_claimers_never_claim_the_same_job(tmp_path: Path):
    settings = _settings(tmp_path)
    seen: list[str] = []
    lock = threading.Lock()

    def handler(job, progress):
        with lock:
            seen.append(job["id"])
        return {}

    runners = [JobRunner(settings, worker_id=f"w{i}") for i in range(4)]
    for runner in runners:
        runner.register("work", handler)
    ids = {runners[0].enqueue("local", "work", {"n": n}) for n in range(40)}

    def drain(runner: JobRunner) -> None:
        while runner.run_once(["work"]):
            pass

    threads = [threading.Thread(target=drain, args=(r,)) for r in runners]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(seen) == sorted(ids)
    with closing(sqlite3.connect(settings.database_path)) as conn:
        rows = conn.execute("SELECT status, attempts, worker_id FROM jobs").fetchall()
    assert {r[0] for r in rows} == {"done"}
    assert {r[1] for r in rows} == {1}
    assert {r[2] for r in rows} <= {"w0", "w1", "w2", "w3"}


def test_recover_only_touches_own_kinds(tmp_path: Path):
    settings = _settings(tmp_path)
    runner = JobRunner(settings)
    runner.register("web", lambda job, progress: {})
    register_kinds(runner, worker=True)
    mine = runner.enqueue("local", "web", {})
    theirs = runner.enqueue("local", "echo", {})
    with closing(sqlite3.connect(settings.database_path)) as conn:
        conn.execute("UPDATE jobs SET status = 'running', attempts = 1")
        conn.commit()
    assert runner.recover() == 1
    assert runner.get("local", mine)["status"] == "queued"
    assert runner.get("local", theirs)["status"] == "running"
    assert runner.recover(["echo"]) == 1


def test_worker_heartbeat_reports_live_kinds(tmp_path: Path):
    settings = _settings(tmp_path)
    runner = JobRunner(settings, worker_id="w1")
    assert runner.live_worker_kinds() == []
    runner.heartbeat(["echo", "stems"])
    assert runner.live_worker_kinds() == ["echo", "stems"]
    with closing(sqlite3.connect(settings.database_path)) as conn:
        conn.execute("UPDATE workers SET heartbeat_at = '2000-01-01T00:00:00+00:00'")
        conn.commit()
    assert runner.live_worker_kinds() == []
    runner.heartbeat(["echo"])
    runner.forget_worker()
    assert runner.live_worker_kinds() == []


def test_worker_loop_runs_echo_and_meta_reports_it(tmp_path: Path):
    settings = _settings(tmp_path)
    with TestClient(create_app(settings)) as client:
        assert client.get("/api/meta").json()["worker_kinds"] == []
        job_id = client.app.state.ctx.jobs.enqueue("local", "echo", {"text": "hi"})
        time.sleep(1)  # the web job thread polls every 0.4 s
        assert client.get(f"/api/jobs/{job_id}").json()["status"] == "queued"

        stop = threading.Event()
        worker = build_runner(settings, "w1")
        thread = threading.Thread(target=run, args=(worker, ["echo"], stop), kwargs={"heartbeat_seconds": 0.1})
        thread.start()
        try:
            deadline = time.time() + 10
            while time.time() < deadline and client.get(f"/api/jobs/{job_id}").json()["status"] != "done":
                time.sleep(0.1)
            body = client.get(f"/api/jobs/{job_id}").json()
            assert body["status"] == "done"
            assert "worker_id" not in body
            assert client.get("/api/meta").json()["worker_kinds"] == ["echo"]
        finally:
            stop.set()
            thread.join(timeout=5)
        assert client.get("/api/meta").json()["worker_kinds"] == []
