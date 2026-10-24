"""The lesson file format: front matter, a Markdown body, and fenced ``fretbook:`` blocks.

This module is pure (no files, no database) so authors, the editor preview and the loader share one parser.
Every problem is a :class:`LessonFormatError` with the line it was found on.

Front matter is a strict subset of YAML, enough for what a lesson needs and nothing that can surprise an
author: ``key: value`` scalars, ``key: [a, b]`` inline lists, and a block list of ``- item`` lines under a key.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

ID_PATTERN = re.compile(r"[a-z0-9][a-z0-9-]{0,63}")
TRACKS = ("guitar", "bass")
BLOCK_KINDS = ("chord", "fretboard", "song", "tab", "exercise", "media", "pass")
MAX_TITLE = 200
MAX_SUMMARY = 500
MAX_LEVELS = 50
MAX_TEXT = 200_000
MAX_TAB = 4_000
MAX_PASS_BPM = 400

_KEY = re.compile(r"[a-z][a-z0-9_]*")
_FENCE = re.compile(r"^(`{3,}|~{3,})\s*fretbook:([a-z]+)\s*$")
_PRESET = re.compile(r"[A-Za-z][A-Za-z0-9]{0,40}")
_NOTE = re.compile(r"[A-G][#b]?")
_INSTRUMENTS = ("guitar", "bass", "ukulele")
_SCALES = ("major", "minor", "major-pentatonic", "minor-pentatonic", "blues")


class LessonFormatError(ValueError):
    def __init__(self, message: str, line: int | None = None) -> None:
        super().__init__(f"line {line}: {message}" if line else message)
        self.message = message
        self.line = line


@dataclass
class PassCondition:
    """What counts as having learned the lesson.

    ``score``: a scored run of ``song`` (or a result the player reports) of at least ``min_score`` percent,
    at ``min_bpm`` or faster when given. ``wait``: wait mode finished.
    """

    type: str
    min_score: float | None = None
    min_bpm: float | None = None
    song: str = ""


@dataclass
class Block:
    """A piece of the body: ``markdown`` text (in ``text``), or an embedded block with ``params``."""

    kind: str
    text: str = ""
    params: dict[str, str] = field(default_factory=dict)


@dataclass
class Lesson:
    id: str
    title: str
    summary: str
    level: str
    order: int
    requires: list[str] | None
    """Lesson ids that must be done first. ``None`` means "the lesson before this one"; ``[]`` means none."""
    blocks: list[Block]
    pass_condition: PassCondition | None


@dataclass
class Course:
    id: str
    title: str
    track: str
    summary: str
    levels: list[tuple[str, str]]
    requires: list[str]
    """Course ids that must be finished before this course opens."""


# Words the app uses in its own lesson addresses (/lessons/new, /lessons/<course>/edit).
RESERVED_IDS = ("new", "edit")


def valid_id(value: str) -> bool:
    return ID_PATTERN.fullmatch(value) is not None and value not in RESERVED_IDS


def _check_id(value: str, what: str, line: int | None = None) -> str:
    if not valid_id(value):
        raise LessonFormatError(
            f"{what} {value!r} must be lowercase letters, digits and dashes (at most 64), and not new or edit", line
        )
    return value


def split_front_matter(text: str) -> tuple[dict[str, str | list[str]], dict[str, int], list[str], int]:
    """The front matter as ``(values, line numbers by key, body lines, first body line number)``."""
    if len(text) > MAX_TEXT:
        raise LessonFormatError("the file is too large")
    lines = text.replace("\r\n", "\n").replace("\r", "\n").lstrip("﻿").split("\n")
    if not lines or lines[0].strip() != "---":
        raise LessonFormatError("a file must start with a front matter line of three dashes (---)", 1)
    values: dict[str, str | list[str]] = {}
    where: dict[str, int] = {}
    key: str | None = None
    end: int | None = None
    for index in range(1, len(lines)):
        number = index + 1
        raw = lines[index]
        stripped = raw.strip()
        if stripped == "---":
            end = index
            break
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.startswith("- "):
            current = values.get(key) if key else None
            if key is None or (current != "" and not isinstance(current, list)):
                raise LessonFormatError("a list item needs a key with no value before it", number)
            if current == "":
                current = values[key] = []
            assert isinstance(current, list)
            current.append(_scalar(stripped[2:], number))
            continue
        name, colon, rest = raw.partition(":")
        name = name.strip()
        if not colon or not _KEY.fullmatch(name):
            raise LessonFormatError("expected `key: value`", number)
        if name in values:
            raise LessonFormatError(f"{name!r} is given twice", number)
        rest = rest.strip()
        key = name
        where[name] = number
        if rest.startswith("["):
            values[name] = _inline_list(rest, number)
        else:
            values[name] = _scalar(rest, number)
    if end is None:
        raise LessonFormatError("the front matter is never closed with a line of three dashes (---)")
    return values, where, lines[end + 1 :], end + 2


def _scalar(raw: str, line: int) -> str:
    raw = raw.strip()
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in "\"'":
        return raw[1:-1]
    if raw and raw[0] in "\"'":
        raise LessonFormatError("a quoted value is missing its closing quote", line)
    return raw


def _inline_list(raw: str, line: int) -> list[str]:
    if not raw.endswith("]"):
        raise LessonFormatError("a list is missing its closing ]", line)
    inner = raw[1:-1].strip()
    return [_scalar(part, line) for part in inner.split(",") if part.strip()] if inner else []


def _text(values: dict, where: dict, key: str, *, required: bool = False, limit: int = MAX_TITLE) -> str:
    value = values.get(key, "")
    if isinstance(value, list):
        raise LessonFormatError(f"{key!r} must be a single value, not a list", where.get(key))
    if required and not value:
        raise LessonFormatError(f"{key!r} is required")
    if len(value) > limit:
        raise LessonFormatError(f"{key!r} is too long (at most {limit} characters)", where.get(key))
    return value


def _list(values: dict, where: dict, key: str) -> list[str] | None:
    if key not in values:
        return None
    value = values[key]
    if isinstance(value, str):
        if value == "":
            return []
        raise LessonFormatError(f"{key!r} must be a list such as [a, b]", where.get(key))
    return value


def _integer(values: dict, where: dict, key: str, default: int) -> int:
    raw = _text(values, where, key)
    if not raw:
        return default
    try:
        number = int(raw)
    except ValueError:
        raise LessonFormatError(f"{key!r} must be a whole number", where.get(key)) from None
    if not 0 <= number <= 100_000:
        raise LessonFormatError(f"{key!r} must be between 0 and 100000", where.get(key))
    return number


def parse_course(text: str, course_id: str) -> Course:
    values, where, _body, _first = split_front_matter(text)
    _check_id(course_id, "course id")
    track = _text(values, where, "track", required=True)
    if track not in TRACKS:
        raise LessonFormatError(f"'track' must be one of: {', '.join(TRACKS)}", where.get("track"))
    levels: list[tuple[str, str]] = []
    for item in _list(values, where, "levels") or []:
        level_id, colon, title = item.partition(":")
        level_id, title = level_id.strip(), title.strip()
        _check_id(level_id, "level id", where.get("levels"))
        if any(level_id == existing for existing, _ in levels):
            raise LessonFormatError(f"level {level_id!r} is listed twice", where.get("levels"))
        levels.append((level_id, title if colon and title else level_id))
    if len(levels) > MAX_LEVELS:
        raise LessonFormatError(f"a course has at most {MAX_LEVELS} levels", where.get("levels"))
    requires = _list(values, where, "requires") or []
    for other in requires:
        _check_id(other, "required course id", where.get("requires"))
    if course_id in requires:
        raise LessonFormatError("a course cannot require itself", where.get("requires"))
    return Course(
        id=course_id,
        title=_text(values, where, "title", required=True),
        track=track,
        summary=_text(values, where, "summary", limit=MAX_SUMMARY),
        levels=levels,
        requires=requires,
    )


def parse_lesson(text: str, lesson_id: str) -> Lesson:
    values, where, body, first_line = split_front_matter(text)
    _check_id(lesson_id, "lesson id")
    requires = _list(values, where, "requires")
    for other in requires or []:
        _check_id(other, "required lesson id", where.get("requires"))
    if lesson_id in (requires or []):
        raise LessonFormatError("a lesson cannot require itself", where.get("requires"))
    level = _text(values, where, "level")
    if level:
        _check_id(level, "level id", where.get("level"))
    blocks, pass_condition = _parse_body(body, first_line)
    return Lesson(
        id=lesson_id,
        title=_text(values, where, "title", required=True),
        summary=_text(values, where, "summary", limit=MAX_SUMMARY),
        level=level,
        order=_integer(values, where, "order", 0),
        requires=requires,
        blocks=blocks,
        pass_condition=pass_condition,
    )


def _parse_body(lines: list[str], first_line: int) -> tuple[list[Block], PassCondition | None]:
    blocks: list[Block] = []
    pending: list[str] = []
    pass_condition: PassCondition | None = None

    def flush() -> None:
        text = "\n".join(pending).strip("\n")
        pending.clear()
        if text.strip():
            blocks.append(Block("markdown", text=text))

    index = 0
    while index < len(lines):
        match = _FENCE.match(lines[index])
        if match is None:
            pending.append(lines[index])
            index += 1
            continue
        fence, kind = match.groups()
        opened = first_line + index
        if kind not in BLOCK_KINDS:
            raise LessonFormatError(f"unknown block fretbook:{kind} (known: {', '.join(BLOCK_KINDS)})", opened)
        end = index + 1
        while end < len(lines) and lines[end].strip() != fence:
            end += 1
        if end >= len(lines):
            raise LessonFormatError(f"the fretbook:{kind} block is never closed with {fence}", opened)
        flush()
        inner = lines[index + 1 : end]
        block = _block(kind, inner, opened)
        if kind == "pass":
            if pass_condition is not None:
                raise LessonFormatError("a lesson can have only one fretbook:pass block", opened)
            pass_condition = _pass_condition(block.params, opened)
        blocks.append(block)
        index = end + 1
    flush()
    return blocks, pass_condition


def _params(lines: list[str], first_line: int) -> dict[str, str]:
    params: dict[str, str] = {}
    for offset, raw in enumerate(lines):
        if not raw.strip() or raw.strip().startswith("#"):
            continue
        name, colon, rest = raw.partition(":")
        name = name.strip()
        if not colon or not _KEY.fullmatch(name):
            raise LessonFormatError("expected `key: value`", first_line + offset)
        if name in params:
            raise LessonFormatError(f"{name!r} is given twice", first_line + offset)
        params[name] = _scalar(rest, first_line + offset)
    return params


def _only(kind: str, params: dict[str, str], allowed: tuple[str, ...], line: int) -> None:
    extra = sorted(set(params) - set(allowed))
    if extra:
        raise LessonFormatError(
            f"fretbook:{kind} does not take {', '.join(extra)} (it takes {', '.join(allowed)})", line
        )


def _block(kind: str, inner: list[str], first_line: int) -> Block:
    if kind == "tab":
        text = "\n".join(inner).strip("\n")
        if not text.strip():
            raise LessonFormatError("the fretbook:tab block is empty", first_line)
        if len(text) > MAX_TAB:
            raise LessonFormatError(f"the fretbook:tab block is too long (at most {MAX_TAB} characters)", first_line)
        return Block("tab", text=text)
    params = _params(inner, first_line + 1)
    line = first_line
    if kind == "chord":
        _only(kind, params, ("name", "instrument"), line)
        name = params.get("name", "")
        if not name or len(name) > 20:
            raise LessonFormatError("fretbook:chord needs a `name`, such as Am7", line)
        if params.setdefault("instrument", "guitar") not in _INSTRUMENTS:
            raise LessonFormatError(f"`instrument` must be one of: {', '.join(_INSTRUMENTS)}", line)
    elif kind == "fretboard":
        _only(kind, params, ("notes", "root", "scale", "instrument"), line)
        if params.setdefault("instrument", "guitar") not in _INSTRUMENTS:
            raise LessonFormatError(f"`instrument` must be one of: {', '.join(_INSTRUMENTS)}", line)
        if "notes" in params:
            names = params["notes"].split()
            if not names or len(names) > 24 or any(not _NOTE.fullmatch(name) for name in names):
                raise LessonFormatError("`notes` must be note names such as `A C E` or `F# Bb`", line)
        elif "scale" in params:
            if params["scale"] not in _SCALES:
                raise LessonFormatError(f"`scale` must be one of: {', '.join(_SCALES)}", line)
            if not _NOTE.fullmatch(params.get("root", "")):
                raise LessonFormatError("a `scale` needs a `root` note such as A or F#", line)
        else:
            raise LessonFormatError("fretboard needs `notes`, or a `root` and a `scale`", line)
    elif kind == "song":
        _only(kind, params, ("song", "title"), line)
        if not params.get("song") or len(params["song"]) > 64:
            raise LessonFormatError("fretbook:song needs the `song` id from your library", line)
        if len(params.get("title", "")) > MAX_TITLE:
            raise LessonFormatError("`title` is too long", line)
    elif kind == "exercise":
        _only(kind, params, ("preset", "title"), line)
        if not _PRESET.fullmatch(params.get("preset", "")):
            raise LessonFormatError("fretbook:exercise needs a `preset` id from Tools → Exercises", line)
    elif kind == "media":
        _only(kind, params, ("type", "src", "title"), line)
        if params.get("type") not in ("video", "audio"):
            raise LessonFormatError("`type` must be video or audio", line)
        src = params.get("src", "")
        if not re.fullmatch(r"https?://[^\s<>\"']{1,1000}", src):
            raise LessonFormatError("`src` must be an http or https link", line)
    else:
        _only(kind, params, ("type", "min_score", "min_bpm", "song"), line)
    return Block(kind, params=params)


def _number(params: dict[str, str], key: str, low: float, high: float, line: int) -> float | None:
    if key not in params:
        return None
    try:
        number = float(params[key])
    except ValueError:
        raise LessonFormatError(f"`{key}` must be a number", line) from None
    if not low <= number <= high:
        raise LessonFormatError(f"`{key}` must be between {low:g} and {high:g}", line)
    return number


def _pass_condition(params: dict[str, str], line: int) -> PassCondition:
    kind = params.get("type", "")
    if kind not in ("score", "wait"):
        raise LessonFormatError("fretbook:pass needs `type: score` or `type: wait`", line)
    if kind == "wait" and ("min_score" in params or "min_bpm" in params):
        raise LessonFormatError("a wait pass condition takes no min_score or min_bpm", line)
    song = params.get("song", "")
    if len(song) > 64:
        raise LessonFormatError("`song` is too long", line)
    min_score = _number(params, "min_score", 0, 100, line)
    if kind == "score" and min_score is None:
        raise LessonFormatError("a score pass condition needs `min_score`", line)
    return PassCondition(
        type=kind,
        min_score=min_score,
        min_bpm=_number(params, "min_bpm", 1, MAX_PASS_BPM, line),
        song=song,
    )


@dataclass
class Result:
    """What a player reports after practising a lesson."""

    score: float | None = None
    bpm: float | None = None
    wait_completed: bool = False


def passes(condition: PassCondition, result: Result) -> bool:
    if condition.type == "wait":
        return result.wait_completed
    if result.score is None or condition.min_score is None or result.score < condition.min_score:
        return False
    return condition.min_bpm is None or (result.bpm is not None and result.bpm >= condition.min_bpm)
