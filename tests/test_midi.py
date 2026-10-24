"""MIDI import, the routes around it, and MIDI export. Files are generated here with mido; none is a real song."""

import io
import json
import time
import zipfile
from dataclasses import replace
from pathlib import Path

import mido
import pytest
from fastapi.testclient import TestClient

from fretbook.app import create_app
from fretbook.config import Settings
from fretbook.export.midi import to_midi
from fretbook.importers import midi, sniff
from fretbook.importers.base import ImportError, ImportRequest, silent_progress
from fretbook.importers.registry import resolve_importer
from fretbook.score.model import TICKS_PER_QUARTER, ScoreDocument

CORPUS = Path(__file__).parent / "fixtures" / "corpus"
TPB = 480


def make_midi(*tracks: list, type: int = 1, ticks: int = TPB) -> bytes:
    file = mido.MidiFile(type=type, ticks_per_beat=ticks)
    for messages in tracks:
        track = mido.MidiTrack()
        track.extend(messages)
        file.tracks.append(track)
    buffer = io.BytesIO()
    file.save(file=buffer)
    return buffer.getvalue()


def notes(pitches, *, channel=0, length=TPB, gap=0, program=None):
    messages: list = []
    if program is not None:
        messages.append(mido.Message("program_change", channel=channel, program=program, time=0))
    wait = 0
    for pitch in pitches:
        messages.append(mido.Message("note_on", channel=channel, note=pitch, velocity=80, time=wait))
        messages.append(mido.Message("note_off", channel=channel, note=pitch, velocity=0, time=length))
        wait = gap
    return messages


def conductor(*extra, name="Test Song"):
    return [
        mido.MetaMessage("track_name", name=name, time=0),
        mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(90), time=0),
        mido.MetaMessage("time_signature", numerator=4, denominator=4, time=0),
        *extra,
    ]


def run(data: bytes, tmp_path: Path, options: dict | None = None, name: str = "song.mid"):
    path = tmp_path / name
    path.write_bytes(data)
    request = ImportRequest(owner_id="t", filename=name, file_path=path, options={"midi": options} if options else {})
    return resolve_importer(request).import_score(request, silent_progress)


def beats_of(track):
    return [
        (i, b.position, b.duration, [(n.string, n.fret, n.tie) for n in b.notes])
        for i, bar in enumerate(track.bars)
        for b in bar.voices[0].beats
    ]


def test_sniffer_and_registry_accept_midi(tmp_path: Path) -> None:
    data = make_midi(conductor(), notes([40, 45]))
    assert sniff.sniff_bytes(data).kind == sniff.MIDI
    assert run(data, tmp_path).source_kind == "midi"


def test_tempo_signature_title_and_bar_count(tmp_path: Path) -> None:
    track = notes([40] * 6, program=33)
    data = make_midi(conductor(mido.MetaMessage("time_signature", numerator=3, denominator=4, time=TPB * 4)), track)
    result = run(data, tmp_path)
    document = result.document
    assert result.title == "Test Song"
    assert document.bpm == 90
    assert [bar.signature for bar in document.bars] == [(4, 4), (3, 4)]
    assert document.tracks[0].instrument == "bass-guitar"


def test_tempo_change_lands_on_the_bar_after_it(tmp_path: Path) -> None:
    changes = [mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(140), time=TPB * 4)]
    data = make_midi(conductor(*changes), notes([40] * 12, program=33))
    document = run(data, tmp_path).document
    assert [bar.tempo for bar in document.bars] == [None, 140.0, None]


def test_single_note_length_and_rests(tmp_path: Path) -> None:
    # quarter note, quarter rest, half note
    messages = [
        mido.Message("note_on", note=40, velocity=80, time=0),
        mido.Message("note_off", note=40, velocity=0, time=TPB),
        mido.Message("note_on", note=45, velocity=80, time=TPB),
        mido.Message("note_off", note=45, velocity=0, time=TPB * 2),
    ]
    document = run(make_midi(conductor(), messages), tmp_path, {"preset": "bass-4"}).document
    layout = [(b[1], b[2], bool(b[3])) for b in beats_of(document.tracks[0])[:3]]
    assert layout == [(0, 960, True), (960, 960, False), (1920, 1920, True)]


def test_chord_is_one_beat_and_quantizes_to_the_grid(tmp_path: Path) -> None:
    messages = [
        mido.Message("note_on", note=40, velocity=80, time=7),
        mido.Message("note_on", note=47, velocity=80, time=0),
        mido.Message("note_off", note=40, velocity=0, time=TPB - 7),
        mido.Message("note_off", note=47, velocity=0, time=0),
    ]
    document = run(make_midi(conductor(), messages), tmp_path, {"preset": "guitar-6", "grid": 16}).document
    first = document.tracks[0].bars[0].voices[0].beats[0]
    assert first.position == 0 and first.duration == 960
    assert sorted(n.string for n in first.notes) == [4, 5]


def test_note_across_a_bar_line_is_split_and_tied(tmp_path: Path) -> None:
    messages = [
        mido.Message("note_on", note=40, velocity=80, time=TPB * 3),
        mido.Message("note_off", note=40, velocity=0, time=TPB * 2),
    ]
    document = run(make_midi(conductor(), messages), tmp_path, {"preset": "guitar-6"}).document
    beats = [b for b in beats_of(document.tracks[0]) if b[3]]
    assert beats[0][0] == 0 and beats[0][3][0][2] is False
    assert beats[1][0] == 1 and beats[1][3][0][2] is True
    assert sum(b[2] for b in beats) == 2 * TPB * 2


def test_long_note_is_split_into_drawable_values(tmp_path: Path) -> None:
    messages = [
        mido.Message("note_on", note=40, velocity=80, time=0),
        mido.Message("note_off", note=40, velocity=0, time=TPB * 3 + TPB // 4),
    ]
    document = run(make_midi(conductor(), messages), tmp_path, {"preset": "guitar-6"}).document
    sounded = [b for b in beats_of(document.tracks[0]) if b[3]]
    assert [b[2] for b in sounded] == [2880, 240]
    assert [b[3][0][2] for b in sounded] == [False, True]


def test_overlapping_note_is_cut_at_the_next_onset(tmp_path: Path) -> None:
    messages = [
        mido.Message("note_on", note=40, velocity=80, time=0),
        mido.Message("note_on", note=45, velocity=80, time=TPB),
        mido.Message("note_off", note=40, velocity=0, time=TPB),
        mido.Message("note_off", note=45, velocity=0, time=TPB),
    ]
    beats = beats_of(run(make_midi(conductor(), messages), tmp_path, {"preset": "guitar-6"}).document.tracks[0])
    assert (0, 0, 960) == beats[0][:3]
    assert (0, 960, 1920) == beats[1][:3]


def test_tracks_are_chosen_by_id_and_presets_per_track(tmp_path: Path) -> None:
    data = make_midi(
        conductor(),
        notes([60, 62], channel=0, program=27),
        notes([30, 33], channel=1, program=33),
    )
    parsed = midi.read_midi(data=data)
    assert [s.id for s in parsed.sources] == ["1:0", "2:1"]
    default = run(data, tmp_path)
    assert [t.instrument for t in default.document.tracks] == ["guitar", "bass-guitar"]
    only = run(data, tmp_path, {"tracks": ["2:1"], "presets": {"2:1": "bass-5"}})
    assert len(only.document.tracks) == 1 and len(only.document.tracks[0].tuning_midi) == 5
    assert only.document.tracks[0].preferred


def test_default_selection_prefers_guitar_and_bass_programs() -> None:
    data = make_midi(
        conductor(),
        notes([60, 62], program=27),
        notes([64, 65], channel=2, program=0),  # piano, in range
        notes([36, 38], channel=9),  # drums
    )
    parsed = midi.read_midi(data=data)
    assert parsed.drum_notes == 2
    assert parsed.default_selection() == ["1:0"]
    no_programs = midi.read_midi(data=make_midi(conductor(), notes([60, 62]), notes([20, 21], channel=1)))
    assert no_programs.default_selection() == ["1:0"]  # the 20/21 part is out of range


def test_out_of_range_notes_are_moved_and_reported(tmp_path: Path) -> None:
    data = make_midi(conductor(), notes([20, 100, 40]))
    result = run(data, tmp_path, {"tracks": ["1:0"], "preset": "guitar-6"})
    assert [w.key for w in result.warnings] == ["midi.shifted"]
    assert result.warnings[0].params["count"] == 2


def test_capo_is_applied(tmp_path: Path) -> None:
    result = run(make_midi(conductor(), notes([66])), tmp_path, {"tracks": ["1:0"], "preset": "guitar-6", "capo": 2})
    track = result.document.tracks[0]
    note = track.bars[0].voices[0].beats[0].notes[0]
    assert track.capo == 2 and track.tuning_midi[note.string] + 2 + note.fret == 66


@pytest.mark.parametrize(
    ("options", "key"),
    [
        ({"tracks": ["9:9"]}, "midi.noSuchTrack"),
        ({"tracks": []}, "midi.noTracks"),
        ({"preset": "ukulele"}, "midi.badPreset"),
        ({"grid": 3}, "midi.badGrid"),
        ({"capo": 30}, "midi.badCapo"),
    ],
)
def test_bad_options_are_refused(tmp_path: Path, options: dict, key: str) -> None:
    with pytest.raises(ImportError) as caught:
        run(make_midi(conductor(), notes([40, 45], program=33)), tmp_path, options)
    assert caught.value.key == key


def test_files_without_usable_notes_or_with_garbage(tmp_path: Path) -> None:
    with pytest.raises(ImportError) as caught:
        run(make_midi(conductor()), tmp_path)
    assert caught.value.key == "midi.noTracks"
    with pytest.raises(ImportError) as caught:
        run(b"MThd\x00\x00\x00\x06\x00\x01\x00\x01\x01\xe0MTrk\x00\x00\x00\x10oops", tmp_path)
    assert caught.value.key == "midi.parse"
    with pytest.raises(ImportError) as caught:
        run(make_midi(conductor(), type=2), tmp_path)
    assert caught.value.key == "midi.type2"


def test_too_long_files_are_refused(tmp_path: Path) -> None:
    far = [
        mido.Message("note_on", note=40, velocity=80, time=TPB * 4 * 3000),
        mido.Message("note_off", note=40, time=1),
    ]
    with pytest.raises(ImportError) as caught:
        run(make_midi(conductor(), far), tmp_path, {"tracks": ["1:0"]})
    assert caught.value.key == "midi.tooLong"


def test_format_zero_file_reads_title_and_notes(tmp_path: Path) -> None:
    data = make_midi(conductor(*notes([40, 43], program=33)), type=0)
    result = run(data, tmp_path, name="My Riff.mid")
    assert result.title == "Test Song" and result.slug == "my-riff"


def test_other_resolutions_are_converted(tmp_path: Path) -> None:
    messages = [
        mido.Message("note_on", note=40, velocity=80, time=0),
        mido.Message("note_off", note=40, velocity=0, time=96),
    ]
    data = make_midi([mido.MetaMessage("set_tempo", tempo=500000, time=0)], messages, ticks=96)
    beats = beats_of(run(data, tmp_path, {"tracks": ["1:0"], "preset": "guitar-6"}).document.tracks[0])
    assert beats[0][2] == TICKS_PER_QUARTER


def test_corpus_riff_matches_its_musicxml(tmp_path: Path) -> None:
    from tests.test_import_corpus import notes_of, run_import

    a = run_import(CORPUS / "midi" / "riff.mid", tmp_path)
    b = run_import(CORPUS / "musicxml" / "riff.partwise.musicxml", tmp_path)
    assert notes_of(a) == notes_of(b)


# --- export


def pitches(document: ScoreDocument, index: int = 0) -> list[tuple[int, int, int]]:
    track = document.tracks[index]
    found = []
    origin = 0
    for bar, track_bar in zip(document.bars, track.bars, strict=True):
        for beat in track_bar.voices[0].beats:
            for note in beat.notes:
                found.append(
                    (origin + beat.position, beat.duration, track.tuning_midi[note.string] + track.capo + note.fret)
                )
        origin += bar.length_ticks
    return found


def test_export_round_trip_keeps_pitch_onset_and_length(tmp_path: Path) -> None:
    source = run(make_midi(conductor(), notes([40, 43, 45, 47, 52, 55], gap=TPB // 2, length=TPB // 2)), tmp_path)
    exported = to_midi(source.document, title="Test Song")
    again = run(exported, tmp_path, name="again.mid")
    assert again.title == "Test Song"
    assert pitches(again.document) == pitches(source.document)
    assert again.document.bpm == source.document.bpm


def test_export_joins_ties_and_writes_tempo_and_signature(tmp_path: Path) -> None:
    messages = [
        mido.Message("note_on", note=40, velocity=80, time=TPB * 3),
        mido.Message("note_off", note=40, velocity=0, time=TPB * 2),
    ]
    tempo = mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(140), time=TPB * 4)
    source = run(make_midi(conductor(tempo), messages), tmp_path, {"preset": "guitar-6"})
    file = mido.MidiFile(file=io.BytesIO(to_midi(source.document, title="x")))
    assert file.type == 1 and file.ticks_per_beat == TICKS_PER_QUARTER
    on = [m for m in file.tracks[1] if m.type == "note_on"]
    assert len(on) == 1  # the tied halves are one MIDI note
    metas = [m.type for m in file.tracks[0]]
    assert metas.count("set_tempo") == 2 and "time_signature" in metas


def test_export_expands_repeats_and_skips_the_drum_channel() -> None:
    source = ScoreDocument.model_validate(
        {
            "bars": [{"repeat_start": True}, {"repeat_end": 2}],
            "tracks": [
                {
                    "id": f"t{i}",
                    "name": f"T{i}",
                    "instrument": "guitar" if i % 2 else "bass-guitar",
                    "tuning_midi": [64, 59, 55, 50, 45, 40],
                    "bars": [
                        {
                            "voices": [
                                {"beats": [{"position": 0, "duration": 3840, "notes": [{"string": 0, "fret": 0}]}]}
                            ]
                        }
                    ]
                    * 2,
                }
                for i in range(11)
            ],
        }
    )
    file = mido.MidiFile(file=io.BytesIO(to_midi(source)))
    channels = {m.channel for t in file.tracks[1:] for m in t if m.type == "note_on"}
    assert 9 not in channels and len(channels) == 11
    first = [m for m in file.tracks[1] if m.type == "note_on"]
    assert len(first) == 4  # two bars, played twice


# --- API


def _client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(replace(Settings.for_tests(tmp_path))))


def _wait(client: TestClient, job_id: str) -> dict:
    client.app.state.ctx.jobs.run_once()
    job = {"status": "queued"}
    for _ in range(30):
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in {"done", "error"}:
            break
        time.sleep(0.1)
    return job


def test_inspect_lists_the_parts(tmp_path: Path) -> None:
    data = make_midi(conductor(), notes([40, 43], program=33), notes([36], channel=9))
    with _client(tmp_path) as client:
        response = client.post("/api/imports/midi/inspect", files={"file": ("x.mid", data)})
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["title"] == "Test Song" and body["bpm"] == 90 and body["drum_notes"] == 1
        assert body["tracks"] == [
            {
                "id": "1:0",
                "name": "Bass",
                "channel": 1,
                "program": 33,
                "notes": 2,
                "lowest": 40,
                "highest": 43,
                "in_range": True,
                "suggested_preset": "bass-4",
                "selected": True,
            }
        ]
        bad = client.post("/api/imports/midi/inspect", files={"file": ("x.mid", b"nope")})
        assert bad.status_code == 400 and bad.json()["detail"]["key"] == "midi.parse"
        empty = client.post("/api/imports/midi/inspect", files={"file": ("x.mid", b"")})
        assert empty.status_code == 400


def test_import_with_choices_saves_a_song_and_exports_it(tmp_path: Path) -> None:
    data = make_midi(conductor(), notes([60, 62, 64], program=27), notes([36, 38], channel=1, program=33))
    options = {"tracks": ["1:0"], "preset": "guitar-drop-d", "capo": 1, "grid": 8}
    with _client(tmp_path) as client:
        response = client.post(
            "/api/imports/midi", files={"file": ("Riff.mid", data)}, data={"options": json.dumps(options)}
        )
        assert response.status_code == 202, response.text
        job = _wait(client, response.json()["job_id"])
        assert job["status"] == "done", job
        song = client.get(f"/api/songs/{job['result']['song_id']}").json()
        assert song["source_kind"] == "midi"
        track = song["document"]["tracks"][0]
        assert len(song["document"]["tracks"]) == 1 and track["capo"] == 1
        assert track["tuning_midi"] == [64, 59, 55, 50, 45, 38]
        exported = client.get(f"/api/songs/{song['id']}/export.mid")
        assert exported.status_code == 200 and exported.headers["content-type"] == "audio/midi"
        assert exported.headers["content-disposition"].endswith('.mid"')
        assert mido.MidiFile(file=io.BytesIO(exported.content)).type == 1


def test_import_refuses_bad_options_and_chord_sheets_do_not_export(tmp_path: Path) -> None:
    data = make_midi(conductor(), notes([40], program=33))
    with _client(tmp_path) as client:
        for options in ("{not json", json.dumps({"grid": 7}), json.dumps({"capo": 99})):
            response = client.post("/api/imports/midi", files={"file": ("x.mid", data)}, data={"options": options})
            assert response.status_code == 400
            assert response.json()["detail"]["key"] == "midi.badOptions"
        created = client.post(
            "/api/songs", json={"title": "Chords", "content_kind": "chords", "chordpro": "{title: Chords}\n[C]Hi"}
        )
        song_id = created.json()["id"]
        assert client.get(f"/api/songs/{song_id}/export.mid").status_code == 400


def test_dropping_a_midi_file_in_the_add_box_uses_the_defaults(tmp_path: Path) -> None:
    data = make_midi(conductor(), notes([40, 43], program=33))
    with _client(tmp_path) as client:
        response = client.post("/api/imports/auto", files={"file": ("riff.mid", data)})
        assert response.status_code == 202, response.text
        job = _wait(client, response.json()["job_id"])
        assert job["status"] == "done", job


def test_a_midi_file_in_a_zip_is_imported_with_the_defaults(tmp_path: Path) -> None:
    data = make_midi(conductor(), notes([40, 43], program=33))
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr("pack/riff.mid", data)
    with _client(tmp_path) as client:
        response = client.post("/api/imports/auto", files={"file": ("pack.zip", archive.getvalue())})
        assert response.status_code == 202, response.text
        job = _wait(client, response.json()["job_id"])
        assert job["status"] == "done", job
        song = client.get(f"/api/songs/{job['result']['song_id']}").json()
        assert song["source_kind"] == "midi" and len(song["document"]["tracks"]) == 1


def test_capabilities_list_the_midi_exporter(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        assert "midi" in client.get("/api/meta").json()["exporters"]
