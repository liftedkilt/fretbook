"""Tests for playback order expansion.

Mirrors web/src/lib/playback.test.ts with the same test cases.
"""

from fretbook.score.model import Bar
from fretbook.score.playback import first_played, occurrences, played_bars


def test_linear_bars_without_repeats() -> None:
    bars = [Bar(), Bar(), Bar(), Bar()]
    assert played_bars(bars) == [0, 1, 2, 3]


def test_simple_repeat() -> None:
    # 4 bars, bars 1-2 repeat once (play twice)
    bars = [
        Bar(),
        Bar(repeat_start=True),
        Bar(repeat_end=2),
        Bar(),
    ]
    assert played_bars(bars) == [0, 1, 2, 1, 2, 3]


def test_repeat_three_times() -> None:
    # Repeat section plays 3 times
    bars = [
        Bar(repeat_start=True),
        Bar(repeat_end=3),
        Bar(),
    ]
    assert played_bars(bars) == [0, 1, 0, 1, 0, 1, 2]


def test_implicit_repeat_start_at_song_beginning() -> None:
    # repeat_end with no preceding repeat_start repeats from bar 0
    bars = [
        Bar(),
        Bar(repeat_end=2),
        Bar(),
    ]
    assert played_bars(bars) == [0, 1, 0, 1, 2]


def test_alternate_endings_1_and_2() -> None:
    # Bar 0: Intro
    # Bar 1: Repeat start
    # Bar 2: 1st ending, repeat_end=2
    # Bar 3: 2nd ending
    # Bar 4: Outro
    bars = [
        Bar(),
        Bar(repeat_start=True),
        Bar(alternate_endings=[1], repeat_end=2),
        Bar(alternate_endings=[2]),
        Bar(),
    ]
    assert played_bars(bars) == [0, 1, 2, 1, 3, 4]


def test_alternate_endings_multi_bar() -> None:
    # 1st ending spans bars 1 and 2
    bars = [
        Bar(repeat_start=True),
        Bar(alternate_endings=[1]),
        Bar(repeat_end=2),
        Bar(alternate_endings=[2]),
        Bar(),
    ]
    assert played_bars(bars) == [0, 1, 2, 0, 3, 4]


def test_da_capo_al_fine() -> None:
    # Bar 0: Start
    # Bar 1: Fine
    # Bar 2: D.C. al Fine
    bars = [
        Bar(),
        Bar(directions=["fine"]),
        Bar(directions=["da_capo_al_fine"]),
    ]
    assert played_bars(bars) == [0, 1, 2, 0, 1]


def test_dal_segno_al_coda() -> None:
    # Bar 0: Intro
    # Bar 1: Segno
    # Bar 2: To Coda (da_coda)
    # Bar 3: D.S. al Coda
    # Bar 4: Coda
    # Bar 5: Outro
    bars = [
        Bar(),
        Bar(directions=["segno"]),
        Bar(directions=["da_coda"]),
        Bar(directions=["dal_segno_al_coda"]),
        Bar(directions=["coda"]),
        Bar(),
    ]
    assert played_bars(bars) == [0, 1, 2, 3, 1, 2, 4, 5]


def test_dal_segno_al_fine() -> None:
    # Bar 0: Intro
    # Bar 1: Segno
    # Bar 2: Fine
    # Bar 3: D.S. al Fine
    bars = [
        Bar(),
        Bar(directions=["segno"]),
        Bar(directions=["fine"]),
        Bar(directions=["dal_segno_al_fine"]),
    ]
    assert played_bars(bars) == [0, 1, 2, 3, 1, 2]


def test_occurrences_helper() -> None:
    order = [0, 1, 2, 1, 3, 4]
    assert occurrences(order) == [0, 0, 0, 1, 0, 0]


def test_first_played_helper() -> None:
    order = [0, 1, 2, 1, 3, 4]
    assert first_played(order, 5) == [0, 1, 2, 4, 5]
    # Bar 5 is never played:
    assert first_played(order, 6) == [0, 1, 2, 4, 5, 6]
