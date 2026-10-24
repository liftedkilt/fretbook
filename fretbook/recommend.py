"""What to practise next, from the practice log and the songs' difficulty.

Three kinds of suggestion, all computed from rows the caller gathers (see ``PracticeRepository.recommendations``):

* **Stretch**: tabs a little harder than the level the player has recently shown, that they have barely played.
  The level is the median difficulty of the songs they scored at least :data:`GOOD_SCORE` on in the last
  :data:`LEVEL_DAYS` days; with no scored sessions, of the songs they practised. With neither, the easiest tabs.
* **Revisit**: loops whose latest scored attempt was below :data:`LOW_SCORE`.
* **Review**: songs due again under a spaced-repetition schedule. The gap after the last practice day doubles with
  every distinct day a song has been practised (1, 2, 4, 8 ... days), up to :data:`MAX_INTERVAL_DAYS`.
"""

from __future__ import annotations

from datetime import date, timedelta
from statistics import median
from typing import Any

GOOD_SCORE = 80.0
LOW_SCORE = 70.0
LEVEL_DAYS = 30
LOOP_DAYS = 60
STRETCH_RANGE = 1.5
"""A stretch suggestion is above the player's level by at most this much."""
FEW_SESSIONS = 2
"""Songs practised more than this many times are not suggested as something new to try."""
EASY_LEVEL = 3.0
MAX_INTERVAL_DAYS = 60
LIMIT = 6


def review_interval(practice_days: int) -> int:
    """Days to wait after the last practice before a song is due again."""
    return min(MAX_INTERVAL_DAYS, 2 ** max(0, practice_days - 1))


def build(
    songs: list[dict[str, Any]],
    scored: list[dict[str, Any]],
    today: date,
) -> dict[str, Any]:
    """Suggestions as of ``today``.

    ``songs`` has one dict per tab or chord sheet: ``song_id``, ``title``, ``artist``, ``content_kind``,
    ``difficulty`` (or ``None``), ``session_count``, ``practice_days`` and ``last_day`` (or ``None`` when never
    practised). ``scored`` has one dict per scored session: ``song_id``, ``loop_name``, ``loop_start``,
    ``loop_end``, ``day``, ``score``, newest first.
    """
    level, basis = _level(songs, scored, today)
    return {
        "level": level,
        "level_basis": basis,
        "stretch": _stretch(songs, level, today),
        "revisit": _revisit(songs, scored, today),
        "review": _review(songs, today),
    }


def _brief(song: dict[str, Any]) -> dict[str, Any]:
    return {key: song[key] for key in ("song_id", "title", "artist", "content_kind", "difficulty")}


def _level(songs: list[dict[str, Any]], scored: list[dict[str, Any]], today: date) -> tuple[float | None, str]:
    by_id = {song["song_id"]: song for song in songs}
    since = (today - timedelta(days=LEVEL_DAYS)).isoformat()
    recent: dict[str, list[float]] = {}
    for item in scored:
        if item["day"] >= since:
            recent.setdefault(item["song_id"], []).append(item["score"])
    shown = [
        by_id[song_id]["difficulty"]
        for song_id, scores in recent.items()
        if song_id in by_id and by_id[song_id]["difficulty"] is not None and sum(scores) / len(scores) >= GOOD_SCORE
    ]
    if shown:
        return round(float(median(shown)), 1), "scored"
    practised = [
        song["difficulty"]
        for song in songs
        if song["difficulty"] is not None and song["last_day"] is not None and song["last_day"] >= since
    ]
    if practised:
        return round(float(median(practised)), 1), "practised"
    return None, "none"


def _stretch(songs: list[dict[str, Any]], level: float | None, today: date) -> list[dict[str, Any]]:
    recent = (today - timedelta(days=LEVEL_DAYS)).isoformat()
    options = [
        song
        for song in songs
        if song["difficulty"] is not None
        and song["session_count"] <= FEW_SESSIONS
        and (song["last_day"] is None or song["last_day"] < recent)
    ]
    if level is None:
        options = [song for song in options if song["difficulty"] <= EASY_LEVEL]
        options.sort(key=lambda song: (song["difficulty"], song["title"].lower()))
    else:
        options = [song for song in options if level < song["difficulty"] <= level + STRETCH_RANGE]
        options.sort(key=lambda song: (song["difficulty"], song["title"].lower()))
    return [_brief(song) for song in options[:LIMIT]]


def _revisit(songs: list[dict[str, Any]], scored: list[dict[str, Any]], today: date) -> list[dict[str, Any]]:
    by_id = {song["song_id"]: song for song in songs}
    since = (today - timedelta(days=LOOP_DAYS)).isoformat()
    loops: dict[tuple[str, str, int, int], list[dict[str, Any]]] = {}
    for item in scored:
        if item["loop_start"] is None or item["loop_end"] is None or item["song_id"] not in by_id:
            continue
        key = (item["song_id"], item["loop_name"], item["loop_start"], item["loop_end"])
        loops.setdefault(key, []).append(item)
    found = []
    for (song_id, name, start, end), attempts in loops.items():
        latest = attempts[0]
        if latest["day"] < since or latest["score"] >= LOW_SCORE:
            continue
        found.append(
            {
                **_brief(by_id[song_id]),
                "loop_name": name,
                "loop_start": start,
                "loop_end": end,
                "score": latest["score"],
                "last_day": latest["day"],
                "attempts": len(attempts),
            }
        )
    found.sort(key=lambda item: (item["score"], item["title"].lower(), item["loop_start"]))
    return found[:LIMIT]


def _review(songs: list[dict[str, Any]], today: date) -> list[dict[str, Any]]:
    due = []
    for song in songs:
        if song["last_day"] is None:
            continue
        gap = (today - date.fromisoformat(song["last_day"])).days
        interval = review_interval(song["practice_days"])
        if gap >= interval and gap > 0:
            due.append(
                {**_brief(song), "last_day": song["last_day"], "interval_days": interval, "_late": gap / interval}
            )
    due.sort(key=lambda item: (-item["_late"], item["title"].lower()))
    for item in due:
        del item["_late"]
    return due[:LIMIT]
