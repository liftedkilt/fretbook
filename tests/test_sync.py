"""The original player's measure timing, including extrapolation."""

from fretbook.score.sync import measure_at, measure_starts


def test_even_bars_when_nothing_is_tapped() -> None:
    # L = 240 / 120 = 2 seconds, four measures plus the end.
    assert measure_starts(4, 120, {}) == [0.0, 2.0, 4.0, 6.0, 8.0]


def test_one_anchor_extrapolates_both_ends() -> None:
    starts = measure_starts(4, 120, {2: 10.0})
    assert starts == [6.0, 8.0, 10.0, 12.0, 14.0]


def test_two_anchors_interpolate() -> None:
    starts = measure_starts(4, 120, {1: 5.0, 3: 11.0})
    assert starts == [3.0, 5.0, 8.0, 11.0, 14.0]


def test_string_keys_and_measure_lookup() -> None:
    starts = measure_starts(2, 60, {0: 1.0, 2: 5.0})
    assert starts == [1.0, 3.0, 5.0]
    assert measure_at(starts, 0.5) == -1
    assert measure_at(starts, 1.0) == 0
    assert measure_at(starts, 2.9) == 0
    assert measure_at(starts, 3.0) == 1
    assert measure_at(starts, 5.0) == 2
    assert measure_at(starts, 9.0) == 2


def test_rejects_bad_input() -> None:
    try:
        measure_starts(-1, 120, {})
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError")
