"""The practice log: record sessions, the daily goal, the dashboard, and a song's history."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field

from fretbook.api.deps import context, principal
from fretbook.api.errors import api_error
from fretbook.api.schemas import AUTH_RESPONSES, ContentKind
from fretbook.auth.base import Principal
from fretbook.context import AppContext
from fretbook.storage.practice import (
    MAX_DAILY_MINUTES,
    MAX_SECONDS,
    MAX_SPEED,
    MIN_SECONDS,
    ExerciseInput,
    PracticeRepository,
    SessionInput,
    UnknownSong,
    parse_day,
)

router = APIRouter()

PracticeMode = Literal["free", "wait", "scored"]
ExerciseKind = Literal["fretboard", "interval", "chord", "rhythm"]
# Browsers are up to a day ahead or behind UTC; two days of slack covers that and a slow clock.
DAY_SLACK = timedelta(days=2)


class PracticeSessionBody(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    song_id: str = Field(max_length=64)
    day: str = Field(min_length=10, max_length=10)
    """The player's local date, ``YYYY-MM-DD``: what the heatmap and the streak count by."""
    duration_seconds: int = Field(ge=MIN_SECONDS, le=MAX_SECONDS)
    """Time spent playing, not time the page was open."""
    track_id: str = Field(default="", max_length=64)
    loop_name: str = Field(default="", max_length=200)
    loop_start: int | None = Field(default=None, ge=0, le=100_000)
    """0-based played bar the loop starts at."""
    loop_end: int | None = Field(default=None, ge=0, le=100_000)
    started_at: str | None = Field(default=None, max_length=40)
    """ISO 8601; the server's clock when absent."""
    speed: float = Field(default=1.0, gt=0, le=MAX_SPEED)
    """Playback speed as a ratio: 1 is the written tempo, 0.8 is 80 %."""
    mode: PracticeMode = "free"
    score: float | None = Field(default=None, ge=0, le=100)
    """Percent of notes hit, for ``scored`` sessions."""
    completed: bool = False
    """A ``wait`` session that played the whole song through (every step, from the first bar, no loop)."""


class PracticeExerciseBody(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    kind: ExerciseKind
    """Which trainer: finding notes on the fretboard, naming intervals or chord qualities, or a rhythm run."""
    day: str = Field(min_length=10, max_length=10)
    """The player's local date, ``YYYY-MM-DD``."""
    duration_seconds: int = Field(ge=MIN_SECONDS, le=MAX_SECONDS)
    started_at: str | None = Field(default=None, max_length=40)
    rounds: int = Field(default=0, ge=0, le=10_000)
    correct: int = Field(default=0, ge=0, le=10_000)
    score: float | None = Field(default=None, ge=0, le=100)
    """Percent of rounds answered correctly (for a rhythm run, the hit rate)."""
    pattern: str | None = Field(default=None, max_length=120)
    """Rhythm runs: the pattern drilled, a built-in pattern id or a song's bars."""
    bpm: int | None = Field(default=None, ge=1, le=1000)
    mean_error_ms: float | None = Field(default=None, ge=-5000, le=5000, allow_inf_nan=False)
    """Rhythm runs: mean signed timing error in milliseconds; positive is late."""


class PracticeExercise(BaseModel):
    id: str
    kind: ExerciseKind
    started_at: str
    day: str
    duration_seconds: int
    rounds: int
    correct: int
    score: float | None
    pattern: str | None = None
    bpm: int | None = None
    mean_error_ms: float | None = None


class PracticeExerciseStats(BaseModel):
    kind: ExerciseKind
    session_count: int
    total_seconds: int
    last_day: str
    best_score: float | None


class PracticeSession(BaseModel):
    id: str
    song_id: str
    track_id: str
    loop_name: str
    loop_start: int | None
    loop_end: int | None
    started_at: str
    day: str
    duration_seconds: int
    speed: float
    mode: PracticeMode
    score: float | None
    completed: bool


class PracticeGoalBody(BaseModel):
    daily_minutes: int = Field(ge=0, le=MAX_DAILY_MINUTES)
    """Minutes a day to aim for; 0 turns the goal off."""
    weekly_summary: bool = True


class PracticeGoal(BaseModel):
    daily_minutes: int
    weekly_summary: bool


class PracticeDay(BaseModel):
    day: str
    seconds: int
    sessions: int


class PracticeSongStats(BaseModel):
    song_id: str
    title: str
    artist: str
    content_kind: ContentKind
    session_count: int
    total_seconds: int
    last_practised: str
    last_day: str
    best_speed: float
    best_score: float | None


class PracticeWeek(BaseModel):
    seconds: int
    """The last seven days, today included."""
    previous_seconds: int
    """The seven days before those."""
    days_practised: int
    goal_days: int
    """Days of the last seven that reached the daily goal."""


class PracticeStats(BaseModel):
    today: str
    goal: PracticeGoal
    today_seconds: int
    current_streak: int
    longest_streak: int
    total_seconds: int
    songs_practised: int
    heatmap: list[PracticeDay]
    """The last 365 days that have any practice, oldest first."""
    week: PracticeWeek
    recent: list[PracticeSongStats]
    best_scores: list[PracticeSongStats]
    stale: list[PracticeSongStats]
    """Songs practised before, but not in the last two weeks, longest ago first."""
    exercises: list[PracticeExerciseStats]
    """Trainer games played, one row per game; their time is already in the totals above."""


class SuggestedSong(BaseModel):
    song_id: str
    title: str
    artist: str
    content_kind: ContentKind
    difficulty: float | None
    """1 to 10; null for a chord sheet."""


class ReviewSong(SuggestedSong):
    last_day: str
    interval_days: int
    """How long the spaced-repetition schedule waits after a practice day; the song is due once it has passed."""


class RevisitLoop(SuggestedSong):
    loop_name: str
    loop_start: int
    loop_end: int
    score: float
    """Percent of notes hit on the latest scored attempt."""
    last_day: str
    attempts: int


class Recommendations(BaseModel):
    level: float | None
    """The player's recent level, 1 to 10, or null with nothing to go on."""
    level_basis: Literal["scored", "practised", "none"]
    """`scored`: songs played at 80 % or better in the last 30 days. `practised`: songs practised in that time."""
    stretch: list[SuggestedSong]
    """Tabs a little above `level` that have had little practice; the easiest tabs when `level` is null."""
    revisit: list[RevisitLoop]
    """Loops whose latest scored attempt was under 70 %, lowest first."""
    review: list[ReviewSong]
    """Songs due again, most overdue first."""


class SongPractice(BaseModel):
    session_count: int
    total_seconds: int
    best_speed: float | None
    best_score: float | None
    last_practised: str | None
    sessions: list[PracticeSession]
    """The latest sessions, newest first."""


def _repo(ctx: AppContext) -> PracticeRepository:
    return PracticeRepository(ctx.settings)


def _day(value: str) -> date:
    try:
        parsed = parse_day(value)
    except ValueError as exc:
        raise api_error(400, "practice.badDay", "the day must be a date like 2026-01-31") from exc
    if abs(parsed - datetime.now(UTC).date()) > DAY_SLACK:
        raise api_error(400, "practice.badDay", "the day must be a date like 2026-01-31")
    return parsed


@router.post(
    "/api/practice/sessions",
    status_code=201,
    response_model=PracticeSession,
    tags=["practice"],
    responses=AUTH_RESPONSES,
)
def record_session(body: PracticeSessionBody, ctx: AppContext = Depends(context), user: Principal = Depends(principal)):
    day = _day(body.day)
    try:
        return _repo(ctx).record(
            user.user_id,
            SessionInput(
                song_id=body.song_id,
                day=day.isoformat(),
                duration_seconds=body.duration_seconds,
                track_id=body.track_id,
                loop_name=body.loop_name.strip(),
                loop_start=body.loop_start,
                loop_end=body.loop_end,
                started_at=body.started_at,
                speed=body.speed,
                mode=body.mode,
                score=body.score if body.mode == "scored" else None,
                completed=body.completed,
            ),
        )
    except UnknownSong as exc:
        raise api_error(404, "song.notFound", "song not found") from exc


@router.post(
    "/api/practice/exercises",
    status_code=201,
    response_model=PracticeExercise,
    tags=["practice"],
    responses=AUTH_RESPONSES,
)
def record_exercise(
    body: PracticeExerciseBody, ctx: AppContext = Depends(context), user: Principal = Depends(principal)
):
    return _repo(ctx).record_exercise(
        user.user_id,
        ExerciseInput(
            kind=body.kind,
            day=_day(body.day).isoformat(),
            duration_seconds=body.duration_seconds,
            rounds=body.rounds,
            correct=body.correct,
            score=body.score,
            started_at=body.started_at,
            pattern=body.pattern,
            bpm=body.bpm,
            mean_error_ms=body.mean_error_ms,
        ),
    )


@router.get("/api/practice/stats", response_model=PracticeStats, tags=["practice"], responses=AUTH_RESPONSES)
def practice_stats(
    today: Annotated[str | None, Query(max_length=10, description="The player's local date, YYYY-MM-DD.")] = None,
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
):
    return _repo(ctx).stats(user.user_id, _day(today) if today else datetime.now(UTC).date())


@router.get(
    "/api/practice/recommendations", response_model=Recommendations, tags=["practice"], responses=AUTH_RESPONSES
)
def practice_recommendations(
    today: Annotated[str | None, Query(max_length=10, description="The player's local date, YYYY-MM-DD.")] = None,
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
):
    """What to practise next: songs a little above the recent level, weak loops, and songs due for review."""
    return _repo(ctx).recommendations(user.user_id, _day(today) if today else datetime.now(UTC).date())


@router.get("/api/practice/goal", response_model=PracticeGoal, tags=["practice"], responses=AUTH_RESPONSES)
def get_goal(ctx: AppContext = Depends(context), user: Principal = Depends(principal)):
    return _repo(ctx).get_goal(user.user_id)


@router.put("/api/practice/goal", response_model=PracticeGoal, tags=["practice"], responses=AUTH_RESPONSES)
def set_goal(body: PracticeGoalBody, ctx: AppContext = Depends(context), user: Principal = Depends(principal)):
    return _repo(ctx).set_goal(user.user_id, body.daily_minutes, body.weekly_summary)


@router.get("/api/songs/{song_id}/practice", response_model=SongPractice, tags=["practice"], responses=AUTH_RESPONSES)
def song_practice(song_id: str, ctx: AppContext = Depends(context), user: Principal = Depends(principal)):
    history = _repo(ctx).song_history(user.user_id, song_id)
    if history is None:
        raise api_error(404, "song.notFound", "song not found")
    return history
