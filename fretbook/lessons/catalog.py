"""The lesson catalogue: built-in courses plus the ones in the user's lessons folder.

Layout, in both places::

    <root>/<course-id>/course.md
    <root>/<course-id>/<lesson-id>.md

A course or lesson in the user folder wins over a built-in one with the same id, lesson by lesson, so editing a
built-in lesson in the app writes an override and deleting that override brings the built-in one back. Mistakes in
a hand-written file never stop the others loading: they are collected as ``problems`` for the editors to read.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from fretbook.importers.zip_safety import safe_extract_zip
from fretbook.lessons.format import (
    Course,
    Lesson,
    LessonFormatError,
    parse_course,
    parse_lesson,
    valid_id,
)

BUILTIN_DIR = Path(__file__).parent / "builtin"
BUILTIN = "builtin"
USER = "user"
MAX_FILE_BYTES = 200_000
MAX_PACK_FILES = 500
COURSE_FILE = "course.md"


class UnknownCourse(Exception):
    pass


class UnknownLesson(Exception):
    pass


class NotRemovable(Exception):
    """A built-in lesson or course has no copy of the user's to delete."""


class PackError(Exception):
    def __init__(self, message: str, key: str = "lessons.badPack", **params) -> None:
        super().__init__(message)
        self.key = key
        self.params = params


@dataclass
class LessonEntry:
    lesson: Lesson
    source: str
    requires: list[str]
    """The effective prerequisites: the lesson before this one when the file names none."""
    level: str
    """The level it sits in; the course's first level when the file names none."""


@dataclass
class CourseEntry:
    course: Course
    source: str
    lessons: list[LessonEntry] = field(default_factory=list)


@dataclass
class Catalog:
    courses: dict[str, CourseEntry]
    problems: list[str]

    def ordered(self) -> list[CourseEntry]:
        return sorted(
            self.courses.values(), key=lambda entry: (entry.course.track, entry.course.title.lower(), entry.course.id)
        )


def _read(path: Path) -> str:
    if path.stat().st_size > MAX_FILE_BYTES:
        raise LessonFormatError("the file is too large")
    return path.read_text(encoding="utf-8")


class LessonCatalog:
    def __init__(self, builtin_dir: Path, user_dir: Path) -> None:
        self.builtin_dir = builtin_dir
        self.user_dir = user_dir

    # -- reading -----------------------------------------------------------------------------------------

    def load(self) -> Catalog:
        problems: list[str] = []
        sources: dict[str, dict] = {}
        for source, root in ((BUILTIN, self.builtin_dir), (USER, self.user_dir)):
            if not root.is_dir():
                continue
            for folder in sorted(root.iterdir()):
                if not folder.is_dir() or not valid_id(folder.name):
                    continue
                slot = sources.setdefault(folder.name, {"course": None, "lessons": {}})
                course_file = folder / COURSE_FILE
                if course_file.is_file():
                    try:
                        slot["course"] = (parse_course(_read(course_file), folder.name), source)
                    except (LessonFormatError, OSError, UnicodeDecodeError) as exc:
                        problems.append(f"{source}/{folder.name}/{COURSE_FILE}: {exc}")
                for path in sorted(folder.glob("*.md")):
                    if path.name == COURSE_FILE or not valid_id(path.stem):
                        continue
                    try:
                        slot["lessons"][path.stem] = (parse_lesson(_read(path), path.stem), source)
                    except (LessonFormatError, OSError, UnicodeDecodeError) as exc:
                        problems.append(f"{source}/{folder.name}/{path.name}: {exc}")
        courses: dict[str, CourseEntry] = {}
        for course_id, slot in sources.items():
            if slot["course"] is None:
                if slot["lessons"]:
                    problems.append(f"{course_id}: lessons without a {COURSE_FILE}")
                continue
            course, source = slot["course"]
            entry = CourseEntry(course, source)
            _place(entry, slot["lessons"], f"{course_id}", problems)
            courses[course_id] = entry
        _drop_course_cycles(courses, problems)
        return Catalog(courses, problems)

    def lesson_text(self, course_id: str, lesson_id: str) -> tuple[str, str]:
        """The raw file and where it came from: the user's copy when there is one."""
        for source, root in ((USER, self.user_dir), (BUILTIN, self.builtin_dir)):
            path = _file(root, course_id, lesson_id)
            if path is not None and path.is_file():
                return _read(path), source
        raise UnknownLesson(lesson_id)

    def course_text(self, course_id: str) -> tuple[str, str]:
        for source, root in ((USER, self.user_dir), (BUILTIN, self.builtin_dir)):
            path = _file(root, course_id, COURSE_FILE)
            if path is not None and path.is_file():
                return _read(path), source
        raise UnknownCourse(course_id)

    # -- writing (always into the user folder) -------------------------------------------------------------

    def save_course(self, course_id: str, text: str) -> Course:
        course = parse_course(text, course_id)
        _write(self.user_dir / course_id / COURSE_FILE, text)
        return course

    def save_lesson(self, course_id: str, lesson_id: str, text: str) -> Lesson:
        lesson = parse_lesson(text, lesson_id)
        entry = self.load().courses.get(course_id)
        if entry is None:
            raise UnknownCourse(course_id)
        known = {level for level, _ in entry.course.levels}
        if lesson.level and known and lesson.level not in known:
            raise LessonFormatError(f"level {lesson.level!r} is not one of the course's levels")
        _write(self.user_dir / course_id / f"{lesson_id}.md", text)
        return lesson

    def delete_lesson(self, course_id: str, lesson_id: str) -> None:
        path = _file(self.user_dir, course_id, lesson_id)
        if path is None or not path.is_file():
            builtin = _file(self.builtin_dir, course_id, lesson_id)
            if builtin is not None and builtin.is_file():
                raise NotRemovable(lesson_id)
            raise UnknownLesson(lesson_id)
        path.unlink()
        _prune(path.parent)

    def delete_course(self, course_id: str) -> None:
        folder = self.user_dir / course_id
        if not valid_id(course_id) or not folder.is_dir():
            if valid_id(course_id) and (self.builtin_dir / course_id).is_dir():
                raise NotRemovable(course_id)
            raise UnknownCourse(course_id)
        shutil.rmtree(folder)

    def import_pack(self, archive: Path) -> tuple[int, int]:
        """Add the courses and lessons in a zip pack; returns ``(courses, lessons)``. All or nothing."""
        with tempfile.TemporaryDirectory(prefix="lessons-") as scratch:
            extracted = safe_extract_zip(archive, Path(scratch))
            staged: dict[str, dict[str, str]] = {}
            count = 0
            for item in extracted:
                parts = Path(item.original_relpath).parts
                if len(parts) != 2 or not parts[1].endswith(".md"):
                    continue
                count += 1
                if count > MAX_PACK_FILES:
                    raise PackError(
                        f"a pack holds at most {MAX_PACK_FILES} lessons", "lessons.packTooLarge", limit=MAX_PACK_FILES
                    )
                course_id, name = parts[0], parts[1][:-3]
                try:
                    text = _read(item.path)
                    if name == "course":
                        parse_course(text, course_id)
                    else:
                        parse_lesson(text, name)
                except (LessonFormatError, UnicodeDecodeError) as exc:
                    raise PackError(
                        f"{item.original_relpath}: {exc}",
                        "lessons.packInvalid",
                        file=item.original_relpath,
                        reason=str(exc),
                    ) from exc
                staged.setdefault(course_id, {})[name] = text
            if not staged:
                raise PackError("the pack has no <course>/<lesson>.md files", "lessons.packEmpty")
            for course_id, files in staged.items():
                if "course" not in files and not (
                    (self.user_dir / course_id / COURSE_FILE).is_file()
                    or (self.builtin_dir / course_id / COURSE_FILE).is_file()
                ):
                    raise PackError(f"{course_id} has no course.md", "lessons.packNoCourse", course=course_id)
            for course_id, files in staged.items():
                for name, text in files.items():
                    _write(self.user_dir / course_id / f"{name}.md", text)
            return len(staged), sum(len(files) for files in staged.values())


def _file(root: Path, course_id: str, name: str) -> Path | None:
    if not valid_id(course_id) or not (name == COURSE_FILE or valid_id(name)):
        return None
    return root / course_id / (name if name == COURSE_FILE else f"{name}.md")


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temp = tempfile.mkstemp(dir=path.parent, prefix=".lesson-", suffix=".tmp")
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(text if text.endswith("\n") else text + "\n")
        os.replace(temp, path)
    except BaseException:
        Path(temp).unlink(missing_ok=True)
        raise


def _prune(folder: Path) -> None:
    """Remove a user course folder left with nothing in it."""
    try:
        folder.rmdir()
    except OSError:
        pass


def _place(entry: CourseEntry, found: dict[str, tuple[Lesson, str]], where: str, problems: list[str]) -> None:
    levels = [level for level, _ in entry.course.levels]
    placed: list[tuple[Lesson, str, str]] = []
    for lesson, source in found.values():
        level = lesson.level or (levels[0] if levels else "")
        if levels and level not in levels:
            problems.append(f"{where}/{lesson.id}.md: level {level!r} is not one of the course's levels")
            continue
        placed.append((lesson, source, level))
    placed.sort(key=lambda item: (levels.index(item[2]) if item[2] in levels else 0, item[0].order, item[0].id))
    ids = {lesson.id for lesson, _, _ in placed}
    previous = ""
    resolved: dict[str, list[str]] = {}
    for lesson, _, _ in placed:
        if lesson.requires is None:
            resolved[lesson.id] = [previous] if previous else []
        else:
            keep = []
            for other in lesson.requires:
                if other in ids:
                    keep.append(other)
                else:
                    problems.append(f"{where}/{lesson.id}.md: requires {other!r}, which is not a lesson in this course")
            resolved[lesson.id] = keep
        previous = lesson.id
    for cyclic in _cycle_members(resolved):
        problems.append(f"{where}/{cyclic}.md: its prerequisites loop back to it, so they are ignored")
        resolved[cyclic] = []
    entry.lessons = [LessonEntry(lesson, source, resolved[lesson.id], level) for lesson, source, level in placed]


def _cycle_members(graph: dict[str, list[str]]) -> set[str]:
    """Nodes that can reach themselves."""
    members: set[str] = set()
    for start in graph:
        seen: set[str] = set()
        stack = list(graph[start])
        while stack:
            node = stack.pop()
            if node == start:
                members.add(start)
                break
            if node in seen:
                continue
            seen.add(node)
            stack.extend(graph.get(node, []))
    return members


def _drop_course_cycles(courses: dict[str, CourseEntry], problems: list[str]) -> None:
    graph = {}
    for course_id, entry in courses.items():
        keep = []
        for other in entry.course.requires:
            if other in courses:
                keep.append(other)
            else:
                problems.append(f"{course_id}/{COURSE_FILE}: requires {other!r}, which is not a course")
        entry.course.requires = keep
        graph[course_id] = keep
    for cyclic in _cycle_members(graph):
        problems.append(f"{cyclic}/{COURSE_FILE}: its required courses loop back to it, so they are ignored")
        courses[cyclic].course.requires = []
