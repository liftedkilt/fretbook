"""Piecewise-linear measure timing.

This is the sync model of the original bass-tab-sync player: tapped anchors
(or Songsterr video points used as anchors) define measure start times, and
the gaps are interpolated. The frontend sends the same numbers to alphaTab as
flat sync points. Keep the two implementations on these vectors.
"""

from __future__ import annotations


def measure_starts(measure_count: int, bpm: float, anchors: dict[int, float]) -> list[float]:
    """Return ``measure_count + 1`` times: each measure start, then the end.

    With no anchors every measure is one 4-beat bar at ``bpm``. That matches
    the original player (``L = 240 / bpm``), including when the written meter
    is not 4/4. Once anchors exist, interior measures are interpolated and the
    ends are extrapolated.
    """
    if measure_count < 0:
        raise ValueError("measure_count must be >= 0")
    if bpm <= 0:
        raise ValueError("bpm must be positive")
    bar = 240 / bpm
    ordered = sorted(anchors)
    starts = [0.0] * (measure_count + 1)
    if not ordered:
        for index in range(measure_count + 1):
            starts[index] = index * bar
        return starts

    def at(index: int) -> float:
        return anchors[index]

    last = ordered[-1]
    for index in range(measure_count + 1):
        if index <= ordered[0]:
            starts[index] = at(ordered[0]) - (ordered[0] - index) * bar
        elif index >= last:
            if len(ordered) > 1:
                previous = ordered[-2]
                step = (at(last) - at(previous)) / (last - previous)
            else:
                step = bar
            starts[index] = at(last) + (index - last) * step
        else:
            cursor = 0
            while ordered[cursor + 1] <= index:
                cursor += 1
            left = ordered[cursor]
            right = ordered[cursor + 1]
            fraction = (index - left) / (right - left)
            starts[index] = at(left) + fraction * (at(right) - at(left))
    return starts


def measure_at(starts: list[float], time_seconds: float) -> int:
    """Measure index containing ``time_seconds``, or -1 before the first start."""
    count = len(starts) - 1
    if count <= 0 or time_seconds < starts[0]:
        return -1
    low = 0
    high = count - 1
    while low < high:
        mid = (low + high + 1) // 2
        if starts[mid] <= time_seconds:
            low = mid
        else:
            high = mid - 1
    if time_seconds >= starts[count]:
        return count
    return low


def coerce_anchors(raw: dict[str, float] | dict[int, float]) -> dict[int, float]:
    anchors: dict[int, float] = {}
    for key, value in raw.items():
        anchors[int(key)] = float(value)
    return anchors
