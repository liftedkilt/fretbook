"""Songsterr port: bass by default, guitar listed, grace notes, sync warnings."""

import json

import pytest

from fretbook.importers.base import ImportRequest, silent_progress
from fretbook.importers.songsterr import SongsterrImporter, legacy_events
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
    assert result.document.tracks[0].instrument == "bass-guitar"
    assert len(result.document.tracks) == 1
    assert [track["part_id"] for track in result.source_ref["available_tracks"]] == [1, 2]
    assert not any(url.endswith("/1.json") for url in fetcher.urls)
    assert any(url.endswith("/2.json") for url in fetcher.urls)
    assert result.document.sync.video_id == "bbbbbbbbbbb"
    assert result.audio is not None and result.audio.video_id == "bbbbbbbbbbb"
    track = result.document.tracks[0]
    # The grace note shares the following beat's position.
    assert track.measures[0].voices[0].beats[0].position == 0
    assert track.measures[0].voices[0].beats[1].position == 0
    assert track.measures[0].voices[0].beats[0].extras["graceNote"] == "onBeat"
    assert track.measures[0].voices[0].beats[2].position == 1


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
    assert result.warnings


def test_unknown_video_and_bad_url() -> None:
    with pytest.raises(Exception, match="video"):
        _import(video_id="ccccccccccc")
    with pytest.raises(Exception, match="URL"):
        SongsterrImporter(FakeFetcher()).import_score(
            ImportRequest(owner_id="local", url="https://example.com/nope"),
            silent_progress,
        )


def test_document_validates() -> None:
    _, result = _import()
    ScoreDocument.model_validate(result.document.model_dump())
