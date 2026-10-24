"""Which lessons a user can open, and where "continue" should take them. Pure functions over the catalogue."""

from __future__ import annotations

from dataclasses import dataclass

from fretbook.lessons.catalog import Catalog, CourseEntry, LessonEntry
from fretbook.storage.lessons import Progress

LOCKED = "locked"
AVAILABLE = "available"
COMPLETED = "completed"


@dataclass
class Standing:
    course_locked: dict[str, bool]
    lesson_status: dict[tuple[str, str], str]
    course_done: dict[str, bool]


def standing(catalog: Catalog, progress: dict[tuple[str, str], Progress]) -> Standing:
    done = {key for key, row in progress.items() if row.completed_at}
    course_done = {
        course_id: bool(entry.lessons) and all((course_id, item.lesson.id) in done for item in entry.lessons)
        for course_id, entry in catalog.courses.items()
    }
    course_locked = {
        course_id: not all(course_done.get(other, False) for other in entry.course.requires)
        for course_id, entry in catalog.courses.items()
    }
    status: dict[tuple[str, str], str] = {}
    for course_id, entry in catalog.courses.items():
        for item in entry.lessons:
            key = (course_id, item.lesson.id)
            if key in done:
                status[key] = COMPLETED
            elif course_locked[course_id] or any((course_id, other) not in done for other in item.requires):
                status[key] = LOCKED
            else:
                status[key] = AVAILABLE
    return Standing(course_locked, status, course_done)


def next_lesson(entry: CourseEntry, current: str, state: Standing) -> LessonEntry | None:
    """The first open lesson after ``current`` (or from the start when it is the last), in course order."""
    ids = [item.lesson.id for item in entry.lessons]
    start = ids.index(current) + 1 if current in ids else 0
    for item in [*entry.lessons[start:], *entry.lessons[:start]]:
        if state.lesson_status[(entry.course.id, item.lesson.id)] == AVAILABLE:
            return item
    return None


def resume(catalog: Catalog, progress: dict[tuple[str, str], Progress], state: Standing) -> tuple[str, str] | None:
    """The lesson to "continue" with: the one opened last and not yet done, else the one after it."""
    open_now = [(row.last_opened_at, key) for key, row in progress.items() if state.lesson_status.get(key) == AVAILABLE]
    if open_now:
        return max(open_now)[1]
    recent = sorted(
        ((row.last_opened_at, key) for key, row in progress.items() if key in state.lesson_status), reverse=True
    )
    for _, (course_id, lesson_id) in recent:
        found = next_lesson(catalog.courses[course_id], lesson_id, state)
        if found is not None:
            return course_id, found.lesson.id
    for entry in catalog.ordered():
        found = next_lesson(entry, "", state)
        if found is not None:
            return entry.course.id, found.lesson.id
    return None
