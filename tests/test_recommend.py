"""Practice recommendations: the stretch level, weak loops, spaced review, and the endpoint."""

from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fretbook import recommend
from fretbook.app import create_app
from fretbook.config import Settings
from fretbook.storage.practice import PracticeRepository, SessionInput

TODAY = date(2026, 6, 30)


def _ago(days: int) -> str:
    return (TODAY - timedelta(days=days)).isoformat()


def _song(song_id: str, difficulty: float | None, *, sessions: int = 0, days: int = 0, last: int | None = None):
    return {
        "song_id": song_id,
        "title": song_id.title(),
        "artist": "",
        "content_kind": "tab" if difficulty is not None else "chords",
        "difficulty": difficulty,
        "session_count": sessions,
        "practice_days": days,
        "last_day": None if last is None else _ago(last),
    }


def _scored(song_id: str, score: float, ago: int = 1, loop: tuple[str, int, int] | None = None):
    name, start, end = loop or ("", None, None)
    return {
        "song_id": song_id,
        "loop_name": name,
        "loop_start": start,
        "loop_end": end,
        "day": _ago(ago),
        "score": score,
    }


@pytest.mark.parametrize(("days", "interval"), [(0, 1), (1, 1), (2, 2), (3, 4), (4, 8), (6, 32), (7, 60), (30, 60)])
def test_the_review_gap_doubles_per_practice_day_up_to_a_cap(days: int, interval: int) -> None:
    assert recommend.review_interval(days) == interval


def test_the_level_is_the_median_of_well_scored_songs() -> None:
    songs = [_song("a", 3.0, sessions=2, days=2, last=1), _song("b", 5.0, sessions=2, days=2, last=2)]
    songs.append(_song("c", 9.0, sessions=1, days=1, last=3))
    songs.append(_song("next", 6.0))
    scored = [_scored("a", 90), _scored("b", 85), _scored("b", 95), _scored("c", 40)]
    result = recommend.build(songs, scored, TODAY)
    assert (result["level"], result["level_basis"]) == (4.0, "scored")


def test_a_song_scored_before_the_window_does_not_set_the_level() -> None:
    songs = [_song("a", 8.0, sessions=2, days=2, last=45), _song("b", 4.0, sessions=1, days=1, last=3)]
    result = recommend.build(songs, [_scored("a", 95, ago=45)], TODAY)
    assert (result["level"], result["level_basis"]) == (4.0, "practised")


def test_stretch_songs_are_a_little_above_the_level_and_barely_played() -> None:
    songs = [
        _song("known", 5.0, sessions=3, days=3, last=2),
        _song("near", 5.5),
        _song("far", 7.0),
        _song("easy", 3.0),
        _song("top", 6.5),
        _song("worn", 6.0, sessions=5, days=4, last=60),
        _song("sheet", None),
        _song("fresh", 5.8, sessions=1, days=1, last=2),
    ]
    result = recommend.build(songs, [_scored("known", 90)], TODAY)
    assert [item["song_id"] for item in result["stretch"]] == ["near", "top"]
    assert result["stretch"][0]["difficulty"] == 5.5


def test_with_nothing_to_go_on_the_easiest_tabs_are_suggested() -> None:
    songs = [_song("hard", 8.0), _song("easy", 1.5), _song("easier", 1.0), _song("mid", 3.5), _song("sheet", None)]
    result = recommend.build(songs, [], TODAY)
    assert (result["level"], result["level_basis"]) == (None, "none")
    assert [item["song_id"] for item in result["stretch"]] == ["easier", "easy"]


def test_weak_loops_are_the_ones_whose_latest_attempt_scored_low() -> None:
    songs = [_song("a", 4.0, sessions=4, days=3, last=1)]
    scored = [
        _scored("a", 82, ago=1, loop=("Solo", 4, 8)),
        _scored("a", 50, ago=3, loop=("Solo", 4, 8)),
        _scored("a", 55, ago=2, loop=("Intro", 0, 2)),
        _scored("a", 40, ago=4, loop=("Bridge", 9, 12)),
        _scored("a", 30, ago=70, loop=("Old", 20, 24)),
        _scored("a", 20, ago=1),
        _scored("zzz", 10, ago=1, loop=("Gone", 1, 2)),
    ]
    revisit = recommend.build(songs, scored, TODAY)["revisit"]
    assert [(item["loop_name"], item["score"], item["attempts"]) for item in revisit] == [
        ("Bridge", 40, 1),
        ("Intro", 55, 1),
    ]
    assert revisit[0]["loop_start"] == 9 and revisit[0]["last_day"] == _ago(4)


def test_review_lists_songs_whose_gap_has_passed_most_overdue_first() -> None:
    songs = [
        _song("today", 4.0, sessions=1, days=1, last=0),
        _song("early", 4.0, sessions=3, days=3, last=2),
        _song("due", 4.0, sessions=3, days=3, last=5),
        _song("late", 4.0, sessions=1, days=1, last=10),
        _song("never", 4.0),
        _song("sheet", None, sessions=2, days=2, last=3),
    ]
    review = recommend.build(songs, [], TODAY)["review"]
    assert [item["song_id"] for item in review] == ["late", "sheet", "due"]
    assert [item["interval_days"] for item in review] == [1, 2, 4]
    assert review[0]["last_day"] == _ago(10)


def test_each_list_is_capped() -> None:
    songs = [_song(f"s{index:02}", 4.1 + index / 100) for index in range(20)]
    songs += [_song(f"p{index:02}", 4.0, sessions=1, days=1, last=5) for index in range(20)]
    result = recommend.build(songs, [], TODAY)
    assert len(result["stretch"]) == len(result["review"]) == recommend.LIMIT


# --- the endpoint ----------------------------------------------------------------------------------------------


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return replace(Settings.for_tests(tmp_path / "a"))


@pytest.fixture
def client(settings: Settings):
    with TestClient(create_app(settings)) as started:
        yield started


def _day(offset: int = 0) -> str:
    return (datetime.now(UTC).date() + timedelta(days=offset)).isoformat()


def _log(settings: Settings, song_id: str, offset: int = 0, owner: str = "local", **extra) -> None:
    """Record straight into the log: the API refuses days more than two away from today."""
    item = SessionInput(song_id=song_id, day=_day(offset), duration_seconds=300, started_at=_day(offset), **extra)
    PracticeRepository(settings).record(owner, item)


def _blank(client: TestClient, title: str) -> str:
    return client.post("/api/songs", json={"title": title}).json()["id"]


def test_the_endpoint_combines_all_three_lists(client: TestClient, settings: Settings) -> None:
    played = _blank(client, "Played")
    older = _blank(client, "Older")
    _log(settings, played, mode="scored", score=90.0, loop_name="Riff", loop_start=0, loop_end=2)
    _log(settings, played, mode="scored", score=40.0, loop_name="Solo", loop_start=4, loop_end=8)
    _log(settings, older, offset=-9)

    body = client.get("/api/practice/recommendations", params={"today": _day()}).json()
    assert set(body) == {"level", "level_basis", "stretch", "revisit", "review"}
    assert (body["level"], body["level_basis"]) == (1.0, "practised")
    assert [(item["loop_name"], item["score"]) for item in body["revisit"]] == [("Solo", 40.0)]
    assert body["revisit"][0]["title"] == "Played"
    assert [item["song_id"] for item in body["review"]] == [older]
    assert body["review"][0]["interval_days"] == 1


def test_the_endpoint_validates_the_day_and_has_empty_lists_for_a_new_player(client: TestClient) -> None:
    assert client.get("/api/practice/recommendations", params={"today": "nope"}).status_code == 400
    empty = {"level": None, "level_basis": "none", "stretch": [], "revisit": [], "review": []}
    assert client.get("/api/practice/recommendations").json() == empty


def test_recommendations_only_use_the_owners_songs(client: TestClient, settings: Settings) -> None:
    song = _blank(client, "Mine")
    _log(settings, song, offset=-3)
    client.app.state.ctx.songs.ensure_user("ann", "Ann")
    today = date.fromisoformat(_day())
    assert PracticeRepository(settings).recommendations("ann", today)["review"] == []
    assert [item["song_id"] for item in PracticeRepository(settings).recommendations("local", today)["review"]] == [
        song
    ]
