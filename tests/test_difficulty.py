"""Difficulty estimate: the factors, the 1..10 level, storage, backfill, sorting and filtering."""

import sqlite3
from contextlib import closing
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fretbook.app import create_app
from fretbook.config import Settings
from fretbook.score import difficulty
from fretbook.score.model import Bar, Beat, Note, ScoreDocument, Track, TrackBar, Voice

EIGHTH = 480
SIXTEENTH = 240


def _document(
    bars: list[list[Beat]], *, bpm: float = 100, signature: tuple[int, int] = (4, 4), tuning=(64, 59, 55, 50, 45, 40)
) -> ScoreDocument:
    return ScoreDocument(
        bpm=bpm,
        bars=[Bar(signature=signature) for _ in bars],
        tracks=[
            Track(
                id="t1",
                name="Guitar",
                instrument="electric-guitar",
                tuning_midi=list(tuning),
                bars=[TrackBar(voices=[Voice(beats=beats)]) for beats in bars],
            )
        ],
    )


def _run(count: int, step: int, notes) -> list[Beat]:
    return [Beat(position=index * step, duration=step, notes=notes(index)) for index in range(count)]


def _plain(count: int = 4, step: int = 960, bpm: float = 100, bars: int = 4) -> ScoreDocument:
    return _document([_run(count, step, lambda i: [Note(string=2, fret=2)]) for _ in range(bars)], bpm=bpm)


def _level(document: ScoreDocument) -> float:
    return difficulty.estimate(document)[0].level


def _factor(document: ScoreDocument, key: str) -> difficulty.Factor:
    return next(item for item in difficulty.estimate(document)[0].factors if item.key == key)


def test_an_empty_track_is_the_easiest() -> None:
    document = _document([[], []])
    result = difficulty.estimate(document)[0]
    assert result.level == 1.0
    assert [item.key for item in result.factors] == list(difficulty.FACTORS)
    assert all(item.value == 0 for item in result.factors)


def test_a_slow_one_note_riff_is_easy() -> None:
    assert _level(_plain()) <= 2.0


def test_faster_tempo_never_lowers_the_level() -> None:
    levels = [_level(_plain(count=8, step=EIGHTH, bpm=bpm)) for bpm in (60, 100, 140, 200, 280)]
    assert levels == sorted(levels)
    assert levels[-1] > levels[0]
    assert _factor(_plain(count=8, step=EIGHTH, bpm=120), "density").measure == pytest.approx(4.0)


def test_more_notes_per_bar_raise_density() -> None:
    sparse = _factor(_plain(count=4, step=960), "density")
    busy = _factor(_plain(count=16, step=SIXTEENTH), "density")
    assert busy.value > sparse.value
    assert busy.measure > sparse.measure


def test_position_shifts_are_counted() -> None:
    near = _document([_run(8, EIGHTH, lambda i: [Note(string=2, fret=2 + i % 2)]) for _ in range(2)])
    far = _document([_run(8, EIGHTH, lambda i: [Note(string=2, fret=2 if i % 2 else 12)]) for _ in range(2)])
    assert _factor(near, "shifts").measure == 0
    assert _factor(far, "shifts").measure == pytest.approx(7.5)
    assert _factor(far, "shifts").value == 1.0
    assert _level(far) > _level(near)


def test_stretch_uses_the_widest_chord_span() -> None:
    narrow = _document([[Beat(position=0, duration=960, notes=[Note(string=2, fret=2), Note(string=3, fret=3)])]])
    wide = _document([[Beat(position=0, duration=960, notes=[Note(string=2, fret=2), Note(string=3, fret=9)])]])
    assert _factor(narrow, "stretch").value == 0
    assert _factor(wide, "stretch").measure == 7
    assert _factor(wide, "stretch").value == 1.0


def test_open_strings_do_not_count_toward_the_stretch() -> None:
    document = _document([[Beat(position=0, duration=960, notes=[Note(string=2, fret=0), Note(string=3, fret=9)])]])
    assert _factor(document, "stretch").measure == 0


def test_techniques_raise_the_level_and_ties_are_ignored() -> None:
    plain = _document([_run(4, 960, lambda i: [Note(string=2, fret=5)])])
    fancy = _document([_run(4, 960, lambda i: [Note(string=2, fret=5, bend=1.0, vibrato=True, hammer=True)])])
    tied = _document([_run(4, 960, lambda i: [Note(string=2, fret=5, tie=True, bend=1.0)])])
    assert _factor(plain, "techniques").value == 0
    assert _factor(fancy, "techniques").value == 1.0
    assert _level(fancy) > _level(plain)
    assert _level(tied) == 1.0, "a tied note is not struck, so it adds neither a technique nor an onset"


def test_chord_changes_and_variety_raise_the_chords_factor() -> None:
    def chord(fret: int) -> list[Note]:
        return [Note(string=1, fret=fret), Note(string=2, fret=fret), Note(string=3, fret=fret)]

    steady = _document([_run(4, 960, lambda i: chord(3)) for _ in range(4)])
    moving = _document([_run(4, 960, lambda i: chord(1 + (i + bar) % 8)) for bar in range(4)])
    assert _factor(steady, "chords").measure == 0
    assert _factor(moving, "chords").measure > 0
    assert _factor(moving, "chords").value > _factor(steady, "chords").value


def test_tuplets_syncopation_and_odd_meters_raise_rhythm() -> None:
    straight = _plain()
    triplets = _document([_run(6, 320, lambda i: [Note(string=2, fret=3)]) for _ in range(2)])
    off_grid = _document([[Beat(position=120, duration=360, notes=[Note(string=2, fret=3)])]])
    odd = _document([_run(7, EIGHTH, lambda i: [Note(string=2, fret=3)])], signature=(7, 8))
    assert _factor(straight, "rhythm").value == 0
    assert _factor(off_grid, "rhythm").measure == 1.0
    assert _factor(odd, "rhythm").value == 0.25
    assert _factor(triplets, "rhythm").value > _factor(straight, "rhythm").value


def test_a_signature_change_counts_as_an_odd_meter() -> None:
    document = _plain()
    document.bars[2].signature = (3, 4)
    assert _factor(document, "rhythm").value == 0.25


def test_levels_stay_between_1_and_10() -> None:
    def wild(i: int) -> list[Note]:
        return [Note(string=s, fret=1 + (i * 7 + s * 5) % 22, bend=2, slide="shift", vibrato=True) for s in range(6)]

    document = _document([_run(32, 30, wild) for _ in range(8)], bpm=399)
    level = _level(document)
    assert 9.0 <= level <= 10.0
    assert 1.0 <= _level(_plain()) <= 10.0


def test_the_song_level_is_the_preferred_tracks() -> None:
    easy = _plain()
    hard = _document([_run(16, SIXTEENTH, lambda i: [Note(string=2, fret=2 + (i % 2) * 10, bend=1.0)])])
    document = ScoreDocument(
        bars=easy.bars,
        tracks=[
            easy.tracks[0],
            Track(**{**hard.tracks[0].model_dump(), "id": "t2", "bars": easy.tracks[0].model_dump()["bars"]}),
        ],
    )
    document.tracks[1].bars = [hard.tracks[0].bars[0]] * len(document.bars)
    document.tracks[1].preferred = True
    tracks = difficulty.estimate(document)
    assert tracks[1].level > tracks[0].level
    assert difficulty.song_level(document, tracks) == tracks[1].level
    document.tracks[1].preferred = False
    assert difficulty.song_level(document) == tracks[0].level


# --- storage and API -----------------------------------------------------------------------------------------


@pytest.fixture
def client(tmp_path: Path):
    with TestClient(create_app(replace(Settings.for_tests(tmp_path / "a")))) as started:
        yield started


def _hard() -> ScoreDocument:
    return _document([_run(16, SIXTEENTH, lambda i: [Note(string=2, fret=2 + (i % 2) * 10, bend=1.0)])] * 4, bpm=160)


def _tab(client: TestClient, title: str, document: ScoreDocument) -> dict:
    created = client.post("/api/songs", json={"title": title}).json()
    body = {"title": title, "revision": created["revision"], "document": document.model_dump(mode="json")}
    saved = client.put(f"/api/songs/{created['id']}", json=body)
    assert saved.status_code == 200, saved.text
    return saved.json()


def test_the_level_is_stored_on_create_update_and_sync(client: TestClient) -> None:
    created = client.post("/api/songs", json={"title": "Blank"}).json()
    assert created["difficulty"] == 1.0
    assert [item["track_id"] for item in created["difficulty_tracks"]] == [created["document"]["tracks"][0]["id"]]

    hard = _tab(client, "Hard", _hard())
    assert hard["difficulty"] > 4
    assert hard["difficulty_tracks"][0]["level"] == hard["difficulty"]
    assert {item["key"] for item in hard["difficulty_tracks"][0]["factors"]} == set(difficulty.FACTORS)

    medium = _tab(client, "Medium", _plain(count=8, step=EIGHTH, bpm=90))
    faster = client.patch(f"/api/songs/{medium['id']}/sync", json={"bpm": 200, "anchors": {}}).json()
    assert faster["difficulty"] > medium["difficulty"], "tempo is part of the score, so a sync tempo change re-rates it"
    assert client.get(f"/api/songs/{medium['id']}").json()["difficulty"] == faster["difficulty"]


def test_a_chord_sheet_has_no_level(client: TestClient) -> None:
    sheet = client.post("/api/songs", json={"content_kind": "chords", "title": "Chords", "chordpro": "[C]Hi"}).json()
    assert sheet["difficulty"] is None
    assert sheet["difficulty_tracks"] == []


def test_sort_and_filter_by_difficulty(client: TestClient) -> None:
    hard = _tab(client, "Hard", _hard())
    easy = client.post("/api/songs", json={"title": "Easy"}).json()
    sheet = client.post("/api/songs", json={"content_kind": "chords", "title": "Chords", "chordpro": "[C]Hi"}).json()

    ascending = client.get("/api/songs", params={"sort": "difficulty"}).json()["items"]
    assert [item["id"] for item in ascending] == [easy["id"], hard["id"], sheet["id"]]
    descending = client.get("/api/songs", params={"sort": "difficulty", "order": "desc"}).json()["items"]
    assert [item["id"] for item in descending] == [hard["id"], easy["id"], sheet["id"]], "chord sheets stay last"

    level = round(hard["difficulty"])
    only_hard = client.get("/api/songs", params={"difficulty_min": level}).json()
    assert [item["id"] for item in only_hard["items"]] == [hard["id"]]
    only_easy = client.get("/api/songs", params={"difficulty_max": 1}).json()
    assert [item["id"] for item in only_easy["items"]] == [easy["id"]]
    both = client.get("/api/songs", params={"difficulty_min": 1, "difficulty_max": 10}).json()
    assert {item["id"] for item in both["items"]} == {easy["id"], hard["id"]}
    assert client.get("/api/songs", params={"difficulty_min": 11}).status_code == 422


def test_start_up_fills_in_songs_without_a_level(tmp_path: Path) -> None:
    settings = replace(Settings.for_tests(tmp_path / "a"))
    with TestClient(create_app(settings)) as first:
        song = _tab(first, "Hard", _hard())
        sheet = first.post("/api/songs", json={"content_kind": "chords", "title": "C", "chordpro": "[C]Hi"}).json()
    with closing(sqlite3.connect(settings.database_path)) as conn, conn:
        conn.execute("UPDATE songs SET difficulty = NULL, difficulty_detail = NULL, difficulty_version = NULL")
        conn.execute("UPDATE songs SET revision = 7, updated_at = 'old' WHERE id = ?", (song["id"],))
    with TestClient(create_app(settings)) as second:
        again = second.get(f"/api/songs/{song['id']}").json()
        assert again["difficulty"] == song["difficulty"]
        assert again["difficulty_tracks"] == song["difficulty_tracks"]
        assert (again["revision"], again["updated_at"]) == (7, "old"), "a backfill does not count as an edit"
        assert second.get(f"/api/songs/{sheet['id']}").json()["difficulty"] is None
    with closing(sqlite3.connect(settings.database_path)) as conn, conn:
        conn.execute("UPDATE songs SET difficulty = 9.9, difficulty_version = 0 WHERE id = ?", (song["id"],))
    with TestClient(create_app(settings)) as third:
        assert third.get(f"/api/songs/{song['id']}").json()["difficulty"] == song["difficulty"]


def test_a_score_that_no_longer_validates_is_left_without_a_level(tmp_path: Path) -> None:
    settings = replace(Settings.for_tests(tmp_path / "a"))
    with TestClient(create_app(settings)) as first:
        song = first.post("/api/songs", json={"title": "Blank"}).json()
    with closing(sqlite3.connect(settings.database_path)) as conn, conn:
        conn.execute("UPDATE songs SET document = '{\"bars\": []}', difficulty = NULL, difficulty_version = NULL")
    repo = create_app(settings).state.ctx.songs
    assert repo.refresh_difficulty() == 1
    assert repo.refresh_difficulty() == 0, "a broken score is not retried on every start"
    with closing(sqlite3.connect(settings.database_path)) as conn, conn:
        assert conn.execute("SELECT difficulty FROM songs WHERE id = ?", (song["id"],)).fetchone()[0] is None
