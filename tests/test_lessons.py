"""Lessons and courses: the file format, the catalogue, unlocking, progress, editing and packs."""

import io
import zipfile
from dataclasses import replace
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fretbook.app import create_app
from fretbook.config import Settings
from fretbook.lessons.catalog import BUILTIN_DIR, LessonCatalog
from fretbook.lessons.format import (
    LessonFormatError,
    PassCondition,
    Result,
    parse_course,
    parse_lesson,
    passes,
)

COURSE = "---\ntitle: Test course\ntrack: guitar\nlevels:\n  - one: Level one\n  - two: Level two\n---\n"


def lesson(title: str = "A lesson", body: str = "Hello", **front: str) -> str:
    extra = "".join(f"{key}: {value}\n" for key, value in front.items())
    return f"---\ntitle: {title}\n{extra}---\n{body}\n"


# -- the format ---------------------------------------------------------------------------------------------


def test_front_matter_values_lists_and_quotes() -> None:
    text = (
        "---\n# a comment\ntitle: \"Quoted: title\"\nsummary: 'single'\nlevel: one\nrequires: [a, b]\n"
        "order: 3\n---\nBody\n"
    )
    parsed = parse_lesson(text, "x")
    assert (parsed.title, parsed.summary, parsed.level, parsed.order) == ("Quoted: title", "single", "one", 3)
    assert parsed.requires == ["a", "b"]
    assert [(b.kind, b.text) for b in parsed.blocks] == [("markdown", "Body")]


def test_a_block_list_and_an_empty_requires() -> None:
    assert parse_lesson("---\ntitle: T\nrequires:\n  - a\n  - b\n---\n", "x").requires == ["a", "b"]
    assert parse_lesson("---\ntitle: T\nrequires: []\n---\n", "x").requires == []
    assert parse_lesson("---\ntitle: T\n---\n", "x").requires is None


def test_course_front_matter() -> None:
    course = parse_course(COURSE.replace("guitar\n", "bass\nrequires: [other]\n"), "c")
    assert (course.track, course.requires, course.levels) == (
        "bass",
        ["other"],
        [("one", "Level one"), ("two", "Level two")],
    )


@pytest.mark.parametrize(
    ("text", "message", "line"),
    [
        ("no front matter", "must start with", 1),
        ("---\ntitle: T\n", "never closed", None),
        ("---\ntitle: T\ntitle: U\n---\n", "given twice", 3),
        ("---\ntitle T\n---\n", "key: value", 2),
        ("---\n- stray\n---\n", "list item", 2),
        ("---\ntitle: 'open\n---\n", "closing quote", 2),
        ("---\nrequires: [a\ntitle: T\n---\n", "closing ]", 2),
        ("---\ntitle: T\nrequires: a\n---\n", "must be a list", 3),
        ("---\ntitle: T\norder: soon\n---\n", "whole number", 3),
        ("---\nsummary: x\n---\n", "'title' is required", None),
        ("---\ntitle: T\nlevel: Bad Level\n---\n", "lowercase", 3),
        ("---\ntitle: T\nrequires: [x]\n---\n", "cannot require itself", 3),
        ("---\ntitle: T\n---\n```fretbook:nope\n```\n", "unknown block", 4),
        ("---\ntitle: T\n---\n```fretbook:chord\nname: Am\n", "never closed", 4),
        ("---\ntitle: T\n---\n```fretbook:chord\n```\n", "needs a `name`", 4),
        ("---\ntitle: T\n---\n```fretbook:chord\nname: Am\ncolour: red\n```\n", "does not take colour", 4),
        ("---\ntitle: T\n---\n```fretbook:chord\nname: Am\ninstrument: banjo\n```\n", "instrument", 4),
        ("---\ntitle: T\n---\n```fretbook:fretboard\n```\n", "needs `notes`", 4),
        ("---\ntitle: T\n---\n```fretbook:fretboard\nnotes: H\n```\n", "note names", 4),
        ("---\ntitle: T\n---\n```fretbook:fretboard\nscale: major\n```\n", "needs a `root`", 4),
        ("---\ntitle: T\n---\n```fretbook:song\n```\n", "`song` id", 4),
        ("---\ntitle: T\n---\n```fretbook:tab\n```\n", "empty", 4),
        ("---\ntitle: T\n---\n```fretbook:exercise\npreset: not valid\n```\n", "`preset`", 4),
        ("---\ntitle: T\n---\n```fretbook:media\ntype: video\nsrc: javascript:alert(1)\n```\n", "http", 4),
        ("---\ntitle: T\n---\n```fretbook:media\ntype: gif\nsrc: https://x.test/a\n```\n", "video or audio", 4),
        ("---\ntitle: T\n---\n```fretbook:pass\ntype: score\n```\n", "min_score", 4),
        ("---\ntitle: T\n---\n```fretbook:pass\ntype: score\nmin_score: 120\n```\n", "between", 4),
        ("---\ntitle: T\n---\n```fretbook:pass\ntype: wait\nmin_score: 5\n```\n", "wait", 4),
        ("---\ntitle: T\n---\n```fretbook:pass\ntype: wait\n```\n```fretbook:pass\ntype: wait\n```\n", "only one", 7),
    ],
)
def test_format_errors_name_the_problem_and_line(text: str, message: str, line: int | None) -> None:
    with pytest.raises(LessonFormatError) as caught:
        parse_lesson(text, "x")
    assert message in str(caught.value)
    assert caught.value.line == line


def test_bad_ids_and_tracks_are_refused() -> None:
    with pytest.raises(LessonFormatError, match="lesson id"):
        parse_lesson(lesson(), "../etc")
    with pytest.raises(LessonFormatError, match="course id"):
        parse_course(COURSE, "Bad_ID")
    for reserved in ("new", "edit"):
        with pytest.raises(LessonFormatError, match="lesson id"):
            parse_lesson(lesson(), reserved)
    with pytest.raises(LessonFormatError, match="track"):
        parse_course(COURSE.replace("guitar", "banjo"), "c")
    with pytest.raises(LessonFormatError, match="itself"):
        parse_course(COURSE.replace("guitar\n", "guitar\nrequires: [c]\n"), "c")


def test_every_block_kind_parses_and_the_markdown_between_is_kept() -> None:
    body = (
        "# Heading\n\n```fretbook:chord\nname: Am7\n```\ntext\n"
        "```fretbook:fretboard\nroot: A\nscale: minor-pentatonic\n```\n"
        "```fretbook:song\nsong: abc123\ntitle: Shown\n```\n~~~fretbook:tab\ne|-0-|\n~~~\n"
        "```fretbook:exercise\npreset: pentatonicBox\n```\n"
        "```fretbook:media\ntype: audio\nsrc: https://example.test/a.mp3\n```\n"
        "```fretbook:pass\ntype: score\nmin_score: 85\nmin_bpm: 90\nsong: abc123\n```\n```python\nprint(1)\n```\n"
    )
    parsed = parse_lesson(lesson(body=body), "x")
    assert [b.kind for b in parsed.blocks] == [
        "markdown",
        "chord",
        "markdown",
        "fretboard",
        "song",
        "tab",
        "exercise",
        "media",
        "pass",
        "markdown",
    ]
    assert parsed.blocks[5].text == "e|-0-|"
    assert parsed.blocks[-1].text.startswith("```python")
    assert parsed.pass_condition == PassCondition("score", 85, 90, "abc123")


def test_pass_condition_rules() -> None:
    score = PassCondition("score", 80, 90)
    assert passes(score, Result(score=80, bpm=90))
    assert not passes(score, Result(score=79.9, bpm=120))
    assert not passes(score, Result(score=95, bpm=89))
    assert not passes(score, Result(score=95))
    assert not passes(score, Result())
    assert passes(PassCondition("score", 80), Result(score=80))
    assert passes(PassCondition("wait"), Result(wait_completed=True))
    assert not passes(PassCondition("wait"), Result(score=100))


def test_the_built_in_courses_are_valid() -> None:
    catalog = LessonCatalog(BUILTIN_DIR, Path("/nonexistent")).load()
    assert catalog.problems == []
    assert {entry.course.track for entry in catalog.courses.values()} == {"guitar", "bass"}


# -- the catalogue ------------------------------------------------------------------------------------------


@pytest.fixture
def folders(tmp_path: Path) -> tuple[Path, Path]:
    builtin, user = tmp_path / "builtin", tmp_path / "user"
    (builtin / "c").mkdir(parents=True)
    (builtin / "c" / "course.md").write_text(COURSE)
    for name, extra in (
        ("a", {"level": "one", "order": "1"}),
        ("b", {"level": "one", "order": "2"}),
        ("c", {"level": "two"}),
    ):
        (builtin / "c" / f"{name}.md").write_text(lesson(f"Lesson {name}", **extra))
    return builtin, user


def test_lessons_are_ordered_by_level_then_order_and_chain_by_default(folders: tuple[Path, Path]) -> None:
    catalog = LessonCatalog(*folders).load()
    entry = catalog.courses["c"]
    assert [(i.lesson.id, i.requires, i.level) for i in entry.lessons] == [
        ("a", [], "one"),
        ("b", ["a"], "one"),
        ("c", ["b"], "two"),
    ]


def test_a_user_lesson_overrides_a_built_in_one_and_deleting_it_restores_it(folders: tuple[Path, Path]) -> None:
    store = LessonCatalog(*folders)
    store.save_lesson("c", "a", lesson("Mine", level="one", order="1"))
    entry = store.load().courses["c"]
    assert [(i.lesson.title, i.source) for i in entry.lessons][0] == ("Mine", "user")
    store.delete_lesson("c", "a")
    assert store.load().courses["c"].lessons[0].lesson.title == "Lesson a"


def test_problems_are_collected_without_stopping_the_rest(folders: tuple[Path, Path]) -> None:
    builtin, user = folders
    (user / "c").mkdir(parents=True)
    (user / "c" / "broken.md").write_text("---\ntitle: T\nlevel: nowhere\n---\n")
    (user / "c" / "worse.md").write_text("no front matter")
    (user / "c" / "loop1.md").write_text(lesson(requires="[loop2]"))
    (user / "c" / "loop2.md").write_text(lesson(requires="[loop1]"))
    (user / "c" / "ghost.md").write_text(lesson(requires="[nothing]"))
    (user / "orphan").mkdir()
    (user / "orphan" / "x.md").write_text(lesson())
    catalog = LessonCatalog(builtin, user).load()
    joined = "\n".join(catalog.problems)
    for fragment in ("broken.md", "worse.md", "loop1.md", "loop2.md", "ghost.md", "orphan"):
        assert fragment in joined
    assert {"a", "b", "c", "loop1", "loop2", "ghost"} <= {i.lesson.id for i in catalog.courses["c"].lessons}
    assert "orphan" not in catalog.courses


def test_course_prerequisite_loops_and_unknown_courses_are_ignored(tmp_path: Path) -> None:
    for name in ("p", "q"):
        (tmp_path / name).mkdir()
        other = "q" if name == "p" else "p"
        (tmp_path / name / "course.md").write_text(COURSE.replace("guitar\n", f"guitar\nrequires: [{other}, ghost]\n"))
        (tmp_path / name / "l.md").write_text(lesson())
    catalog = LessonCatalog(tmp_path, tmp_path / "none").load()
    assert catalog.courses["p"].course.requires == [] and catalog.courses["q"].course.requires == []
    assert any("ghost" in problem for problem in catalog.problems)


def test_file_names_cannot_escape(folders: tuple[Path, Path]) -> None:
    store = LessonCatalog(*folders)
    for bad in ("../x", "a/b", "A", ""):
        with pytest.raises(Exception):  # noqa: B017 - any refusal will do
            store.save_lesson("c", bad, lesson())
    with pytest.raises(Exception):  # noqa: B017
        store.save_course("../c", COURSE)
    assert not (folders[1].parent / "x.md").exists()


# -- the API ------------------------------------------------------------------------------------------------


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    builtin = tmp_path / "builtin"
    (builtin / "c").mkdir(parents=True)
    (builtin / "c" / "course.md").write_text(COURSE)
    (builtin / "c" / "a.md").write_text(
        lesson("First", level="one", order="1", body="```fretbook:pass\ntype: score\nmin_score: 80\nmin_bpm: 90\n```")
    )
    (builtin / "c" / "b.md").write_text(lesson("Second", level="one", order="2"))
    (builtin / "c" / "free.md").write_text(
        lesson("Free", level="two", requires="[]", body="```fretbook:pass\ntype: wait\n```")
    )
    (builtin / "d").mkdir()
    (builtin / "d" / "course.md").write_text(
        COURSE.replace("guitar\n", "bass\nrequires: [c]\n").replace("Test course", "Next")
    )
    (builtin / "d" / "x.md").write_text(lesson("X", level="one"))
    monkeypatch.setattr("fretbook.api.lesson_routes.BUILTIN_DIR", builtin)
    with TestClient(create_app(Settings.for_tests(tmp_path / "a"))) as started:
        yield started


def _status(client: TestClient, course: str = "c") -> dict[str, str]:
    levels = client.get(f"/api/courses/{course}").json()["levels"]
    return {item["id"]: item["status"] for level in levels for item in level["lessons"]}


def test_listing_courses_and_the_course_page(client: TestClient) -> None:
    listing = client.get("/api/courses").json()
    assert [(c["id"], c["track"], c["locked"], c["lesson_count"]) for c in listing["courses"]] == [
        ("d", "bass", True, 1),
        ("c", "guitar", False, 3),
    ]
    assert listing["courses"][0]["requires"] == ["Test course"]
    assert listing["can_edit"] is True
    course = client.get("/api/courses/c").json()
    assert [(lvl["id"], lvl["title"], [i["id"] for i in lvl["lessons"]]) for lvl in course["levels"]] == [
        ("one", "Level one", ["a", "b"]),
        ("two", "Level two", ["free"]),
    ]
    assert _status(client) == {"a": "available", "b": "locked", "free": "available"}
    assert client.get("/api/courses/nope").json()["detail"]["key"] == "course.notFound"


def test_a_locked_lesson_is_refused_until_its_prerequisite_is_done(client: TestClient) -> None:
    assert client.get("/api/courses/c/lessons/b").json()["detail"]["key"] == "lesson.locked"
    assert client.post("/api/courses/c/lessons/b/open").status_code == 403
    assert client.post("/api/courses/c/lessons/b/progress", json={"completed": True}).status_code == 403
    assert client.get("/api/courses/c/lessons/nope").json()["detail"]["key"] == "lesson.notFound"


def test_a_reported_result_must_meet_the_pass_condition(client: TestClient) -> None:
    url = "/api/courses/c/lessons/a/progress"
    missed = client.post(url, json={"score": 90, "bpm": 80}).json()
    assert missed["passed"] is False and missed["progress"]["attempts"] == 1 and missed["progress"]["best_score"] == 90
    assert _status(client)["a"] == "available"
    passed = client.post(url, json={"score": 85, "bpm": 95}).json()
    assert passed["passed"] is True and passed["next_lesson_id"] == "b"
    assert passed["progress"]["best_score"] == 90 and passed["progress"]["best_bpm"] == 95
    assert _status(client) == {"a": "completed", "b": "available", "free": "available"}
    # Completion is never taken back by a later, worse attempt.
    assert client.post(url, json={"score": 10, "bpm": 10}).json()["passed"] is True
    assert client.get("/api/courses/c/lessons/b").status_code == 200


def test_wait_mode_lessons_and_lessons_without_a_condition(client: TestClient) -> None:
    free = "/api/courses/c/lessons/free/progress"
    assert client.post(free, json={"score": 100}).json()["passed"] is False
    assert client.post(free, json={"wait_completed": True}).json()["passed"] is True
    client.post("/api/courses/c/lessons/a/progress", json={"score": 99, "bpm": 99})
    manual = "/api/courses/c/lessons/b/progress"
    assert client.post(manual, json={}).json()["passed"] is False
    assert client.post(manual, json={"completed": True}).json()["passed"] is True


@pytest.mark.parametrize("body", [{"score": 101}, {"score": -1}, {"bpm": 0}, {"bpm": 9999}])
def test_out_of_range_results_are_refused(client: TestClient, body: dict) -> None:
    assert client.post("/api/courses/c/lessons/a/progress", json=body).status_code == 422


def test_finishing_every_lesson_opens_the_next_course(client: TestClient) -> None:
    assert client.get("/api/courses/d/lessons/x").json()["detail"]["key"] == "lesson.locked"
    client.post("/api/courses/c/lessons/a/progress", json={"score": 99, "bpm": 99})
    client.post("/api/courses/c/lessons/b/progress", json={"completed": True})
    assert next(c for c in client.get("/api/courses").json()["courses"] if c["id"] == "d")["locked"] is True
    client.post("/api/courses/c/lessons/free/progress", json={"wait_completed": True})
    listing = client.get("/api/courses").json()["courses"]
    assert next(c for c in listing if c["id"] == "d")["locked"] is False
    assert client.get("/api/courses/d/lessons/x").status_code == 200


def test_continue_returns_to_the_lesson_opened_last_then_moves_on(client: TestClient) -> None:
    assert client.get("/api/courses").json()["resume"]["lesson_id"] == "a"
    assert client.post("/api/courses/c/lessons/free/open").status_code == 204
    resume = client.get("/api/courses").json()["resume"]
    assert (resume["course_id"], resume["lesson_id"], resume["lesson_title"]) == ("c", "free", "Free")
    client.post("/api/courses/c/lessons/free/progress", json={"wait_completed": True})
    assert client.get("/api/courses").json()["resume"]["lesson_id"] == "a"
    assert client.get("/api/courses/c/lessons/free").json()["next_lesson_id"] == "a"


def test_check_reads_the_practice_log_for_a_song_bound_condition(client: TestClient, tmp_path: Path) -> None:
    song = client.post("/api/songs", json={"title": "Scale"}).json()["id"]
    client.put(
        "/api/courses/c/lessons/b/source",
        content=None,
        json={
            "text": lesson(
                "Song",
                level="one",
                requires="[]",
                body=f"```fretbook:pass\ntype: score\nmin_score: 80\nsong: {song}\n```",
            )
        },
    )
    check = "/api/courses/c/lessons/b/check"
    assert (
        client.post("/api/courses/c/lessons/b/progress", json={"score": 99}).json()["detail"]["key"]
        == "lesson.useCheck"
    )
    assert client.post(check).json()["passed"] is False

    def log(**extra) -> None:
        body = {"song_id": song, "day": date.today().isoformat(), "duration_seconds": 60, **extra}
        assert client.post("/api/practice/sessions", json=body).status_code in (200, 201)

    log(mode="scored", score=70)
    assert client.post(check).json()["passed"] is False
    log(mode="free", score=None)
    # Looping the easy bars is not playing the song: neither a high score nor wait mode on a loop counts.
    log(mode="scored", score=99, loop_start=0, loop_end=1)
    log(mode="wait", loop_start=0, loop_end=1)
    assert client.post(check).json()["passed"] is False
    log(mode="scored", score=82)
    result = client.post(check).json()
    assert result["passed"] is True and result["progress"]["best_score"] == 82
    assert client.post("/api/courses/c/lessons/a/check").json()["detail"]["key"] == "lesson.noSong"
    client.put(
        "/api/courses/c/lessons/b/source",
        json={
            "text": lesson(
                "Song", level="one", requires="[]", body="```fretbook:pass\ntype: wait\nsong: nosuchsong\n```"
            )
        },
    )
    assert client.post(check).json()["detail"]["key"] == "song.notFound"


def test_a_wait_lesson_tied_to_a_song_needs_a_whole_song_wait_session(client: TestClient) -> None:
    song = client.post("/api/songs", json={"title": "Scale"}).json()["id"]
    text = lesson("Wait", level="one", requires="[]", body=f"```fretbook:pass\ntype: wait\nsong: {song}\n```")
    client.put("/api/courses/c/lessons/b/source", json={"text": text})
    check = "/api/courses/c/lessons/b/check"

    def log(**extra) -> None:
        body = {"song_id": song, "day": date.today().isoformat(), "duration_seconds": 60, **extra}
        assert client.post("/api/practice/sessions", json=body).status_code in (200, 201)

    log(mode="wait", loop_start=2, loop_end=3)
    log(mode="scored", score=100)
    assert client.post(check).json()["passed"] is False
    log(mode="wait")
    assert client.post(check).json()["passed"] is True


def test_the_tempo_of_a_run_is_the_song_tempo_times_the_playback_speed(client: TestClient) -> None:
    song = client.post("/api/songs", json={"title": "Scale"}).json()["id"]
    tempo = client.get(f"/api/songs/{song}").json()["bpm"]
    assert tempo > 0
    goal = round(tempo * 0.75)
    body = f"```fretbook:pass\ntype: score\nmin_score: 50\nmin_bpm: {goal}\nsong: {song}\n```"
    client.put("/api/courses/c/lessons/b/source", json={"text": lesson("T", level="one", requires="[]", body=body)})

    def log(speed: float) -> None:
        session = {"song_id": song, "day": date.today().isoformat(), "duration_seconds": 60, "mode": "scored"}
        session.update(score=99, speed=speed)
        assert client.post("/api/practice/sessions", json=session).status_code in (200, 201)

    check = "/api/courses/c/lessons/b/check"
    log(0.5)
    assert client.post(check).json()["passed"] is False
    log(1.0)
    assert client.post(check).json()["passed"] is True


def test_editing_lessons_previewing_and_deleting(client: TestClient) -> None:
    preview = client.post("/api/lessons/preview", json={"text": lesson("Hi", body="```fretbook:chord\nname: G\n```")})
    assert preview.json()["title"] == "Hi" and preview.json()["blocks"][0]["params"]["name"] == "G"
    bad = client.post("/api/lessons/preview", json={"text": "---\ntitle: T\n---\n```fretbook:chord\n```\n"})
    assert bad.status_code == 400
    detail = bad.json()["detail"]
    assert detail["key"] == "lesson.invalid" and detail["params"]["line"] == 4
    unclosed = client.post("/api/lessons/preview", json={"text": "---\ntitle: T\n"}).json()["detail"]
    assert unclosed["key"] == "lesson.invalidNoLine" and "line" not in unclosed["params"]

    saved = client.put("/api/courses/c/lessons/new-one/source", json={"text": lesson("Brand new", level="two")})
    assert saved.status_code == 200
    assert client.get("/api/courses/c/lessons/new-one/source").json() == {
        "text": lesson("Brand new", level="two"),
        "source": "user",
    }
    assert "new-one" in _status(client)
    assert client.put("/api/courses/c/lessons/Bad_Id/source", json={"text": lesson()}).status_code == 400
    assert (
        client.put("/api/courses/nope/lessons/x/source", json={"text": lesson()}).json()["detail"]["key"]
        == "course.notFound"
    )
    assert client.put("/api/courses/c/lessons/x/source", json={"text": lesson(level="zzz")}).status_code == 400

    assert client.delete("/api/courses/c/lessons/new-one").status_code == 204
    assert client.delete("/api/courses/c/lessons/new-one").status_code == 404
    assert client.delete("/api/courses/c/lessons/b").json()["detail"]["key"] == "lesson.builtin"
    assert client.delete("/api/courses/c/lessons/ghost").status_code == 404


def test_editing_a_built_in_lesson_overrides_it(client: TestClient) -> None:
    original = client.get("/api/courses/c/lessons/free/source").json()
    assert original["source"] == "builtin"
    client.put("/api/courses/c/lessons/free/source", json={"text": lesson("Changed", level="two", requires="[]")})
    assert client.get("/api/courses/c/lessons/free").json()["source"] == "user"
    client.delete("/api/courses/c/lessons/free")
    assert client.get("/api/courses/c/lessons/free").json()["title"] == "Free"


def test_courses_can_be_written_and_deleted(client: TestClient) -> None:
    text = COURSE.replace("Test course", "Mine")
    assert client.put("/api/courses/mine/source", json={"text": text}).status_code == 200
    assert client.put("/api/courses/mine/lessons/one/source", json={"text": lesson(level="one")}).status_code == 200
    assert client.get("/api/courses/mine/source").json()["source"] == "user"
    assert [c["id"] for c in client.get("/api/courses").json()["courses"]].count("mine") == 1
    assert client.put("/api/courses/mine/source", json={"text": "nope"}).status_code == 400
    assert client.delete("/api/courses/mine").status_code == 204
    assert client.get("/api/courses/mine").status_code == 404
    assert client.delete("/api/courses/mine").status_code == 404
    assert client.delete("/api/courses/c").json()["detail"]["key"] == "lesson.builtin"
    assert client.get("/api/courses/nope/source").status_code == 404


def _zip(files: dict[str, str | bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return buffer.getvalue()


def _import(client: TestClient, data: bytes):
    return client.post("/api/lessons/import", files={"file": ("pack.zip", data, "application/zip")})


def test_importing_a_pack(client: TestClient) -> None:
    pack = _zip(
        {
            "packed/course.md": COURSE,
            "packed/one.md": lesson("One", level="one"),
            "packed/notes.txt": "ignored",
            "README.md": "x",
        }
    )
    assert _import(client, pack).json() == {"courses": 1, "lessons": 2}
    assert client.get("/api/courses/packed").json()["lesson_count"] == 1
    # A lesson for a course that already exists needs no course.md of its own.
    assert _import(client, _zip({"c/extra.md": lesson("Extra", level="two")})).json() == {"courses": 1, "lessons": 1}
    assert "extra" in _status(client)


@pytest.mark.parametrize(
    ("files", "key"),
    [
        ({"x/course.md": COURSE, "x/bad.md": "nope"}, "lessons.packInvalid"),
        ({"notes.txt": "nothing here"}, "lessons.packEmpty"),
        ({"fresh/one.md": lesson()}, "lessons.packNoCourse"),
        ({"../evil/course.md": COURSE}, "import.zipPathTraversal"),
    ],
)
def test_bad_packs_change_nothing(client: TestClient, files: dict, key: str) -> None:
    response = _import(client, _zip(files))
    assert response.status_code == 400 and response.json()["detail"]["key"] == key
    assert "x" not in [c["id"] for c in client.get("/api/courses").json()["courses"]]


def test_a_pack_with_too_many_lessons_or_too_many_bytes_is_refused(client: TestClient) -> None:
    many = {f"big/l{i}.md": lesson(f"L{i}") for i in range(501)}
    many["big/course.md"] = COURSE
    over = _import(client, _zip(many)).json()["detail"]
    assert over["key"] == "lessons.packTooManyLessons" and over["params"]["limit"] == 500
    huge = _import(client, b"0" * (10 * 1024 * 1024 + 1))
    assert huge.status_code in (413, 400)
    assert "big" not in [c["id"] for c in client.get("/api/courses").json()["courses"]]


def test_a_pack_that_is_not_a_zip_is_refused(client: TestClient) -> None:
    assert _import(client, b"not a zip").json()["detail"]["key"] == "import.invalidZip"


def test_with_sign_in_on_only_admins_edit_and_others_get_no_problem_list(client: TestClient) -> None:
    from fretbook.api.deps import principal
    from fretbook.auth.base import Principal

    ctx = client.app.state.ctx
    ctx.settings = replace(ctx.settings, auth_mode="oidc")
    who = {"role": "user"}
    client.app.dependency_overrides[principal] = lambda: Principal(
        user_id="local", display_name="Uma", authenticated=True, role=who["role"]
    )
    try:
        assert client.get("/api/courses").json()["can_edit"] is False
        for method, url, kwargs in (
            ("post", "/api/lessons/preview", {"json": {"text": lesson()}}),
            ("put", "/api/courses/c/lessons/z/source", {"json": {"text": lesson()}}),
            ("get", "/api/courses/c/lessons/a/source", {}),
            ("delete", "/api/courses/c/lessons/a", {}),
            ("put", "/api/courses/c/source", {"json": {"text": COURSE}}),
            ("delete", "/api/courses/c", {}),
            ("post", "/api/lessons/import", {"files": {"file": ("p.zip", b"x")}}),
        ):
            response = getattr(client, method)(url, **kwargs)
            assert response.status_code == 403, url
            assert response.json()["detail"]["key"] == "auth.adminOnly"
        who["role"] = "admin"
        assert client.get("/api/courses").json()["can_edit"] is True
        assert client.post("/api/lessons/preview", json={"text": lesson()}).status_code == 200
    finally:
        client.app.dependency_overrides.clear()


def test_progress_belongs_to_one_user_and_goes_with_them(client: TestClient) -> None:
    from fretbook.storage.lessons import LessonProgressRepository

    client.post("/api/courses/c/lessons/a/progress", json={"score": 99, "bpm": 99})
    repo = LessonProgressRepository(client.app.state.ctx.settings)
    assert ("c", "a") in repo.all("local") and repo.all("someone-else") == {}


def _restore(client: TestClient, archive: bytes) -> dict:
    import time

    response = client.post(
        "/api/library/import", files={"file": ("lib.zip", archive, "application/zip")}, data={"mode": "skip"}
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


def test_backup_round_trip_keeps_lesson_progress(client: TestClient, tmp_path: Path) -> None:
    import json

    client.post("/api/courses/c/lessons/a/progress", json={"score": 99, "bpm": 99})
    archive = client.get("/api/library/export").content
    with zipfile.ZipFile(io.BytesIO(archive)) as zf:
        manifest = json.loads(zf.read("manifest.json"))
    assert [(row["course_id"], row["lesson_id"]) for row in manifest["lessons"]["progress"]] == [("c", "a")]

    with TestClient(create_app(Settings.for_tests(tmp_path / "dst"))) as target:
        target.app.state.ctx.settings  # the built-in lessons are the real ones here; only the rows matter
        job = _restore(target, archive)
        assert job["status"] == "done" and job["result"]["lesson_progress"] == 1
        from fretbook.storage.lessons import LessonProgressRepository

        rows = LessonProgressRepository(target.app.state.ctx.settings).all("local")
        assert rows[("c", "a")].best_score == 99 and rows[("c", "a")].completed_at
        assert _restore(target, archive)["result"]["lesson_progress"] == 0

        broken = json.loads(json.dumps(manifest))
        broken["lessons"]["progress"] = [{"course_id": "../x", "lesson_id": "a"}, "junk"]
        out = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(archive)) as src, zipfile.ZipFile(out, "w") as dst:
            for name in src.namelist():
                dst.writestr(name, json.dumps(broken) if name == "manifest.json" else src.read(name))
        job = _restore(target, out.getvalue())
        assert job["status"] == "done" and job["result"]["lesson_progress"] == 0
        assert [w["key"] for w in job["result"]["warnings"]] == ["backup.lessonProgressDropped"]
