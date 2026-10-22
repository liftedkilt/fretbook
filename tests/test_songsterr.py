"""Songsterr port: default-instrument parts, grace notes, tuplets, repeats, sync warnings."""

import json
from pathlib import Path

import pytest

from fretbook.importers.base import ImportError, ImportRequest, silent_progress
from fretbook.importers.songsterr import (
    SongsterrImporter,
    _capo,
    apply_tempos,
    legacy_events,
    part_bars,
    track_instrument,
)
from fretbook.score.instruments import canonical_instrument
from fretbook.score.model import ScoreDocument

URL = "https://www.songsterr.com/a/wsa/fixture-song-s42"
BASS = {
    "name": "Bass",
    "instrument": "bass-guitar",
    "tuning": [43, 38, 33, 28],
    "automations": {"tempo": [{"measure": 0, "bpm": 120}]},
    "measures": [
        {
            "signature": [4, 4],
            "voices": [
                {
                    "beats": [
                        {
                            "duration": [1, 8],
                            "graceNote": "onBeat",
                            "notes": [{"string": 0, "fret": 5}],
                        },
                        {
                            "duration": [1, 4],
                            "notes": [
                                {"string": 0, "fret": 3, "slide": "shift"},
                                {"string": 1, "fret": 0},
                            ],
                        },
                        {"duration": [1, 4], "notes": [{"string": 2, "fret": 2}]},
                        {"duration": [1, 2], "notes": [{"string": 3, "fret": 0}]},
                    ]
                }
            ],
        },
        {"voices": [{"beats": [{"duration": [1, 1], "notes": []}]}]},
    ],
}
GUITAR = {
    "name": "Guitar",
    "instrument": "guitar",
    "tuning": [64, 59, 55, 50, 45, 40],
    "automations": {"tempo": [{"measure": 0, "bpm": 90}]},
    "measures": [
        {
            "signature": [4, 4],
            "voices": [{"beats": [{"duration": [1, 1], "notes": [{"string": 0, "fret": 0}]}]}],
        },
        {"voices": [{"beats": [{"duration": [1, 1], "notes": []}]}]},
    ],
}
PAGE = (
    '<html><script id="state">'
    + json.dumps(
        {
            "meta": {
                "current": {
                    "songId": 42,
                    "revisionId": 7,
                    "image": "img",
                    "title": "Fixture Song",
                    "artist": "Fixture Artist",
                    "tracks": [
                        {
                            "partId": 1,
                            "name": "Guitar",
                            "instrument": "Guitar",
                            "isGuitar": True,
                            "tuning": GUITAR["tuning"],
                        },
                        {
                            "partId": 2,
                            "name": "Bass",
                            "instrument": "Bass",
                            "isBassGuitar": True,
                            "tuning": BASS["tuning"],
                        },
                        {"partId": 3, "name": "Drums", "instrument": "Drums", "isDrums": True},
                    ],
                }
            }
        }
    )
    + '</script><script src="//cdn.example.cloudfront.net/app.js"></script></html>'
)
POINTS = [
    {"videoId": "aaaaaaaaaaa", "feature": "alternative", "points": [0.0, 2.0]},
    {"videoId": "bbbbbbbbbbb", "feature": None, "points": [0.4, 2.4]},
]


class FakeFetcher:
    def __init__(self) -> None:
        self.urls: list[str] = []

    def get_text(self, url: str) -> str:
        self.urls.append(url)
        if url == URL:
            return PAGE
        if url.endswith("/2.json"):
            return json.dumps(BASS)
        if url.endswith("/1.json"):
            return json.dumps(GUITAR)
        if url.endswith("/list"):
            return json.dumps(POINTS)
        raise AssertionError(url)


def _import(**options: object):
    fetcher = FakeFetcher()
    result = SongsterrImporter(fetcher).import_score(
        ImportRequest(owner_id="local", url=URL, options=options),
        silent_progress,
    )
    return fetcher, result


def test_default_is_bass_and_guitar_is_only_listed() -> None:
    fetcher, result = _import()
    assert result.title == "Fixture Song"
    document = result.document
    assert document.tracks[0].instrument == "bass-guitar"
    assert len(document.tracks) == 1
    assert [track["part_id"] for track in result.source_ref["available_tracks"]] == [1, 2]
    assert not any(url.endswith("/1.json") for url in fetcher.urls)
    assert any(url.endswith("/2.json") for url in fetcher.urls)
    assert document.sync.video_id == "bbbbbbbbbbb"
    assert result.audio is not None and result.audio.video_id == "bbbbbbbbbbb"
    beats = document.tracks[0].bars[0].voices[0].beats
    # The grace note shares the following beat's position and takes no time.
    assert (beats[0].position, beats[0].grace, beats[0].duration) == (0, "on_beat", 480)
    assert beats[1].position == 0
    assert beats[1].notes[0].slide == "shift"
    assert "slide" not in beats[1].notes[0].extras
    assert beats[2].position == 960
    assert [bar.signature for bar in document.bars] == [(4, 4), (4, 4)]


def test_guitar_default_instrument_picks_guitar_parts() -> None:
    fetcher, result = _import(prefer="guitar")
    assert [track.name for track in result.document.tracks] == ["Guitar"]
    assert result.document.tracks[0].preferred
    assert result.document.bpm == 90
    assert not any(url.endswith("/2.json") for url in fetcher.urls)


def test_legacy_events_still_let_grace_notes_consume_time() -> None:
    bpm, measures = legacy_events(BASS)
    assert bpm == 120
    length, events = measures[0]
    assert length == 4
    assert events[0] == [0, [[0, 5]]]
    assert events[1][0] == 0.5


def test_part_ids_import_guitar() -> None:
    _, result = _import(part_ids=[1])
    assert result.document.tracks[0].name == "Guitar"
    assert len(result.document.tracks[0].tuning_midi) == 6
    assert result.document.bpm == 90


def test_tuplets_repeats_and_tempo_changes() -> None:
    part = {
        "automations": {"tempo": [{"measure": 0, "bpm": 100}, {"measure": 1, "bpm": 80}]},
        "measures": [
            {
                "signature": [4, 4],
                "repeatStart": True,
                "marker": {"text": "Chorus"},
                "voices": [
                    {
                        "beats": [
                            {"duration": [1, 8], "tuplet": 3, "notes": [{"string": 0, "fret": 1}]},
                            {"duration": [1, 8], "tuplet": 3, "notes": [{"string": 0, "fret": 2}]},
                            {"duration": [1, 8], "tuplet": 3, "notes": [{"string": 0, "fret": 3, "hp": True}]},
                            {"duration": [3, 4], "notes": [{"string": 1, "fret": 0, "bend": {"tone": 100}}]},
                        ]
                    }
                ],
            },
            {"repeat": 2, "voices": [{"beats": [{"duration": [1, 1], "notes": []}]}]},
        ],
    }
    bars, track_bars = part_bars(part)
    bpm = apply_tempos(part, bars)
    beats = track_bars[0].voices[0].beats
    assert [(beat.position, beat.duration, beat.tuplet) for beat in beats] == [
        (0, 320, 3),
        (320, 320, 3),
        (640, 320, 3),
        (960, 2880, None),
    ]
    assert beats[2].notes[0].hammer is True
    assert beats[3].notes[0].bend == 2.0
    assert (bars[0].repeat_start, bars[0].section, bars[1].repeat_end) == (True, "Chorus", 2)
    assert (bpm, bars[1].tempo) == (100, 80)


def test_point_count_mismatch_warns() -> None:
    fetcher = FakeFetcher()
    original = POINTS[1]["points"]
    POINTS[1]["points"] = [0.4]
    try:
        result = SongsterrImporter(fetcher).import_score(
            ImportRequest(owner_id="local", url=URL),
            silent_progress,
        )
    finally:
        POINTS[1]["points"] = original
    assert [warning.key for warning in result.warnings] == ["import.syncCountMismatch"]


def test_unknown_video_and_bad_url() -> None:
    with pytest.raises(ImportError, match="video") as caught:
        _import(video_id="ccccccccccc")
    assert caught.value.key == "songsterr.noSuchVideo"
    with pytest.raises(ImportError, match="URL"):
        SongsterrImporter(FakeFetcher()).import_score(
            ImportRequest(owner_id="local", url="https://example.com/nope"),
            silent_progress,
        )


def test_document_validates() -> None:
    _, result = _import()
    ScoreDocument.model_validate(result.document.model_dump())


def test_bass_import_matches_the_recorded_document() -> None:
    """The bass part's notes, timing, tuning, and sync stay the recorded document."""
    _, result = _import()
    expected = json.loads(Path("tests/fixtures/songsterr-bass.json").read_text(encoding="utf-8"))
    assert result.document.model_dump(mode="json") == expected
    assert result.source_ref["part_ids"] == [2]
    assert result.document.tracks[0].capo == 0


STANDARD = [64, 59, 55, 50, 45, 40]
DROP_D = [64, 59, 55, 50, 45, 38]
SEVEN = [64, 59, 55, 50, 45, 40, 35]
MULTI_URL = "https://www.songsterr.com/a/wsa/multi-guitar-s99"


def _part(name: str, instrument: str, tuning: list[int], capo: int = 0, notes: list[dict] | None = None) -> dict:
    return {
        "name": name,
        "instrument": instrument,
        "tuning": tuning,
        "capo": capo,
        "automations": {"tempo": [{"measure": 0, "bpm": 100}]},
        "measures": [
            {
                "signature": [4, 4],
                "voices": [{"beats": [{"duration": [1, 4], "notes": notes or [{"string": 0, "fret": 0}]}]}],
            },
            {"voices": [{"beats": [{"duration": [1, 1], "notes": []}]}]},
        ],
    }


ACOUSTIC = _part("Acoustic", "Acoustic Guitar (steel)", STANDARD, capo=2)
ELECTRIC = _part("Lead", "Distortion Guitar", DROP_D, notes=[{"string": 5, "fret": 0}])
SEVEN_STRING = _part("Rhythm", "Electric Guitar (clean)", SEVEN, notes=[{"string": 6, "fret": 1}])
MULTI_PAGE = (
    '<html><script id="state">'
    + json.dumps(
        {
            "meta": {
                "current": {
                    "songId": 99,
                    "revisionId": 3,
                    "image": "img",
                    "title": "Multi",
                    "artist": "Fixture",
                    "tracks": [
                        {
                            "partId": 1,
                            "name": "Acoustic",
                            "instrument": "Acoustic Guitar (steel)",
                            "isGuitar": True,
                            "tuning": STANDARD,
                            "capo": 2,
                        },
                        {
                            "partId": 2,
                            "name": "Lead",
                            "instrument": "Distortion Guitar",
                            "isGuitar": True,
                            "tuning": DROP_D,
                        },
                        {
                            "partId": 3,
                            "name": "Rhythm",
                            "instrument": "Electric Guitar (clean)",
                            "isGuitar": True,
                            "tuning": SEVEN,
                        },
                        {
                            "partId": 4,
                            "name": "Bass",
                            "instrument": "Bass Guitar",
                            "isBassGuitar": True,
                            "tuning": BASS["tuning"],
                        },
                        {"partId": 5, "name": "Drums", "instrument": "Drums", "isDrums": True},
                    ],
                }
            }
        }
    )
    + "</script></html>"
)


class MultiFetcher:
    def __init__(self) -> None:
        self.urls: list[str] = []

    def get_text(self, url: str) -> str:
        self.urls.append(url)
        if url == MULTI_URL:
            return MULTI_PAGE
        if url.endswith("/1.json"):
            return json.dumps(ACOUSTIC)
        if url.endswith("/2.json"):
            return json.dumps(ELECTRIC)
        if url.endswith("/3.json"):
            return json.dumps(SEVEN_STRING)
        if url.endswith("/4.json"):
            return json.dumps(BASS)
        if url.endswith("/list"):
            return json.dumps([{"videoId": "bbbbbbbbbbb", "feature": None, "points": [0.0, 2.0]}])
        raise AssertionError(url)


def _multi(**options: object):
    fetcher = MultiFetcher()
    result = SongsterrImporter(fetcher).import_score(
        ImportRequest(owner_id="local", url=MULTI_URL, options=options),
        silent_progress,
    )
    return fetcher, result


def test_song_with_guitars_still_imports_only_the_bass_by_default() -> None:
    fetcher, result = _multi()
    expected = json.loads(Path("tests/fixtures/songsterr-bass.json").read_text(encoding="utf-8"))
    track = result.document.model_dump(mode="json")["tracks"][0]
    assert track["instrument"] == "bass-guitar"
    assert track["tuning_midi"] == [43, 38, 33, 28]
    assert track["capo"] == 0
    assert track["bars"] == expected["tracks"][0]["bars"]
    assert result.document.bpm == expected["bpm"]
    assert result.document.sync.points == [0.0, 2.0]
    assert not any(url.endswith(("/1.json", "/2.json", "/3.json")) for url in fetcher.urls)
    assert any(url.endswith("/4.json") for url in fetcher.urls)


def test_preview_lists_fretted_tracks_and_skips_the_part_files() -> None:
    fetcher = MultiFetcher()
    preview = SongsterrImporter(fetcher).preview(ImportRequest(owner_id="local", url=MULTI_URL))
    assert preview["title"] == "Multi"
    assert [track["part_id"] for track in preview["tracks"]] == [1, 2, 3, 4]
    assert [track["canonical_instrument"] for track in preview["tracks"]] == [
        "acoustic-guitar",
        "guitar",
        "guitar",
        "bass-guitar",
    ]
    assert preview["tracks"][0]["capo"] == 2
    assert preview["tracks"][1]["tuning"] == DROP_D
    assert preview["tracks"][2]["string_count"] == 7
    assert fetcher.urls == [MULTI_URL]


def test_guitar_family_imports_acoustic_electric_and_seven_string() -> None:
    fetcher, result = _multi(prefer="guitar")
    tracks = result.document.tracks
    assert [(track.name, track.instrument, track.tuning_midi, track.capo) for track in tracks] == [
        ("Acoustic", "acoustic-guitar", STANDARD, 2),
        ("Lead", "guitar", DROP_D, 0),
        ("Rhythm", "guitar", SEVEN, 0),
    ]
    assert tracks[0].preferred
    assert tracks[1].bars[0].voices[0].beats[0].notes[0].string == 5
    assert tracks[2].bars[0].voices[0].beats[0].notes[0].string == 6
    assert result.document.sync.video_id == "bbbbbbbbbbb"
    assert result.document.sync.points == [0.0, 2.0]
    assert not any(url.endswith("/4.json") for url in fetcher.urls)


def test_part_ids_import_one_of_several_guitars() -> None:
    fetcher, result = _multi(part_ids=[2])
    track = result.document.tracks[0]
    assert track.name == "Lead"
    assert track.instrument == "guitar"
    assert track.tuning_midi == DROP_D
    assert track.preferred
    assert len(result.document.tracks) == 1
    part_urls = [url for url in fetcher.urls if url.endswith(".json") and not url.endswith("/list")]
    assert part_urls and all(url.endswith("/2.json") for url in part_urls)


def test_mixed_selection_prefers_the_default_family() -> None:
    _, result = _multi(part_ids=[1, 4])
    assert [track.name for track in result.document.tracks] == ["Acoustic", "Bass"]
    assert result.document.tracks[1].preferred
    assert not result.document.tracks[0].preferred
    _, guitar_first = _multi(part_ids=[1, 4], prefer="guitar")
    assert guitar_first.document.tracks[0].preferred
    assert guitar_first.document.tracks[0].instrument == "acoustic-guitar"


def test_capo_and_instrument_names() -> None:
    assert canonical_instrument("Electric Bass (finger)", is_bass=True) == "bass-guitar"
    assert canonical_instrument("Acoustic Guitar (nylon)") == "acoustic-guitar"
    assert canonical_instrument("Distortion Guitar", is_guitar=True) == "guitar"
    assert canonical_instrument("Banjo") == "Banjo"
    assert (
        track_instrument({"instrument": "bass-guitar"}, {"instrument": "Bass", "isBassGuitar": True}) == "bass-guitar"
    )
    assert _capo({"measures": [{"capo": 4}]}) == 4
    assert _capo({"capo": "nope"}) == 0
