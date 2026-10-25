"""Lessons and courses: browse, play, track progress, and (for editors) write lessons and import packs."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from fretbook.api.deps import context, principal
from fretbook.api.errors import api_error
from fretbook.api.schemas import AUTH_RESPONSES
from fretbook.auth.base import Principal
from fretbook.context import AppContext
from fretbook.importers.base import ImportError as ImportFailed
from fretbook.lessons import unlock
from fretbook.lessons.catalog import (
    BUILTIN_DIR,
    Catalog,
    CourseEntry,
    LessonCatalog,
    LessonEntry,
    NotRemovable,
    PackError,
    UnknownCourse,
    UnknownLesson,
)
from fretbook.lessons.format import (
    MAX_PASS_BPM,
    MAX_TEXT,
    Lesson,
    LessonFormatError,
    PassCondition,
    Result,
    parse_lesson,
    passes,
)
from fretbook.storage.lessons import LessonProgressRepository, Progress

router = APIRouter()

Status = Literal["locked", "available", "completed"]
Source = Literal["builtin", "user"]
Track = Literal["guitar", "bass"]
MAX_PACK_BYTES = 10 * 1024 * 1024


class LessonPassCondition(BaseModel):
    type: Literal["score", "wait"]
    min_score: float | None
    min_bpm: float | None
    song: str
    """A library song id: the result is read from the practice log. Empty when the player reports it."""


class LessonProgress(BaseModel):
    completed: bool
    completed_at: str | None
    attempts: int
    best_score: float | None
    best_bpm: float | None


class LessonSummary(BaseModel):
    id: str
    title: str
    summary: str
    status: Status
    source: Source
    has_pass_condition: bool
    pass_condition: LessonPassCondition | None
    requires: list[str]
    minutes: int
    """A rough time to read the lesson and practise it, in minutes."""
    stars: int
    """0 until the lesson is done, then 1 to 3 from the best score."""


class CourseLevel(BaseModel):
    id: str
    title: str
    lessons: list[LessonSummary]


class CourseSummary(BaseModel):
    id: str
    title: str
    track: Track
    summary: str
    source: Source
    lesson_count: int
    completed_count: int
    locked: bool
    requires: list[str]
    """Titles of the courses that must be finished first."""
    next_lesson_id: str | None
    minutes_left: int
    """Estimated minutes for the lessons not done yet."""
    stars: int
    max_stars: int


class CourseDetail(CourseSummary):
    levels: list[CourseLevel]


class LessonResume(BaseModel):
    course_id: str
    course_title: str
    lesson_id: str
    lesson_title: str


class CourseList(BaseModel):
    courses: list[CourseSummary]
    resume: LessonResume | None
    can_edit: bool
    problems: list[str]
    """Mistakes found in lesson files, for editors; empty for everyone else."""


class LessonBlock(BaseModel):
    kind: Literal["markdown", "chord", "fretboard", "song", "tab", "exercise", "media", "pass"]
    text: str
    params: dict[str, str]


class LessonDetail(BaseModel):
    course_id: str
    course_title: str
    id: str
    title: str
    summary: str
    status: Status
    source: Source
    blocks: list[LessonBlock]
    pass_condition: LessonPassCondition | None
    progress: LessonProgress
    next_lesson_id: str | None
    can_edit: bool


class LessonPreview(BaseModel):
    title: str
    summary: str
    blocks: list[LessonBlock]
    pass_condition: LessonPassCondition | None


class LessonTextBody(BaseModel):
    text: str = Field(max_length=MAX_TEXT)


class LessonSource(BaseModel):
    text: str
    source: Source


class LessonProgressBody(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    score: float | None = Field(default=None, ge=0, le=100)
    bpm: float | None = Field(default=None, gt=0, le=MAX_PASS_BPM)
    wait_completed: bool = False
    completed: bool = False
    """Mark a lesson that has no pass condition as done."""


class LessonProgressResult(BaseModel):
    passed: bool
    progress: LessonProgress
    next_lesson_id: str | None


class LessonPackResult(BaseModel):
    courses: int
    lessons: int


def _catalog(ctx: AppContext) -> LessonCatalog:
    return LessonCatalog(BUILTIN_DIR, ctx.settings.lessons_path)


def _can_edit(ctx: AppContext, user: Principal) -> bool:
    """Admins edit lessons; with no sign-in the one person using the server is the admin."""
    return not ctx.settings.oidc_enabled or user.is_admin


def editor(ctx: AppContext = Depends(context), user: Principal = Depends(principal)) -> Principal:
    if not _can_edit(ctx, user):
        raise api_error(403, "auth.adminOnly", "only administrators can do this")
    return user


def _repo(ctx: AppContext) -> LessonProgressRepository:
    return LessonProgressRepository(ctx.settings)


def _model(progress: Progress | None) -> LessonProgress:
    if progress is None:
        return LessonProgress(completed=False, completed_at=None, attempts=0, best_score=None, best_bpm=None)
    return LessonProgress(
        completed=progress.completed_at is not None,
        completed_at=progress.completed_at,
        attempts=progress.attempts,
        best_score=progress.best_score,
        best_bpm=progress.best_bpm,
    )


def _condition(condition: PassCondition | None) -> LessonPassCondition | None:
    if condition is None:
        return None
    return LessonPassCondition(
        type=condition.type,  # type: ignore[arg-type]
        min_score=condition.min_score,
        min_bpm=condition.min_bpm,
        song=condition.song,
    )


def _blocks(lesson: Lesson) -> list[LessonBlock]:
    return [LessonBlock(kind=b.kind, text=b.text, params=b.params) for b in lesson.blocks]  # type: ignore[arg-type]


def _find_course(catalog: Catalog, course_id: str) -> CourseEntry:
    entry = catalog.courses.get(course_id)
    if entry is None:
        raise api_error(404, "course.notFound", "course not found")
    return entry


WORDS_PER_MINUTE = 200
PRACTICE_MINUTES = 5


def _minutes(lesson: Lesson) -> int:
    """Reading time for the text plus a fixed practice slot when the lesson asks for a result or an exercise."""
    words = sum(len(block.text.split()) for block in lesson.blocks if block.kind == "markdown")
    practise = lesson.pass_condition is not None or any(block.kind == "exercise" for block in lesson.blocks)
    return max(1, round(words / WORDS_PER_MINUTE)) + (PRACTICE_MINUTES if practise else 0)


def _stars(row: Progress | None) -> int:
    if row is None or not row.completed_at:
        return 0
    if row.best_score is None:
        return 1
    return 3 if row.best_score >= 95 else 2 if row.best_score >= 85 else 1


def _find_lesson(entry: CourseEntry, lesson_id: str) -> LessonEntry:
    for item in entry.lessons:
        if item.lesson.id == lesson_id:
            return item
    raise api_error(404, "lesson.notFound", "lesson not found")


def _course_summary(
    entry: CourseEntry, catalog: Catalog, state: unlock.Standing, progress: dict[tuple[str, str], Progress]
) -> CourseSummary:
    course = entry.course
    done = sum(1 for item in entry.lessons if state.lesson_status[(course.id, item.lesson.id)] == unlock.COMPLETED)
    resume_to = unlock.next_lesson(entry, _last_opened(entry, progress), state)
    pending = [item for item in entry.lessons if state.lesson_status[(course.id, item.lesson.id)] != unlock.COMPLETED]
    return CourseSummary(
        id=course.id,
        title=course.title,
        track=course.track,  # type: ignore[arg-type]
        summary=course.summary,
        source=entry.source,  # type: ignore[arg-type]
        lesson_count=len(entry.lessons),
        completed_count=done,
        locked=state.course_locked[course.id],
        requires=[
            catalog.courses[other].course.title for other in course.requires if not state.course_done.get(other, False)
        ],
        next_lesson_id=resume_to.lesson.id if resume_to else None,
        minutes_left=sum(_minutes(item.lesson) for item in pending),
        stars=sum(_stars(progress.get((course.id, item.lesson.id))) for item in entry.lessons),
        max_stars=3 * len(entry.lessons),
    )


def _last_opened(entry: CourseEntry, progress: dict[tuple[str, str], Progress]) -> str:
    rows = [
        (row.last_opened_at, item.lesson.id)
        for item in entry.lessons
        if (row := progress.get((entry.course.id, item.lesson.id))) is not None
    ]
    return max(rows)[1] if rows else ""


@router.get("/api/courses", response_model=CourseList, tags=["lessons"], responses=AUTH_RESPONSES)
def list_courses(ctx: AppContext = Depends(context), user: Principal = Depends(principal)):
    catalog = _catalog(ctx).load()
    progress = _repo(ctx).all(user.user_id)
    state = unlock.standing(catalog, progress)
    # Nothing to continue until a lesson has been opened.
    where = unlock.resume(catalog, progress, state) if progress else None
    resume = None
    if where is not None:
        entry = catalog.courses[where[0]]
        resume = LessonResume(
            course_id=where[0],
            course_title=entry.course.title,
            lesson_id=where[1],
            lesson_title=_find_lesson(entry, where[1]).lesson.title,
        )
    can_edit = _can_edit(ctx, user)
    return CourseList(
        courses=[_course_summary(entry, catalog, state, progress) for entry in catalog.ordered()],
        resume=resume,
        can_edit=can_edit,
        problems=catalog.problems if can_edit else [],
    )


@router.get("/api/courses/{course_id}", response_model=CourseDetail, tags=["lessons"], responses=AUTH_RESPONSES)
def get_course(course_id: str, ctx: AppContext = Depends(context), user: Principal = Depends(principal)):
    catalog = _catalog(ctx).load()
    entry = _find_course(catalog, course_id)
    progress = _repo(ctx).all(user.user_id)
    state = unlock.standing(catalog, progress)
    levels: list[CourseLevel] = []
    titles = dict(entry.course.levels)
    for item in entry.lessons:
        if not levels or levels[-1].id != item.level:
            levels.append(CourseLevel(id=item.level, title=titles.get(item.level, item.level), lessons=[]))
        lesson = item.lesson
        levels[-1].lessons.append(
            LessonSummary(
                id=lesson.id,
                title=lesson.title,
                summary=lesson.summary,
                status=state.lesson_status[(course_id, lesson.id)],  # type: ignore[arg-type]
                source=item.source,  # type: ignore[arg-type]
                has_pass_condition=lesson.pass_condition is not None,
                pass_condition=_condition(lesson.pass_condition),
                requires=item.requires,
                minutes=_minutes(lesson),
                stars=_stars(progress.get((course_id, lesson.id))),
            )
        )
    summary = _course_summary(entry, catalog, state, progress)
    return CourseDetail(**summary.model_dump(), levels=levels)


def _detail(
    ctx: AppContext, user: Principal, catalog: Catalog, course_id: str, lesson_id: str, *, refuse_locked: bool = True
) -> tuple[LessonDetail, unlock.Standing]:
    entry = _find_course(catalog, course_id)
    item = _find_lesson(entry, lesson_id)
    progress = _repo(ctx).all(user.user_id)
    state = unlock.standing(catalog, progress)
    status = state.lesson_status[(course_id, lesson_id)]
    if refuse_locked and status == unlock.LOCKED:
        raise api_error(403, "lesson.locked", "finish the lessons before this one to open it")
    following = unlock.next_lesson(entry, lesson_id, state)
    lesson = item.lesson
    detail = LessonDetail(
        course_id=course_id,
        course_title=entry.course.title,
        id=lesson.id,
        title=lesson.title,
        summary=lesson.summary,
        status=status,  # type: ignore[arg-type]
        source=item.source,  # type: ignore[arg-type]
        blocks=_blocks(lesson),
        pass_condition=_condition(lesson.pass_condition),
        progress=_model(progress.get((course_id, lesson_id))),
        next_lesson_id=following.lesson.id if following and following.lesson.id != lesson_id else None,
        can_edit=_can_edit(ctx, user),
    )
    return detail, state


@router.get(
    "/api/courses/{course_id}/lessons/{lesson_id}",
    response_model=LessonDetail,
    tags=["lessons"],
    responses=AUTH_RESPONSES,
)
def get_lesson(
    course_id: str, lesson_id: str, ctx: AppContext = Depends(context), user: Principal = Depends(principal)
):
    return _detail(ctx, user, _catalog(ctx).load(), course_id, lesson_id)[0]


@router.post(
    "/api/courses/{course_id}/lessons/{lesson_id}/open",
    status_code=204,
    tags=["lessons"],
    responses=AUTH_RESPONSES,
)
def open_lesson(
    course_id: str, lesson_id: str, ctx: AppContext = Depends(context), user: Principal = Depends(principal)
):
    """Remember that the caller opened the lesson, so "continue where you left off" can return to it."""
    _detail(ctx, user, _catalog(ctx).load(), course_id, lesson_id)
    _repo(ctx).opened(user.user_id, course_id, lesson_id)
    return Response(status_code=204)


def _finish(
    ctx: AppContext,
    user: Principal,
    course_id: str,
    lesson_id: str,
    *,
    score: float | None,
    bpm: float | None,
    passed: bool,
) -> LessonProgressResult:
    row = _repo(ctx).record(user.user_id, course_id, lesson_id, score=score, bpm=bpm, passed=passed)
    detail, _ = _detail(ctx, user, _catalog(ctx).load(), course_id, lesson_id, refuse_locked=False)
    return LessonProgressResult(
        passed=row.completed_at is not None, progress=_model(row), next_lesson_id=detail.next_lesson_id
    )


@router.post(
    "/api/courses/{course_id}/lessons/{lesson_id}/progress",
    response_model=LessonProgressResult,
    tags=["lessons"],
    responses=AUTH_RESPONSES,
)
def report_progress(
    course_id: str,
    lesson_id: str,
    body: LessonProgressBody,
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
):
    """Report a result the player measured. It completes the lesson when it meets the pass condition.

    A lesson with no pass condition is completed by sending ``completed: true``. A pass condition that names a
    library song is read from the practice log instead (``/check``), so this refuses to take a result for it.
    """
    detail, _ = _detail(ctx, user, _catalog(ctx).load(), course_id, lesson_id)
    condition = detail.pass_condition
    if condition is None:
        return _finish(ctx, user, course_id, lesson_id, score=body.score, bpm=body.bpm, passed=body.completed)
    if condition.song:
        raise api_error(400, "lesson.useCheck", "this lesson is checked against your practice log")
    result = Result(score=body.score, bpm=body.bpm, wait_completed=body.wait_completed)
    met = passes(PassCondition(condition.type, condition.min_score, condition.min_bpm), result)
    return _finish(ctx, user, course_id, lesson_id, score=body.score, bpm=body.bpm, passed=met)


@router.post(
    "/api/courses/{course_id}/lessons/{lesson_id}/check",
    response_model=LessonProgressResult,
    tags=["lessons"],
    responses=AUTH_RESPONSES,
)
def check_lesson(
    course_id: str, lesson_id: str, ctx: AppContext = Depends(context), user: Principal = Depends(principal)
):
    """Look in the practice log for a run of the lesson's song that meets its pass condition."""
    detail, _ = _detail(ctx, user, _catalog(ctx).load(), course_id, lesson_id)
    condition = detail.pass_condition
    if condition is None or not condition.song:
        raise api_error(400, "lesson.noSong", "this lesson has no song to check")
    practice = _repo(ctx).best_practice(user.user_id, condition.song)
    if not practice["found"]:
        raise api_error(404, "song.notFound", "song not found")
    rule = PassCondition(condition.type, condition.min_score, condition.min_bpm)
    runs = practice["runs"]
    good = [run for run in runs if passes(rule, Result(score=run[0], bpm=run[1], wait_completed=practice["waited"]))]
    if rule.type == "wait":
        met, score, bpm = practice["waited"], None, None
    else:
        met = bool(good)
        best = max(good or runs, key=lambda run: run[0], default=(None, None))
        score, bpm = best
    return _finish(ctx, user, course_id, lesson_id, score=score, bpm=bpm, passed=met)


# -- editing ------------------------------------------------------------------------------------------------


def _invalid(exc: LessonFormatError):
    if exc.line is None:
        return api_error(400, "lesson.invalidNoLine", f"{exc}", reason=exc.message)
    return api_error(400, "lesson.invalid", f"{exc}", reason=exc.message, line=exc.line)


@router.post("/api/lessons/preview", response_model=LessonPreview, tags=["lessons"], responses=AUTH_RESPONSES)
def preview(body: LessonTextBody, _: Principal = Depends(editor)):
    """Parse lesson text exactly as saving would, without saving, for the editor's preview."""
    try:
        lesson = parse_lesson(body.text, "preview")
    except LessonFormatError as exc:
        raise _invalid(exc) from exc
    return LessonPreview(
        title=lesson.title,
        summary=lesson.summary,
        blocks=_blocks(lesson),
        pass_condition=_condition(lesson.pass_condition),
    )


@router.get(
    "/api/courses/{course_id}/lessons/{lesson_id}/source",
    response_model=LessonSource,
    tags=["lessons"],
    responses=AUTH_RESPONSES,
)
def get_lesson_source(
    course_id: str, lesson_id: str, ctx: AppContext = Depends(context), _: Principal = Depends(editor)
):
    try:
        text, source = _catalog(ctx).lesson_text(course_id, lesson_id)
    except UnknownLesson as exc:
        raise api_error(404, "lesson.notFound", "lesson not found") from exc
    return LessonSource(text=text, source=source)  # type: ignore[arg-type]


@router.put(
    "/api/courses/{course_id}/lessons/{lesson_id}/source",
    response_model=LessonSource,
    tags=["lessons"],
    responses=AUTH_RESPONSES,
)
def put_lesson_source(
    course_id: str,
    lesson_id: str,
    body: LessonTextBody,
    ctx: AppContext = Depends(context),
    _: Principal = Depends(editor),
):
    """Create or replace a lesson. A built-in lesson is overridden by a copy in the lessons folder."""
    try:
        _catalog(ctx).save_lesson(course_id, lesson_id, body.text)
    except UnknownCourse as exc:
        raise api_error(404, "course.notFound", "course not found") from exc
    except LessonFormatError as exc:
        raise _invalid(exc) from exc
    return LessonSource(text=body.text, source="user")


@router.delete(
    "/api/courses/{course_id}/lessons/{lesson_id}",
    status_code=204,
    tags=["lessons"],
    responses=AUTH_RESPONSES,
)
def delete_lesson(course_id: str, lesson_id: str, ctx: AppContext = Depends(context), _: Principal = Depends(editor)):
    """Delete the lesson's file in the lessons folder; a built-in lesson it overrode comes back."""
    try:
        _catalog(ctx).delete_lesson(course_id, lesson_id)
    except UnknownLesson as exc:
        raise api_error(404, "lesson.notFound", "lesson not found") from exc
    except NotRemovable as exc:
        raise api_error(409, "lesson.builtin", "built-in lessons cannot be deleted") from exc
    return Response(status_code=204)


@router.get("/api/courses/{course_id}/source", response_model=LessonSource, tags=["lessons"], responses=AUTH_RESPONSES)
def get_course_source(course_id: str, ctx: AppContext = Depends(context), _: Principal = Depends(editor)):
    try:
        text, source = _catalog(ctx).course_text(course_id)
    except UnknownCourse as exc:
        raise api_error(404, "course.notFound", "course not found") from exc
    return LessonSource(text=text, source=source)  # type: ignore[arg-type]


@router.put("/api/courses/{course_id}/source", response_model=LessonSource, tags=["lessons"], responses=AUTH_RESPONSES)
def put_course_source(
    course_id: str, body: LessonTextBody, ctx: AppContext = Depends(context), _: Principal = Depends(editor)
):
    """Create or replace a course's ``course.md`` in the lessons folder."""
    try:
        _catalog(ctx).save_course(course_id, body.text)
    except LessonFormatError as exc:
        raise _invalid(exc) from exc
    return LessonSource(text=body.text, source="user")


@router.delete("/api/courses/{course_id}", status_code=204, tags=["lessons"], responses=AUTH_RESPONSES)
def delete_course(course_id: str, ctx: AppContext = Depends(context), _: Principal = Depends(editor)):
    """Delete a course from the lessons folder (every lesson in it); a built-in course it overrode comes back."""
    try:
        _catalog(ctx).delete_course(course_id)
    except UnknownCourse as exc:
        raise api_error(404, "course.notFound", "course not found") from exc
    except NotRemovable as exc:
        raise api_error(409, "lesson.builtin", "built-in lessons cannot be deleted") from exc
    return Response(status_code=204)


@router.post("/api/lessons/import", response_model=LessonPackResult, tags=["lessons"], responses=AUTH_RESPONSES)
async def import_pack(file: UploadFile = File(...), ctx: AppContext = Depends(context), _: Principal = Depends(editor)):
    """Add the courses and lessons of a zip pack (``<course>/course.md`` and ``<course>/<lesson>.md``)."""
    data = await file.read(MAX_PACK_BYTES + 1)
    if len(data) > MAX_PACK_BYTES:
        raise api_error(413, "lessons.packTooLarge", "the pack is too large", megabytes=MAX_PACK_BYTES // (1024 * 1024))
    with tempfile.TemporaryDirectory(prefix="lesson-pack-") as scratch:
        archive = Path(scratch) / "pack.zip"
        archive.write_bytes(data)
        try:
            courses, lessons = _catalog(ctx).import_pack(archive)
        except ImportFailed as exc:
            raise api_error(400, exc.key, str(exc), **exc.params) from exc
        except PackError as exc:
            raise api_error(400, exc.key, str(exc), **exc.params) from exc
    return LessonPackResult(courses=courses, lessons=lessons)
