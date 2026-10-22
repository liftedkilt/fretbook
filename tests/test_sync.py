"""Bar timing: the original player's vectors, plus real bar lengths."""

import pytest

from fretbook.score.sync import measure_at, measure_starts

FOUR_FOUR_120 = [2.0, 2.0, 2.0, 2.0]


def test_bars_follow_each_other_when_nothing_is_tapped() -> None:
    assert measure_starts(FOUR_FOUR_120, {}) == [0.0, 2.0, 4.0, 6.0, 8.0]


def test_one_anchor_extrapolates_both_ends() -> None:
    assert measure_starts(FOUR_FOUR_120, {2: 10.0}) == [6.0, 8.0, 10.0, 12.0, 14.0]


def test_two_anchors_interpolate() -> None:
    assert measure_starts(FOUR_FOUR_120, {1: 5.0, 3: 11.0}) == [3.0, 5.0, 8.0, 11.0, 14.0]


def test_real_bar_lengths() -> None:
    # 3/4 at 60 bpm is 3 seconds a bar, not the 4 the original player assumed.
    assert measure_starts([3.0, 3.0, 3.0], {}) == [0.0, 3.0, 6.0, 9.0]
    # Between anchors, a long bar takes a proportionally longer share.
    assert measure_starts([4.0, 2.0, 2.0], {0: 0.0, 3: 16.0}) == [0.0, 8.0, 12.0, 16.0]


def test_measure_lookup() -> None:
    starts = measure_starts([2.0, 2.0], {0: 1.0, 2: 5.0})
    assert starts == [1.0, 3.0, 5.0]
    assert measure_at(starts, 0.5) == -1
    assert measure_at(starts, 1.0) == 0
    assert measure_at(starts, 2.9) == 0
    assert measure_at(starts, 3.0) == 1
    assert measure_at(starts, 5.0) == 2
    assert measure_at(starts, 9.0) == 2


def test_rejects_bad_input() -> None:
    with pytest.raises(ValueError):
        measure_starts([2.0, 0.0], {})
