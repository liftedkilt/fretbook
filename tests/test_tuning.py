from fretbook.score.tuning import labels_to_midi, midi_to_name


def test_bass_and_guitar_letter_names() -> None:
    assert labels_to_midi(["G", "D", "A", "E"]) == [43, 38, 33, 28]
    assert labels_to_midi(["E", "B", "G", "D", "A", "E"]) == [64, 59, 55, 50, 45, 40]


def test_octave_on_the_first_string_is_kept() -> None:
    assert labels_to_midi(["G2", "D", "A", "E"]) == [43, 38, 33, 28]
    assert midi_to_name(40) == "E2"
    assert midi_to_name(43) == "G2"


def test_flats_and_five_string_bass() -> None:
    assert labels_to_midi(["Bb1", "F", "C", "G", "D"]) == [34, 29, 24, 19, 14]
