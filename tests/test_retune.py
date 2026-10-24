"""Transpose, retune and convert a track. Scores here are built by hand; none is a real song."""

import pytest

from fretbook.score.model import Beat, Note, Track, TrackBar, Voice
from fretbook.score.retune import convert_track

STANDARD = [64, 59, 55, 50, 45, 40]
BASS4 = [43, 38, 33, 28]
BASS5 = [43, 38, 33, 28, 23]
DROP_D = [64, 59, 55, 50, 45, 38]


def beat(position: int, *notes: Note, duration: int = 960) -> Beat:
    return Beat(position=position, duration=duration, notes=list(notes))


def make_track(bars: list[list[Beat]], tuning=STANDARD, capo=0, instrument="guitar") -> Track:
    return Track(
        id="t1",
        name="Part",
        instrument=instrument,
        capo=capo,
        tuning_midi=list(tuning),
        bars=[TrackBar(voices=[Voice(beats=beats)]) for beats in bars],
    )


def spots(track: Track) -> list[list[tuple[int, int]]]:
    return [[(note.string, note.fret) for note in beat.notes] for bar in track.bars for beat in bar.voices[0].beats]


def pitches(track: Track) -> list[list[int]]:
    return [
        [track.tuning_midi[note.string] + track.capo + note.fret for note in beat.notes]
        for bar in track.bars
        for beat in bar.voices[0].beats
    ]


def test_transpose_keeps_strings_when_the_notes_fit() -> None:
    track = make_track([[beat(0, Note(string=5, fret=3)), beat(960, Note(string=4, fret=2))]])
    result = convert_track(track, semitones=2)
    assert spots(result.track) == [[(5, 5)], [(4, 4)]]
    assert result.report.refretted == 2
    assert result.report.shifted_bars == []
    assert spots(track) == [[(5, 3)], [(4, 2)]]  # the source is untouched


def test_transpose_refrets_a_note_that_falls_off_the_neck() -> None:
    track = make_track([[beat(0, Note(string=0, fret=22))]])
    result = convert_track(track, semitones=5)
    # Fret 22 + 5 is past the end of the neck on the high E, so the note goes to another string or octave.
    ((_, fret),) = spots(result.track)[0]
    assert 0 <= fret <= 24
    assert (pitches(result.track)[0][0] - (64 + 22 + 5)) % 12 == 0
    assert result.report.shifted_bars == [1]


def test_transpose_down_off_the_bottom_moves_an_octave() -> None:
    track = make_track([[beat(0, Note(string=5, fret=0))]])
    result = convert_track(track, semitones=-7)
    assert pitches(result.track)[0][0] % 12 == (40 - 7) % 12
    assert result.report.shifted_bars == [1]


def test_chord_that_no_longer_fits_the_hand_is_refingered() -> None:
    e_chord = [Note(string=5, fret=0), Note(string=4, fret=2), Note(string=3, fret=2), Note(string=2, fret=1)]
    track = make_track([[beat(0, *e_chord)]])
    result = convert_track(track, semitones=5)
    assert sorted(pitches(result.track)[0]) == sorted(p + 5 for p in pitches(track)[0])
    frets = [fret for _, fret in spots(result.track)[0] if fret > 0]
    assert max(frets) - min(frets) <= 4


def test_retune_to_drop_d_keeps_the_pitches() -> None:
    track = make_track([[beat(0, Note(string=5, fret=2)), beat(960, Note(string=4, fret=0))]])
    result = convert_track(track, tuning=DROP_D)
    assert pitches(result.track) == pitches(track)
    assert spots(result.track) == [[(5, 4)], [(4, 0)]]
    assert result.track.tuning_midi == DROP_D


def test_retune_keeping_shapes_keeps_the_frets() -> None:
    track = make_track([[beat(0, Note(string=5, fret=3), Note(string=4, fret=2))]])
    result = convert_track(track, tuning=[63, 58, 54, 49, 44, 39], keep="shape")
    assert spots(result.track) == spots(track)
    assert pitches(result.track)[0] == [p - 1 for p in pitches(track)[0]]


def test_shape_mode_with_semitones_retunes_every_string() -> None:
    track = make_track([[beat(0, Note(string=5, fret=3))]])
    result = convert_track(track, semitones=2, keep="shape")
    assert result.track.tuning_midi == [pitch + 2 for pitch in STANDARD]
    assert spots(result.track) == spots(track)


def test_shape_mode_with_a_capo_keeps_frets_and_raises_pitch() -> None:
    track = make_track([[beat(0, Note(string=5, fret=3))]])
    result = convert_track(track, capo=2, keep="shape")
    assert result.track.capo == 2
    assert pitches(result.track)[0] == [pitches(track)[0][0] + 2]


def test_shape_mode_needs_the_same_string_count() -> None:
    track = make_track([[beat(0, Note(string=0, fret=1))]])
    with pytest.raises(ValueError):
        convert_track(track, tuning=BASS4, keep="shape")


def test_pitch_mode_with_a_new_capo_lowers_the_frets() -> None:
    track = make_track([[beat(0, Note(string=5, fret=5))]])
    result = convert_track(track, capo=2)
    assert spots(result.track) == [[(5, 3)]]
    assert pitches(result.track) == pitches(track)


def test_bass_4_to_5_string_keeps_everything_in_place() -> None:
    track = make_track(
        [[beat(0, Note(string=3, fret=0)), beat(960, Note(string=2, fret=3))]], tuning=BASS4, instrument="bass-guitar"
    )
    result = convert_track(track, tuning=BASS5)
    assert spots(result.track) == spots(track)
    assert result.track.tuning_midi == BASS5


def test_bass_5_to_4_string_moves_the_low_b_up_an_octave() -> None:
    track = make_track([[beat(0, Note(string=4, fret=0))]], tuning=BASS5, instrument="bass-guitar")
    result = convert_track(track, tuning=BASS4)
    assert result.report.shifted_bars == [1]
    assert pitches(result.track)[0][0] % 12 == 23 % 12


def test_guitar_6_to_7_string() -> None:
    track = make_track([[beat(0, Note(string=5, fret=0))]])
    result = convert_track(track, tuning=[*STANDARD, 35])
    assert spots(result.track) == [[(5, 0)]]
    assert len(result.track.tuning_midi) == 7


def test_guitar_to_bass_lowest_voice_an_octave_down() -> None:
    chord = [Note(string=5, fret=3), Note(string=4, fret=2), Note(string=3, fret=0)]
    track = make_track([[beat(0, *chord)]])
    result = convert_track(track, tuning=BASS4, semitones=-12, reduce="lowest")
    assert result.report.reduced == 2
    # The lowest note is G2 (43, fret 3 on the low E); an octave down is G1 (31), fret 3 on a bass's low E.
    assert pitches(result.track) == [[31]]
    assert len(result.track.tuning_midi) == 4


def test_ties_follow_a_note_that_moves() -> None:
    track = make_track(
        [[beat(0, Note(string=5, fret=3)), beat(960, Note(string=5, fret=3, tie=True))]],
    )
    result = convert_track(track, tuning=DROP_D)
    assert spots(result.track) == [[(5, 5)], [(5, 5)]]
    assert result.track.bars[0].voices[0].beats[1].notes[0].tie


def test_a_tie_follows_a_note_that_was_refingered() -> None:
    track = make_track([[beat(0, Note(string=0, fret=22)), beat(960, Note(string=0, fret=22, tie=True))]])
    result = convert_track(track, semitones=5)
    first, second = spots(result.track)
    assert first == second


def test_dead_notes_and_techniques_survive() -> None:
    track = make_track(
        [[beat(0, Note(string=5, fret=0, dead=True)), beat(960, Note(string=4, fret=7, palm_mute=True, vibrato=True))]]
    )
    result = convert_track(track, semitones=1)
    dead, plain = result.track.bars[0].voices[0].beats
    assert dead.notes[0].dead
    assert plain.notes[0].palm_mute and plain.notes[0].vibrato


def test_a_moved_natural_harmonic_becomes_a_plain_note() -> None:
    track = make_track([[beat(0, Note(string=4, fret=12, harmonic="natural"))]])
    result = convert_track(track, semitones=2)
    assert result.track.bars[0].voices[0].beats[0].notes[0].harmonic is None
    assert result.report.techniques_dropped == 1


def test_rests_voices_and_bars_are_kept() -> None:
    track = make_track([[beat(0, Note(string=5, fret=1)), beat(960)], [beat(0)]])
    second = Beat(position=0, duration=960, notes=[Note(string=1, fret=0)])
    track.bars[0].voices.append(Voice(beats=[second]))
    result = convert_track(track, semitones=1)
    assert len(result.track.bars) == 2
    assert len(result.track.bars[0].voices) == 2
    assert result.track.bars[0].voices[0].beats[1].notes == []
    assert result.track.bars[0].voices[1].beats[0].notes[0].fret == 1


def test_a_track_with_no_change_is_identical() -> None:
    track = make_track([[beat(0, Note(string=5, fret=3), Note(string=4, fret=2)), beat(960, Note(string=2, fret=5))]])
    result = convert_track(track)
    assert result.track.model_dump() == track.model_dump()
    assert result.report.refretted == 0


def test_guitar_to_bass_lands_low_on_the_neck() -> None:
    # Open position riff on the D and A strings of a guitar: D3 (fret 2 on D is E3), then A2, then the open low E.
    track = make_track(
        [[beat(0, Note(string=3, fret=2)), beat(960, Note(string=4, fret=0)), beat(1920, Note(string=5, fret=0))]]
    )
    result = convert_track(track, tuning=BASS4, semitones=-12)
    assert pitches(result.track) == [[40], [33], [28]]
    # Not the same strings an octave up the neck: E2 is the D string at fret 2, A1 the open A string.
    assert spots(result.track) == [[(1, 2)], [(2, 0)], [(3, 0)]]
    assert all(fret <= 5 for ((_, fret),) in spots(result.track))
