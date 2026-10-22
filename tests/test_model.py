import pytest
from pydantic import ValidationError

from fretbook.score.instruments import PRESETS, get_preset
from fretbook.score.model import Beat, Measure, Note, ScoreDocument, Track, Voice


def _track(tuning: list[int], string: int = 0) -> Track:
    return Track(
        id="t",
        name="T",
        instrument="guitar" if len(tuning) >= 6 else "bass-guitar",
        tuning_midi=tuning,
        preferred=True,
        measures=[
            Measure(
                voices=[
                    Voice(beats=[Beat(position=0, duration=1, notes=[Note(string=string, fret=0)])])
                ]
            )
        ],
    )


def test_any_string_count_round_trips() -> None:
    for preset in PRESETS:
        document = ScoreDocument(tracks=[_track(list(preset.tuning_midi))])
        again = ScoreDocument.model_validate_json(document.model_dump_json())
        assert len(again.tracks[0].tuning_midi) == len(preset.tuning_midi)


def test_string_index_must_fit_the_tuning() -> None:
    with pytest.raises(ValidationError):
        ScoreDocument(tracks=[_track([43, 38, 33, 28], string=4)])


def test_known_presets() -> None:
    assert get_preset("guitar-6").tuning_midi[0] == 64
    assert get_preset("bass-5").tuning_midi[-1] == 23
    with pytest.raises(KeyError):
        get_preset("nope")
