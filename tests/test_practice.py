"""Practice log: recording, validation, ownership, the dashboard numbers, and the backup round trip."""

import io
import json
import sqlite3
import time
import zipfile
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fretbook.app import create_app
from fretbook.config import Settings
from fretbook.storage.practice import ExerciseInput, PracticeRepository, SessionInput, UnknownSong, streaks

SHEET = "{title: Hello}\n[G]Hello [C]friend\n"


@pytest.fixture
def client(tmp_path: Path):
    with TestClient(create_app(replace(Settings.for_tests(tmp_path / "a")))) as started:
        yield started


def _song(client: TestClient, title: str) -> str:
    return client.post("/api/songs", json={"content_kind": "chords", "title": title, "chordpro": SHEET}).json()["id"]


def _day(offset: int = 0) -> str:
    return (datetime.now(UTC).date() + timedelta(days=offset)).isoformat()


def _log(client: TestClient, song_id: str, seconds: int = 600, offset: int = 0, **extra):
    day = _day(offset)
    body = {"song_id": song_id, "day": day, "duration_seconds": seconds, "started_at": f"{day}T12:00:00+00:00", **extra}
    return client.post("/api/practice/sessions", json=body)


def test_record_and_read_back_a_session(client: TestClient) -> None:
    song = _song(client, "Alpha")
    created = _log(client, song, 125, speed=0.8, mode="wait", loop_name="Riff", loop_start=2, loop_end=5, track_id="t1")
    assert created.status_code == 201
    session = created.json()
    assert (session["song_id"], session["duration_seconds"], session["speed"], session["mode"]) == (
        song,
        125,
        0.8,
        "wait",
    )
    assert (session["loop_name"], session["loop_start"], session["loop_end"], session["score"]) == ("Riff", 2, 5, None)

    history = client.get(f"/api/songs/{song}/practice").json()
    assert (history["session_count"], history["total_seconds"], history["best_speed"]) == (1, 125, 0.8)
    assert [item["id"] for item in history["sessions"]] == [session["id"]]


def test_only_a_wait_session_can_be_completed(client: TestClient) -> None:
    song = _song(client, "Alpha")
    assert _log(client, song, mode="wait").json()["completed"] is False
    assert _log(client, song, mode="wait", completed=True).json()["completed"] is True
    assert _log(client, song, mode="scored", score=90, completed=True).json()["completed"] is False
    assert _log(client, song, completed=True).json()["completed"] is False
    flags = [item["completed"] for item in client.get(f"/api/songs/{song}/practice").json()["sessions"]]
    assert sorted(flags) == [False, False, False, True]


def test_a_score_only_counts_for_scored_sessions(client: TestClient) -> None:
    song = _song(client, "Alpha")
    assert _log(client, song, mode="free", score=90).json()["score"] is None
    assert _log(client, song, mode="scored", score=87.5).json()["score"] == 87.5
    assert client.get(f"/api/songs/{song}/practice").json()["best_score"] == 87.5


@pytest.mark.parametrize(
    "extra",
    [
        {"duration_seconds": 0},
        {"duration_seconds": 7 * 3600},
        {"speed": 0},
        {"speed": 9},
        {"mode": "nope"},
        {"score": 101, "mode": "scored"},
        {"loop_start": -1},
        {"day": "yesterday"},
        {"day": "2026-13-45"},
        {"day": "2001-01-01"},
        {"day": _day(30)},
    ],
)
def test_bad_sessions_are_refused(client: TestClient, extra: dict) -> None:
    song = _song(client, "Alpha")
    body = {"song_id": song, "day": _day(), "duration_seconds": 60, **extra}
    assert client.post("/api/practice/sessions", json=body).status_code in {400, 422}


def test_a_day_the_player_is_in_but_the_server_is_not_is_accepted(client: TestClient) -> None:
    song = _song(client, "Alpha")
    assert _log(client, song, offset=1).status_code == 201
    assert _log(client, song, offset=-1).status_code == 201


def test_sessions_need_a_song_the_caller_has(client: TestClient) -> None:
    assert _log(client, "nope").json()["detail"]["key"] == "song.notFound"
    assert client.get("/api/songs/nope/practice").status_code == 404


def test_sessions_are_private_to_their_owner(tmp_path: Path) -> None:
    settings = Settings.for_tests(tmp_path / "multi")
    with TestClient(create_app(settings)) as first:
        song = _song(first, "Mine")
        _log(first, song)
        assert first.get("/api/practice/stats").json()["songs_practised"] == 1
    # Another principal has none of it and cannot log against the song.
    repo = PracticeRepository(settings)
    with pytest.raises(UnknownSong):
        repo.record("someone-else", SessionInput(song_id=song, day=_day(), duration_seconds=60))
    assert repo.song_history("someone-else", song) is None
    assert repo.stats("someone-else", date.fromisoformat(_day()))["songs_practised"] == 0


def test_deleting_a_song_removes_its_sessions(client: TestClient) -> None:
    song = _song(client, "Gone")
    _log(client, song)
    assert client.delete(f"/api/songs/{song}").status_code == 204
    stats = client.get("/api/practice/stats").json()
    assert (stats["songs_practised"], stats["total_seconds"], stats["heatmap"]) == (0, 0, [])


def test_goal_defaults_updates_and_clamps(client: TestClient) -> None:
    assert client.get("/api/practice/goal").json() == {"daily_minutes": 15, "weekly_summary": True}
    updated = client.put("/api/practice/goal", json={"daily_minutes": 30, "weekly_summary": False})
    assert updated.json() == {"daily_minutes": 30, "weekly_summary": False}
    assert client.get("/api/practice/goal").json()["daily_minutes"] == 30
    assert client.put("/api/practice/goal", json={"daily_minutes": 100000}).status_code == 422
    assert client.put("/api/practice/goal", json={"daily_minutes": 0}).json()["daily_minutes"] == 0


def test_dashboard_numbers(client: TestClient) -> None:
    alpha, bravo, old = _song(client, "Alpha"), _song(client, "Bravo"), _song(client, "Old")
    client.put("/api/practice/goal", json={"daily_minutes": 10})
    _log(client, alpha, 600, offset=0, mode="scored", score=70)
    _log(client, alpha, 300, offset=0, mode="scored", score=95)
    _log(client, bravo, 1200, offset=-1)
    # The API only takes the player's current day; older sessions come from the log itself (a restored backup).
    repo, owner = PracticeRepository(client.app.state.ctx.settings), _owner(client)
    repo.record(
        owner, SessionInput(song_id=alpha, day=_day(-2), duration_seconds=60, started_at=f"{_day(-2)}T12:00:00+00:00")
    )
    repo.record(
        owner, SessionInput(song_id=old, day=_day(-5), duration_seconds=60, started_at=f"{_day(-5)}T12:00:00+00:00")
    )  # a gap before the run
    stats = client.get("/api/practice/stats", params={"today": _day()}).json()

    assert stats["today"] == _day()
    assert stats["today_seconds"] == 900
    assert stats["total_seconds"] == 900 + 1200 + 60 + 60
    assert stats["current_streak"] == 3 and stats["longest_streak"] == 3
    assert stats["songs_practised"] == 3
    assert [(row["day"], row["seconds"], row["sessions"]) for row in stats["heatmap"]] == [
        (_day(-5), 60, 1),
        (_day(-2), 60, 1),
        (_day(-1), 1200, 1),
        (_day(0), 900, 2),
    ]
    assert stats["week"]["seconds"] == 2220 and stats["week"]["days_practised"] == 4
    assert stats["week"]["goal_days"] == 2  # yesterday (20 min) and today (15 min) reached 10 minutes
    assert [row["title"] for row in stats["recent"]][0] == "Alpha"
    assert [(row["title"], row["best_score"]) for row in stats["best_scores"]] == [("Alpha", 95)]
    assert stats["stale"] == []


def test_stale_songs_are_the_ones_not_played_for_two_weeks(client: TestClient) -> None:
    song = _song(client, "Dusty")
    _log(client, song, offset=0)
    # Judge from a month on: the song was last practised well over two weeks before.
    later = (datetime.now(UTC).date() + timedelta(days=30)).isoformat()
    repo = PracticeRepository(client.app.state.ctx.settings)
    stats = repo.stats(_owner(client), date.fromisoformat(later))
    assert [row["title"] for row in stats["stale"]] == ["Dusty"]
    assert stats["current_streak"] == 0 and stats["longest_streak"] == 1


def _owner(client: TestClient) -> str:
    conn = sqlite3.connect(client.app.state.ctx.settings.database_path)
    try:
        return conn.execute("SELECT owner_id FROM songs LIMIT 1").fetchone()[0]
    finally:
        conn.close()


def test_streak_rules() -> None:
    today = date(2026, 3, 10)
    days = lambda *offsets: {(today + timedelta(days=n)).isoformat() for n in offsets}  # noqa: E731
    assert streaks(set(), today) == (0, 0)
    assert streaks(days(0), today) == (1, 1)
    # Not practised yet today: the run still counts until the day is over.
    assert streaks(days(-1, -2, -3), today) == (3, 3)
    # A missed whole day breaks it.
    assert streaks(days(-2, -3), today) == (0, 2)
    assert streaks(days(0, -1, -3, -4, -5, -6), today) == (2, 4)


def test_stats_refuse_a_bad_today(client: TestClient) -> None:
    assert client.get("/api/practice/stats", params={"today": "tomorrow"}).status_code == 400


def _restore(client: TestClient, archive: bytes, mode: str = "skip") -> dict:
    response = client.post(
        "/api/library/import", files={"file": ("lib.zip", archive, "application/zip")}, data={"mode": mode}
    )
    assert response.status_code == 202, response.text
    job_id = response.json()["job_id"]
    client.app.state.ctx.jobs.run_once()
    for _ in range(50):
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in {"done", "error"}:
            return job
        time.sleep(0.1)
    raise AssertionError("restore did not finish")


def test_backup_round_trip_keeps_the_practice_log(tmp_path: Path) -> None:
    with TestClient(create_app(Settings.for_tests(tmp_path / "src"))) as source:
        alpha = _song(source, "Alpha")
        _log(source, alpha, 300, mode="scored", score=80, speed=0.9, loop_name="Riff")
        _log(source, alpha, 120, offset=-1)
        _log(source, alpha, 90, mode="wait", completed=True)
        source.put("/api/practice/goal", json={"daily_minutes": 25, "weekly_summary": False})
        archive = source.get("/api/library/export").content
        with zipfile.ZipFile(io.BytesIO(archive)) as zf:
            manifest = json.loads(zf.read("manifest.json"))
        assert manifest["format_version"] == 1
        assert len(manifest["practice"]["sessions"]) == 3
        assert [item["completed"] for item in manifest["practice"]["sessions"]].count(True) == 1
        assert manifest["practice"]["goal"] == {"daily_minutes": 25, "weekly_summary": False}
        expected = source.get(f"/api/songs/{alpha}/practice").json()

        with TestClient(create_app(Settings.for_tests(tmp_path / "dst"))) as target:
            job = _restore(target, archive)
            assert job["status"] == "done", job
            assert job["result"]["practice_sessions"] == 3
            assert target.get("/api/practice/goal").json() == {"daily_minutes": 25, "weekly_summary": False}
            restored = target.get(f"/api/songs/{alpha}/practice").json()
            assert restored == expected

            # The same archive again adds nothing.
            again = _restore(target, archive)
            assert again["result"]["practice_sessions"] == 0
            assert target.get(f"/api/songs/{alpha}/practice").json()["session_count"] == 3


def test_a_session_in_an_older_archive_restores_as_not_completed() -> None:
    from fretbook.backup.restore import _PracticeSession

    session = {"id": "old1", "song_id": "s", "day": "2026-01-01", "duration_seconds": 60, "mode": "wait"}
    assert _PracticeSession.model_validate(session).completed is False


def test_restore_drops_sessions_for_songs_that_did_not_come_back_and_bad_ones(tmp_path: Path) -> None:
    with TestClient(create_app(Settings.for_tests(tmp_path / "src"))) as source:
        alpha = _song(source, "Alpha")
        _log(source, alpha, 60)
        archive = source.get("/api/library/export").content
    with zipfile.ZipFile(io.BytesIO(archive)) as zf:
        members = {name: zf.read(name) for name in zf.namelist()}
    manifest = json.loads(members["manifest.json"])
    good = manifest["practice"]["sessions"][0]
    manifest["practice"]["sessions"] = [
        good,
        {**good, "id": "ghost", "song_id": "zzzzzzzz"},
        {**good, "id": "baddur", "duration_seconds": -4},
        {**good, "id": "badday", "day": "soon"},
        "not even an object",
    ]
    members["manifest.json"] = json.dumps(manifest).encode()
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as zf:
        for name, data in members.items():
            zf.writestr(name, data)
    with TestClient(create_app(Settings.for_tests(tmp_path / "dst"))) as target:
        job = _restore(target, out.getvalue())
        assert job["status"] == "done", job
        assert job["result"]["practice_sessions"] == 1
        assert [w["key"] for w in job["result"]["warnings"]] == ["backup.practiceDropped"]
        assert job["result"]["warnings"][0]["params"] == {"count": 4}


def test_an_archive_from_before_the_practice_log_still_restores(tmp_path: Path) -> None:
    with TestClient(create_app(Settings.for_tests(tmp_path / "src"))) as source:
        _song(source, "Alpha")
        archive = source.get("/api/library/export").content
    with zipfile.ZipFile(io.BytesIO(archive)) as zf:
        members = {name: zf.read(name) for name in zf.namelist()}
    manifest = json.loads(members["manifest.json"])
    del manifest["practice"]
    members["manifest.json"] = json.dumps(manifest).encode()
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as zf:
        for name, data in members.items():
            zf.writestr(name, data)
    with TestClient(create_app(Settings.for_tests(tmp_path / "dst"))) as target:
        job = _restore(target, out.getvalue())
        assert job["status"] == "done" and job["result"]["practice_sessions"] == 0


def test_adopting_the_local_library_moves_its_practice_log(tmp_path: Path) -> None:
    settings = Settings.for_tests(tmp_path / "adopt")
    with TestClient(create_app(settings)) as client:
        song = _song(client, "Local")
        _log(client, song, 120)
        client.put("/api/practice/goal", json={"daily_minutes": 40})
        ctx = client.app.state.ctx
        ctx.songs.ensure_user("ann", "Ann")
        ctx.users.adopt_local("ann")
        repo = PracticeRepository(settings)
        assert repo.song_history("local", song) is None
        history = repo.song_history("ann", song)
        assert history is not None and history["total_seconds"] == 120
        assert repo.get_goal("ann")["daily_minutes"] == 40
        today = date.fromisoformat(_day())
        assert repo.stats("ann", today)["songs_practised"] == 1
        assert repo.stats("local", today)["songs_practised"] == 0


def test_adopting_keeps_a_goal_the_user_already_set(tmp_path: Path) -> None:
    settings = Settings.for_tests(tmp_path / "adopt-goal")
    with TestClient(create_app(settings)) as client:
        client.put("/api/practice/goal", json={"daily_minutes": 40})
        ctx = client.app.state.ctx
        ctx.songs.ensure_user("ann", "Ann")
        repo = PracticeRepository(settings)
        repo.set_goal("ann", 5, True)
        ctx.users.adopt_local("ann")
        assert repo.get_goal("ann")["daily_minutes"] == 5


def test_restoring_a_session_id_another_user_holds_gives_it_a_new_id(tmp_path: Path) -> None:
    settings = Settings.for_tests(tmp_path / "ids")
    with TestClient(create_app(settings)) as client:
        song = _song(client, "Mine")
        ctx = client.app.state.ctx
        ctx.songs.ensure_user("ann", "Ann")
        ann_song = ctx.songs.create_song(
            "ann", title="Hers", artist="", source_kind="manual", source_ref={}, chordpro=SHEET
        )["id"]
        repo = PracticeRepository(settings)
        mine = SessionInput(song_id=song, day=_day(), duration_seconds=60, id="shared-id")
        hers = SessionInput(song_id=ann_song, day=_day(), duration_seconds=90, id="shared-id")
        assert repo.restore_session("local", mine) is True
        # Same owner, same id: the same session, skipped.
        assert repo.restore_session("local", mine) is False
        # Another owner's session that happens to share the id is kept under a new one.
        assert repo.restore_session("ann", hers) is True
        history = repo.song_history("ann", ann_song)
        assert history is not None and history["session_count"] == 1
        assert history["sessions"][0]["id"] != "shared-id"
        local = repo.song_history("local", song)
        assert local is not None and [item["id"] for item in local["sessions"]] == ["shared-id"]


def test_dashboard_titles_only_come_from_the_owners_own_songs(tmp_path: Path) -> None:
    settings = Settings.for_tests(tmp_path / "join")
    with TestClient(create_app(settings)) as client:
        song = _song(client, "Mine")
        _log(client, song)
        # A session row whose owner no longer matches its song's owner adds nothing to that owner's dashboard.
        conn = sqlite3.connect(settings.database_path)
        try:
            conn.execute(
                "INSERT INTO users (id, display_name, created_at) VALUES ('bob', 'Bob', '2026-01-01T00:00:00Z')"
            )
            conn.execute("UPDATE songs SET owner_id = 'bob' WHERE id = ?", (song,))
            conn.commit()
        finally:
            conn.close()
        stats = PracticeRepository(settings).stats("local", date.fromisoformat(_day()))
        assert stats["songs_practised"] == 0 and stats["recent"] == []


def _exercise(client: TestClient, offset: int = 0, **extra):
    body = {"kind": "interval", "day": _day(offset), "duration_seconds": 120, "rounds": 10, "correct": 8, "score": 80}
    return client.post("/api/practice/exercises", json={**body, **extra})


def test_record_a_trainer_round(client: TestClient) -> None:
    created = _exercise(client)
    assert created.status_code == 201
    row = created.json()
    assert (row["kind"], row["duration_seconds"], row["rounds"], row["correct"], row["score"]) == (
        "interval",
        120,
        10,
        8,
        80,
    )


def test_trainer_rounds_are_validated(client: TestClient) -> None:
    assert _exercise(client, kind="nope").status_code == 422
    assert _exercise(client, duration_seconds=0).status_code == 422
    assert _exercise(client, score=101).status_code == 422
    assert _exercise(client, offset=30).status_code == 400


def test_trainer_time_counts_toward_the_day_streak_and_goal(client: TestClient) -> None:
    client.put("/api/practice/goal", json={"daily_minutes": 4, "weekly_summary": True})
    _exercise(client, offset=-1, kind="fretboard", score=50)
    _exercise(client, kind="chord", duration_seconds=240, score=90)
    _exercise(client, kind="chord", duration_seconds=60, score=70)
    stats = client.get("/api/practice/stats", params={"today": _day()}).json()
    assert stats["today_seconds"] == 300
    assert stats["current_streak"] == 2
    assert stats["total_seconds"] == 420
    assert stats["week"]["goal_days"] == 1
    assert stats["songs_practised"] == 0
    by_kind = {item["kind"]: item for item in stats["exercises"]}
    assert by_kind["chord"]["session_count"] == 2
    assert by_kind["chord"]["best_score"] == 90
    assert by_kind["fretboard"]["total_seconds"] == 120


def test_trainer_time_adds_to_song_time(client: TestClient) -> None:
    song = _song(client, "Alpha")
    _log(client, song, 600)
    _exercise(client)
    stats = client.get("/api/practice/stats", params={"today": _day()}).json()
    assert stats["today_seconds"] == 720
    assert stats["heatmap"][-1]["sessions"] == 2


def _rewrite_manifest(archive: bytes, change) -> bytes:
    with zipfile.ZipFile(io.BytesIO(archive)) as zf:
        members = {name: zf.read(name) for name in zf.namelist()}
    manifest = json.loads(members["manifest.json"])
    change(manifest)
    members["manifest.json"] = json.dumps(manifest).encode()
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as zf:
        for name, data in members.items():
            zf.writestr(name, data)
    return out.getvalue()


def test_backup_round_trip_keeps_trainer_games(tmp_path: Path) -> None:
    with TestClient(create_app(Settings.for_tests(tmp_path / "src"))) as source:
        _exercise(source, kind="fretboard", rounds=20, correct=15, score=75)
        _exercise(source, offset=-2, kind="chord", duration_seconds=300)
        expected = source.get(f"/api/practice/stats?today={_day()}").json()["exercises"]
        archive = source.get("/api/library/export").content
        with zipfile.ZipFile(io.BytesIO(archive)) as zf:
            manifest = json.loads(zf.read("manifest.json"))
        assert sorted(item["kind"] for item in manifest["practice"]["exercises"]) == ["chord", "fretboard"]

        with TestClient(create_app(Settings.for_tests(tmp_path / "dst"))) as target:
            job = _restore(target, archive)
            assert job["status"] == "done", job
            assert job["result"]["practice_exercises"] == 2
            assert target.get(f"/api/practice/stats?today={_day()}").json()["exercises"] == expected

            again = _restore(target, archive)
            assert again["result"]["practice_exercises"] == 0
            assert (
                sum(
                    item["session_count"]
                    for item in target.get(f"/api/practice/stats?today={_day()}").json()["exercises"]
                )
                == 2
            )


def test_restore_drops_bad_trainer_games_and_gives_a_fresh_id_when_another_user_holds_it(tmp_path: Path) -> None:
    with TestClient(create_app(Settings.for_tests(tmp_path / "src"))) as source:
        _exercise(source)
        archive = source.get("/api/library/export").content
    good = json.loads(zipfile.ZipFile(io.BytesIO(archive)).read("manifest.json"))["practice"]["exercises"][0]

    def change(manifest: dict) -> None:
        manifest["practice"]["exercises"] = [
            good,
            {**good, "id": "badkind", "kind": "drums"},
            {**good, "id": "baddur", "duration_seconds": 0},
            {**good, "id": "badday", "day": "soon"},
            "not even an object",
        ]

    with TestClient(create_app(Settings.for_tests(tmp_path / "dst"))) as target:
        job = _restore(target, _rewrite_manifest(archive, change))
        assert job["status"] == "done", job
        assert job["result"]["practice_exercises"] == 1
        assert [w["key"] for w in job["result"]["warnings"]] == ["backup.exercisesDropped"]
        assert job["result"]["warnings"][0]["params"] == {"count": 4}


def test_restoring_a_trainer_game_id_another_user_holds_gives_it_a_new_id(tmp_path: Path) -> None:
    settings = Settings.for_tests(tmp_path / "ids")
    with TestClient(create_app(settings)) as client:
        client.app.state.ctx.songs.ensure_user("ann", "Ann")
        repo = PracticeRepository(settings)
        item = ExerciseInput(kind="chord", day=_day(), duration_seconds=60, id="shared-id")
        assert repo.restore_exercise("local", item) is True
        assert repo.restore_exercise("local", item) is False  # same owner, same game
        assert repo.restore_exercise("ann", item) is True  # another owner's game keeps a new id
        ids = {owner: repo.export_all(owner)["exercises"][0]["id"] for owner in ("local", "ann")}
        assert ids["local"] == "shared-id" and ids["ann"] != "shared-id"


def test_an_archive_without_trainer_games_still_restores(tmp_path: Path) -> None:
    with TestClient(create_app(Settings.for_tests(tmp_path / "src"))) as source:
        _song(source, "Alpha")
        archive = source.get("/api/library/export").content
    old = _rewrite_manifest(archive, lambda manifest: manifest["practice"].pop("exercises"))
    with TestClient(create_app(Settings.for_tests(tmp_path / "dst"))) as target:
        job = _restore(target, old)
        assert job["status"] == "done" and job["result"]["practice_exercises"] == 0


def test_record_a_rhythm_run(client: TestClient) -> None:
    created = _exercise(
        client, kind="rhythm", rounds=16, correct=14, score=87.5, pattern="eighths", bpm=90, mean_error_ms=-12.5
    )
    assert created.status_code == 201
    row = created.json()
    assert (row["kind"], row["pattern"], row["bpm"], row["mean_error_ms"]) == ("rhythm", "eighths", 90, -12.5)
    stats = client.get(f"/api/practice/stats?today={_day()}").json()
    assert [item["kind"] for item in stats["exercises"]] == ["rhythm"]
    assert _exercise(client, kind="rhythm", bpm=0).status_code == 422
    assert _exercise(client, kind="rhythm", mean_error_ms=99999).status_code == 422
    assert _exercise(client).json()["pattern"] is None


def test_backup_round_trip_keeps_rhythm_runs(tmp_path: Path) -> None:
    with TestClient(create_app(Settings.for_tests(tmp_path / "src"))) as source:
        _exercise(source, kind="rhythm", rounds=8, correct=7, score=87.5, pattern="gallop", bpm=70, mean_error_ms=9.5)
        archive = source.get("/api/library/export").content
        with zipfile.ZipFile(io.BytesIO(archive)) as zf:
            manifest = json.loads(zf.read("manifest.json"))
        (run,) = manifest["practice"]["exercises"]
        assert (run["pattern"], run["bpm"], run["mean_error_ms"]) == ("gallop", 70, 9.5)

        with TestClient(create_app(Settings.for_tests(tmp_path / "dst"))) as target:
            job = _restore(target, archive)
            assert job["result"]["practice_exercises"] == 1
            again = target.get("/api/library/export").content
            with zipfile.ZipFile(io.BytesIO(again)) as zf:
                (kept,) = json.loads(zf.read("manifest.json"))["practice"]["exercises"]
            assert (kept["pattern"], kept["bpm"], kept["mean_error_ms"]) == ("gallop", 70, 9.5)


def test_stats_list_recent_rhythm_runs_with_song_titles(client: TestClient) -> None:
    song_id = _song(client, "My Own Riff")
    _exercise(client, kind="rhythm", rounds=8, correct=8, score=100, pattern="eighths", bpm=80, mean_error_ms=4.0)
    _exercise(client, kind="rhythm", rounds=8, correct=6, score=75, pattern=f"song:{song_id}:3", bpm=90)
    _exercise(client, kind="rhythm", rounds=8, correct=6, score=75, pattern="song:gone:5", bpm=90)
    _exercise(client, kind="chord", rounds=5, correct=5, score=100)
    runs = client.get(f"/api/practice/stats?today={_day()}").json()["rhythm_runs"]
    assert len(runs) == 3
    by_pattern = {run["pattern"]: run for run in runs}
    assert by_pattern["eighths"]["song_title"] is None
    assert by_pattern[f"song:{song_id}:3"]["song_title"] == "My Own Riff"
    assert by_pattern[f"song:{song_id}:3"]["bar"] == 3
    assert by_pattern["song:gone:5"]["song_title"] is None and by_pattern["song:gone:5"]["bar"] == 5
    assert by_pattern["eighths"]["mean_error_ms"] == 4.0


def test_stats_count_songs_practised_this_month(tmp_path: Path) -> None:
    settings = Settings.for_tests(tmp_path / "month")
    with TestClient(create_app(settings)) as client:
        alpha, beta, old = _song(client, "Alpha"), _song(client, "Beta"), _song(client, "Old")
    repo = PracticeRepository(settings)
    today = datetime.now(UTC).date()
    month_start = today.replace(day=1)
    previous = month_start - timedelta(days=1)
    for song, day in [(alpha, month_start), (alpha, today), (beta, today), (old, previous)]:
        repo.record("local", SessionInput(song_id=song, day=day.isoformat(), duration_seconds=60))
    stats = repo.stats("local", today)
    assert stats["songs_practised"] == 3
    assert stats["songs_this_month"] == 2
    # Looking back from last month does not count this month's sessions.
    assert repo.stats("local", previous)["songs_this_month"] == 1


def test_stats_report_the_last_lesson_opened(client: TestClient) -> None:
    assert client.get("/api/practice/stats").json()["last_lesson"] is None
    settings = client.app.state.ctx.settings
    from fretbook.storage.lessons import LessonProgressRepository

    lessons = LessonProgressRepository(settings)
    lessons.opened("local", "basics", "one")
    time.sleep(1.1)
    lessons.opened("local", "basics", "two")
    last = client.get("/api/practice/stats").json()["last_lesson"]
    assert (last["course_id"], last["lesson_id"]) == ("basics", "two")
    assert last["opened_at"]
