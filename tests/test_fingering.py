import pytest

from fretbook.score.fingering import assign_frets

GUITAR = (64, 59, 55, 50, 45, 40)
BASS = (43, 38, 33, 28)
DROP_D = (64, 59, 55, 50, 45, 38)


def sounded(tuning, capo, placement):
    return tuning[placement.string] + capo + placement.fret


def test_every_placement_sounds_the_requested_pitch():
    pitches = [40, 45, 52, 59, 64, 67, 71, 76]
    result = assign_frets([[p] for p in pitches], GUITAR)
    assert [sounded(GUITAR, 0, g[0]) for g in result.groups] == pitches
    assert result.shifted == [] and result.dropped == []


def test_scale_run_stays_in_one_position():
    # A natural minor from A3 to A4: one hand position, no jumps up and down the neck.
    scale = [57, 59, 60, 62, 64, 65, 67, 69]
    result = assign_frets([[p] for p in scale], GUITAR)
    frets = [g[0].fret for g in result.groups if g[0].fret]
    assert max(frets) - min(frets) <= 4


def test_open_strings_are_used_when_they_cost_nothing():
    result = assign_frets([[40], [45], [50]], GUITAR)
    assert [(g[0].string, g[0].fret) for g in result.groups] == [(5, 0), (4, 0), (3, 0)]


def test_hand_stays_near_the_previous_note():
    # B3 can be fret 4 on the G string or fret 9 on the D string; after a note at fret 5-ish it stays close.
    result = assign_frets([[60], [62], [64], [59]], GUITAR)
    assert max(g[0].fret for g in result.groups) <= 5


def test_chord_uses_distinct_strings_within_the_stretch():
    e_major = [40, 47, 52, 56, 59, 64]
    result = assign_frets([e_major], GUITAR)
    placed = result.groups[0]
    assert len({p.string for p in placed}) == 6
    fretted = [p.fret for p in placed if p.fret]
    assert max(fretted) - min(fretted) <= 4
    assert sorted(sounded(GUITAR, 0, p) for p in placed) == sorted(e_major)


def test_chord_too_wide_drops_inner_notes_and_reports_it():
    wide = [40, 52, 64, 75]  # nothing forms a four-fret grip with the upper notes
    result = assign_frets([wide], GUITAR, max_stretch=0)
    assert result.dropped == [0]
    assert 0 < len(result.groups[0]) < len(wide)
    assert all(sounded(GUITAR, 0, placed) == placed.pitch for placed in result.groups[0])
    assert len({placed.string for placed in result.groups[0]}) == len(result.groups[0])


def test_pitches_below_the_instrument_move_up_an_octave():
    result = assign_frets([[40], [26]], BASS)
    assert result.shifted == [1]
    assert sounded(BASS, 0, result.groups[1][0]) == 38
    assert result.groups[1][0].pitch == 38


def test_pitch_above_the_neck_moves_down():
    result = assign_frets([[100]], GUITAR)
    assert result.shifted == [0]
    assert 64 <= result.groups[0][0].pitch <= 88


def test_range_edges_are_reachable_without_shifting():
    low, high = 28, 43 + 24
    result = assign_frets([[low], [high]], BASS)
    assert result.shifted == []
    assert (result.groups[0][0].string, result.groups[0][0].fret) == (3, 0)
    assert (result.groups[1][0].string, result.groups[1][0].fret) == (0, 24)


def test_capo_raises_the_open_strings():
    result = assign_frets([[66], [47]], GUITAR, capo=2)
    first = result.groups[0][0]
    assert (first.string, first.fret) == (0, 0)
    assert sounded(GUITAR, 2, result.groups[1][0]) == 47
    # below the capo: nothing in range, so it moves up an octave
    below = assign_frets([[41]], GUITAR, capo=2)
    assert below.shifted == [0]


def test_four_string_bass_prefers_low_frets():
    result = assign_frets([[28], [31], [33], [35]], BASS)
    assert [(g[0].string, g[0].fret) for g in result.groups] == [(3, 0), (3, 3), (2, 0), (2, 2)]


def test_drop_tuning_uses_the_low_string():
    result = assign_frets([[38], [38 + 7]], DROP_D)
    assert [(g[0].string, g[0].fret) for g in result.groups] == [(5, 0), (4, 0)]
    low_fifth = assign_frets([[38 + 5]], DROP_D)
    assert (low_fifth.groups[0][0].string, low_fifth.groups[0][0].fret) in {(5, 5), (4, 0)}


def test_empty_groups_and_no_input():
    assert assign_frets([], GUITAR).groups == []
    result = assign_frets([[]], GUITAR)
    assert result.groups == [[]]


def test_empty_tuning_is_refused():
    with pytest.raises(ValueError):
        assign_frets([[40]], ())
