import json

import pytest
from pydantic import ValidationError

from fretbook.score.instruments import PRESETS, get_preset
from fretbook.score.model import (
    Bar,
    Beat,
    Note,
    ScoreDocument,
    Track,
    TrackBar,
    Voice,
    bar_seconds,
    content_hash,
    summary_fields,
)


def _track(tuning: list[int], string: int = 0, bars: int = 1, track_id: str = "t") -> Track:
    return Track(
        id=track_id,
        name="T",
        instrument="guitar" if len(tuning) >= 6 else "bass-guitar",
        tuning_midi=tuning,
        preferred=True,
        bars=[
            TrackBar(voices=[Voice(beats=[Beat(position=0, duration=960, notes=[Note(string=string, fret=0)])])])
            for _ in range(bars)
        ],
    )


def test_any_string_count_round_trips() -> None:
    for preset in PRESETS:
        document = ScoreDocument(bars=[Bar()], tracks=[_track(list(preset.tuning_midi))])
        again = ScoreDocument.model_validate_json(document.model_dump_json())
        assert len(again.tracks[0].tuning_midi) == len(preset.tuning_midi)


def test_string_index_must_fit_the_tuning() -> None:
    with pytest.raises(ValidationError):
        ScoreDocument(bars=[Bar()], tracks=[_track([43, 38, 33, 28], string=4)])


def test_every_track_has_one_entry_per_song_bar() -> None:
    with pytest.raises(ValidationError, match="bars"):
        ScoreDocument(bars=[Bar(), Bar()], tracks=[_track([43, 38, 33, 28], bars=1)])


def test_track_ids_are_unique() -> None:
    with pytest.raises(ValidationError, match="duplicate"):
        ScoreDocument(bars=[Bar()], tracks=[_track([43, 38, 33, 28]), _track([43, 38, 33, 28])])


@pytest.mark.parametrize("value", ["NaN", "Infinity", "-Infinity"])
def test_non_finite_numbers_are_refused(value: str) -> None:
    document = ScoreDocument(bars=[Bar()], tracks=[_track([43, 38, 33, 28])])
    raw = json.loads(document.model_dump_json())
    text = json.dumps(raw).replace('"anchors": {}', f'"anchors": {{"0": {value}}}')
    with pytest.raises(ValidationError):
        ScoreDocument.model_validate_json(text)
    raw["bpm"] = float(value.replace("Infinity", "inf"))
    with pytest.raises(ValidationError):
        ScoreDocument.model_validate(raw)


def test_anchor_keys_are_bar_indexes() -> None:
    document = ScoreDocument(bars=[Bar()], tracks=[_track([43, 38, 33, 28])])
    raw = document.model_dump()
    raw["sync"]["anchors"] = {"x": 1.0}
    with pytest.raises(ValidationError):
        ScoreDocument.model_validate(raw)
    raw["sync"]["anchors"] = {"5": 1.0}
    with pytest.raises(ValidationError):
        ScoreDocument.model_validate(raw)


def test_opening_tempo_and_bar_lengths() -> None:
    document = ScoreDocument(
        bpm=120,
        bars=[Bar(tempo=60), Bar(signature=(3, 4)), Bar(tempo=120)],
        tracks=[_track([43, 38, 33, 28], bars=3)],
    )
    # A tempo on bar 0 becomes the opening tempo.
    assert document.bpm == 60 and document.bars[0].tempo is None
    assert bar_seconds(document) == [4.0, 3.0, 2.0]
    assert summary_fields(document)["measure_count"] == 3


def test_content_hash_ignores_sync_and_tempo() -> None:
    document = ScoreDocument(bars=[Bar()], tracks=[_track([43, 38, 33, 28])])
    before = content_hash(document)
    document.sync.anchors = {"0": 1.5}
    document.bpm = 90
    assert content_hash(document) == before
    document.tracks[0].bars[0].voices[0].beats[0].notes[0].fret = 5
    assert content_hash(document) != before


def test_known_presets() -> None:
    assert get_preset("guitar-6").tuning_midi[0] == 64
    assert get_preset("bass-5").tuning_midi[-1] == 23
    with pytest.raises(KeyError):
        get_preset("nope")
