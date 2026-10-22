"""Songsterr port: default-instrument parts, grace notes, tuplets, repeats, sync warnings."""

import json

import pytest

from fretbook.importers.base import ImportError, ImportRequest, silent_progress
from fretbook.importers.songsterr import SongsterrImporter, apply_tempos, legacy_events, part_bars
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
