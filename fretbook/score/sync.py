"""Piecewise-linear bar timing.

This is the sync model of the original bass-tab-sync player, generalized to
real bar lengths: tapped anchors (or Songsterr video points used as anchors)
pin bar start times, and the bars in between are spread in proportion to
their natural length (signature and tempo). The frontend sends the same
numbers to alphaTab as flat sync points; ``web/src/lib/sync.ts`` is the same
algorithm, and both are tested on the same vectors.
"""

from __future__ import annotations


def measure_starts(bar_lengths: list[float], anchors: dict[int, float]) -> list[float]:
    """Return ``len(bar_lengths) + 1`` times: each bar start, then the end.

    ``bar_lengths`` are natural bar lengths in seconds. With no anchors the
    bars simply follow each other from zero. Before the first anchor bars keep
    their natural length; between two anchors they are scaled to fit; after
    the last anchor they keep the scale of the last anchored stretch.
    """
    if any(length <= 0 for length in bar_lengths):
        raise ValueError("bar lengths must be positive")
    count = len(bar_lengths)
    natural = [0.0]
    for length in bar_lengths:
        natural.append(natural[-1] + length)
    ordered = sorted(index for index in anchors if 0 <= index <= count)
    if not ordered:
        return natural

    def at(index: int) -> float:
        return float(anchors[index])

    first = ordered[0]
    last = ordered[-1]
    if len(ordered) > 1:
        previous = ordered[-2]
        tail_scale = (at(last) - at(previous)) / (natural[last] - natural[previous])
    else:
        tail_scale = 1.0
    starts = [0.0] * (count + 1)
    cursor = 0
    for index in range(count + 1):
        if index <= first:
            starts[index] = at(first) - (natural[first] - natural[index])
        elif index >= last:
            starts[index] = at(last) + tail_scale * (natural[index] - natural[last])
        else:
            while ordered[cursor + 1] <= index:
                cursor += 1
            left = ordered[cursor]
            right = ordered[cursor + 1]
            fraction = (natural[index] - natural[left]) / (natural[right] - natural[left])
            starts[index] = at(left) + fraction * (at(right) - at(left))
    return starts


def measure_at(starts: list[float], time_seconds: float) -> int:
    """Bar index containing ``time_seconds``; -1 before the first start, ``len(starts) - 1`` after the end."""
    count = len(starts) - 1
    if count <= 0 or time_seconds < starts[0]:
        return -1
    if time_seconds >= starts[count]:
        return count
    low = 0
    high = count - 1
    while low < high:
        mid = (low + high + 1) // 2
        if starts[mid] <= time_seconds:
            low = mid
        else:
            high = mid - 1
    return low

