"""ASCII tab parser, importer routing, and the paste endpoints."""

import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fretbook.app import create_app
from fretbook.config import Settings
from fretbook.importers import ascii_tab
from fretbook.importers.base import ImportError, ImportRequest, silent_progress
from fretbook.importers.registry import resolve_importer
from fretbook.score.model import TICKS_PER_QUARTER, ScoreDocument

CORPUS = Path(__file__).parent / "fixtures" / "corpus"

GUITAR = """\
e|{e}|
B|{b}|
G|{g}|
D|{d}|
A|{a}|
E|{e2}|
"""


def tab(**rows: str) -> str:
    blank = "-" * 15
    filled = {"e": blank, "b": blank, "g": blank, "d": blank, "a": blank, "e2": blank}
    filled.update(rows)
    return GUITAR.format(**filled)


def notes_of(document: ScoreDocument, bar: int = 0) -> list[tuple[int, list[tuple[int, int]]]]:
    beats = document.tracks[0].bars[bar].voices[0].beats
    return [(beat.position, sorted((n.string, n.fret) for n in beat.notes)) for beat in beats if beat.notes]


def first_note(document: ScoreDocument):
    return next(beat.notes[0] for beat in document.tracks[0].bars[0].voices[0].beats if beat.notes)


def test_places_notes_on_the_eighth_note_grid() -> None:
    parsed = ascii_tab.parse(tab(e2="-0---3---5-----"))
    assert notes_of(parsed.document) == [(0, [(5, 0)]), (960, [(5, 3)]), (1920, [(5, 5)])]
    assert parsed.document.bpm == 120
    assert parsed.warnings[0].key == "import.rhythmEstimated"


def test_every_bar_is_filled_with_drawable_durations() -> None:
    document = ascii_tab.parse(tab(e2="------0------3-")).document
    bar = document.tracks[0].bars[0].voices[0].beats
    assert sum(beat.duration for beat in bar) == 4 * TICKS_PER_QUARTER
    assert [beat.position for beat in bar] == sorted({beat.position for beat in bar})
    assert bar[0].rest and not bar[1].rest


def test_grid_option_changes_the_resolution() -> None:
    text = tab(e2="-0-1-2-3-4-5-6-")
    eighth = ascii_tab.parse(text, grid=8)
    sixteenth = ascii_tab.parse(text, grid=16)
    assert [pos for pos, _ in notes_of(eighth.document)] == [0, 480, 960, 1440, 1920, 2400, 2880]
    assert [pos for pos, _ in notes_of(sixteenth.document)][:3] == [0, 480, 960]


def test_a_bar_with_more_notes_than_slots_gets_a_finer_grid() -> None:
    parsed = ascii_tab.parse(tab(e2="-1-2-3-4-5-6-7-8-9-1-2-3-4-5-6-7-"), grid=4)
    assert len(notes_of(parsed.document)) == 16
    assert "asciiTab.gridRefined" in {w.key for w in parsed.warnings}


def test_a_bar_that_cannot_be_placed_is_refused() -> None:
    crowded = "-" + "-".join("1" for _ in range(70))
    with pytest.raises(ImportError) as caught:
        ascii_tab.parse(tab(e2=crowded))
    assert caught.value.key == "asciiTab.tooDense"


def test_signature_and_tempo_options() -> None:
    parsed = ascii_tab.parse(tab(e2="-0---3-----"), signature=(3, 4), bpm=90)
    assert parsed.document.bpm == 90
    assert parsed.document.bars[0].signature == (3, 4)
    odd = ascii_tab.parse(tab(e2="-0---3-----"), signature=(7, 8), grid=4)
    assert notes_of(odd.document)[0][0] == 0


def test_tempo_in_the_text_is_used_unless_given() -> None:
    text = "Riff\ntempo: 140\n" + tab(e2="-0-------------")
    assert ascii_tab.parse(text).document.bpm == 140
    assert ascii_tab.parse(text, bpm=100).document.bpm == 100
    assert ascii_tab.parse("Riff\n♩ = 10\n" + tab(e2="-0-------------")).document.bpm == 120


@pytest.mark.parametrize(
    ("row", "expected"),
    [
        ("-5h7p5---------", {"hammer": True}),
        ("-7/9-----------", {"slide": "shift"}),
        ("-7\\5-----------", {"slide": "shift"}),
        ("-7/------------", {"slide": "out_up"}),
        ("-7\\------------", {"slide": "out_down"}),
        ("-/7------------", {"slide": "in_below"}),
        ("-\\7------------", {"slide": "in_above"}),
        ("-5s7-----------", {"slide": "shift"}),
        ("-7b9-----------", {"bend": 2.0}),
        ("-7b------------", {"bend": 2.0}),
        ("-7^8-----------", {"bend": 1.0}),
        ("-7b9r7---------", {"bend": 2.0}),
        ("-7b7-----------", {"bend": 2.0}),
        ("-7b15----------", {"bend": 4.0}),
        ("-7~~~----------", {"vibrato": True}),
        ("-7v------------", {"vibrato": True}),
        ("-x-------------", {"dead": True}),
        ("-(7)-----------", {"ghost": True}),
        ("-<12>----------", {"harmonic": "natural"}),
    ],
)
def test_techniques(row: str, expected: dict) -> None:
    note = first_note(ascii_tab.parse(tab(e2=row)).document)
    for field, value in expected.items():
        assert getattr(note, field) == value


def test_release_marks_without_a_bend_are_skipped() -> None:
    document = ascii_tab.parse(tab(e2="-7r5-3---------")).document
    assert [fret for _, notes in notes_of(document) for _, fret in notes] == [7, 3]


def test_stray_marks_are_ignored() -> None:
    document = ascii_tab.parse(tab(e2="-h-/-~-b-3-t-5---")).document
    assert [fret for _, notes in notes_of(document) for _, fret in notes] == [3, 5]


def test_multi_digit_frets_and_chords_align_by_overlap() -> None:
    document = ascii_tab.parse(tab(e="-12-----------", b="--5------------", g="-7-------------")).document
    assert notes_of(document) == [(0, [(0, 12), (1, 5), (2, 7)])]


def test_notes_that_do_not_overlap_are_separate_beats() -> None:
    document = ascii_tab.parse(tab(e="-1-------------", b="---2-----------")).document
    assert [fret for _, notes in notes_of(document) for _, fret in notes] == [1, 2]


def test_repeat_dots_on_bar_lines() -> None:
    parsed = ascii_tab.parse("e|:-0-----|-5-----:|\nB|:-------|-------:|\nG|--------|--------|\nD|--------|--------|\n")
    assert [(bar.repeat_start, bar.repeat_end) for bar in parsed.document.bars] == [(True, 0), (False, 2)]
    assert notes_of(parsed.document, 0) == [(0, [(0, 0)])]
    starred = ascii_tab.parse("e|*-0---|\nB|*-----|\nG|------|\nD|------|\n")
    assert starred.document.bars[0].repeat_start


def test_repeat_marker_forms() -> None:
    row = "{}|-0-3-----|\nB|---------|\nG|---------|\nD|---------|\n"
    below = ascii_tab.parse(row.format("e") + "x4\n")
    assert (below.document.bars[0].repeat_start, below.document.bars[0].repeat_end) == (True, 4)
    above = ascii_tab.parse("(3x)\n" + row.format("e"))
    assert above.document.bars[0].repeat_end == 3
    far = ascii_tab.parse("x2\n\n\n" + row.format("e"))
    assert far.document.bars[0].repeat_end == 2
    inline = ascii_tab.parse(row.format("e").replace("-3-----|", "-3-----|x5", 1))
    assert inline.document.bars[0].repeat_end == 5
    note = ascii_tab.parse(row.format("e").replace("-3-----|", "-3-----| mute"))
    assert note.document.bars[0].repeat_end == 0
    section = ascii_tab.parse("[Chorus] x2\n" + row.format("e"))
    assert (section.document.bars[0].section, section.document.bars[0].repeat_end) == ("Chorus", 2)


def test_two_systems_share_one_marker_between_them() -> None:
    row = "e|-0-----|\nB|-------|\nG|-------|\nD|-------|\n"
    document = ascii_tab.parse(row + "x2\n" + row).document
    assert [bar.repeat_end for bar in document.bars] == [2, 0]


def test_sections_apply_to_the_next_system() -> None:
    row = "e|-0-----|\nB|-------|\nG|-------|\nD|-------|\n"
    document = ascii_tab.parse(f"[Intro]\n{row}\nVerse 2:\n{row}\n[Am]\n{row}").document
    assert [bar.section for bar in document.bars] == ["Intro", "Verse 2", None]


def test_chords_and_lyrics_between_systems_are_skipped() -> None:
    text = "Em        G\nHello there\n" + tab(e2="-0-------------") + "\nla la la\n" + tab(e2="-3-------------")
    parsed = ascii_tab.parse(text)
    assert len(parsed.document.bars) == 2
    assert parsed.title == "Hello there"


def test_title_and_artist_lines() -> None:
    parsed = ascii_tab.parse("Title: Hall\nBy: Someone\n" + tab(e2="-0-------------"))
    assert (parsed.title, parsed.artist) == ("Hall", "Someone")
    band = ascii_tab.parse("song = Room\nband: Them\n" + tab(e2="-0-------------"))
    assert (band.title, band.artist) == ("Room", "Them")


def test_palm_mute_and_let_ring_rows() -> None:
    text = "PM-------|\nLR----------|\n" + tab(e2="-0-0-0-0-------")
    beats = ascii_tab.parse(text).document.tracks[0].bars[0].voices[0].beats
    flags = [(note.palm_mute, note.let_ring) for beat in beats for note in beat.notes]
    assert flags[:3] == [(True, True)] * 3
    assert flags[3] == (False, True)
    below = ascii_tab.parse(tab(e2="-0-0-0-0-------") + "P.M.------\n").document
    assert first_note(below).palm_mute


class TestTuning:
    @staticmethod
    def tuning(labels: str, count: int | None = None) -> list[int]:
        rows = labels.split()
        body = "".join(f"{label}|-0-----|\n" for label in rows)
        return ascii_tab.parse(body).document.tracks[0].tuning_midi

    def test_standard_guitar_either_case(self) -> None:
        assert self.tuning("e B G D A E") == [64, 59, 55, 50, 45, 40]
        assert self.tuning("E B G D A E") == [64, 59, 55, 50, 45, 40]

    def test_bass_and_its_low_string_first_order(self) -> None:
        assert self.tuning("G D A E") == [43, 38, 33, 28]
        assert self.tuning("E A D G") == [43, 38, 33, 28]

    def test_five_string_bass_low_string_first(self) -> None:
        assert self.tuning("B E A D G") == [43, 38, 33, 28, 23]

    def test_drop_d_written_low_string_first(self) -> None:
        assert self.tuning("D A D G B E") == [64, 59, 55, 50, 45, 38]

    def test_a_few_guitar_strings_keep_the_guitar_octave(self) -> None:
        assert self.tuning("e B G D") == [64, 59, 55, 50]

    def test_flats_and_sharps(self) -> None:
        assert self.tuning("Eb Bb Gb Db Ab Eb") == [63, 58, 54, 49, 44, 39]

    def test_unlabeled_rows_use_presets_by_string_count(self) -> None:
        for count, expected in [(4, 43), (5, 43), (6, 64), (7, 64), (8, 64)]:
            rows = "".join("|-0-----|\n" for _ in range(count))
            track = ascii_tab.parse(rows).document.tracks[0]
            assert len(track.tuning_midi) == count
            assert track.tuning_midi[0] == expected
        eight = ascii_tab.parse("".join("|-0-----|\n" for _ in range(8))).document.tracks[0]
        assert eight.tuning_midi[-1] == 30
        assert eight.instrument == "guitar"

    def test_instrument_names(self) -> None:
        bass = ascii_tab.parse("G|-0-----|\nD|-------|\nA|-------|\nE|-------|\n").document.tracks[0]
        assert (bass.instrument, bass.name) == ("bass-guitar", "Bass")
        guitar = ascii_tab.parse(tab(e2="-0-------------")).document.tracks[0]
        assert (guitar.instrument, guitar.name) == ("guitar", "Guitar")


def test_rows_without_a_leading_bar_line() -> None:
    text = "".join(f"{label}-----0---|\n" for label in "eBGD")
    document = ascii_tab.parse(text).document
    assert len(document.bars) == 1
    assert notes_of(document)[0][1] == [(0, 0), (1, 0), (2, 0), (3, 0)]


def test_rows_with_a_different_bar_count_follow_the_majority() -> None:
    text = "e|-0---|-1---|\nB|-----|\nG|-----|\nD|-----|\n"
    assert len(ascii_tab.parse(text).document.bars) == 1
    padded = "e|-0---|\nB|-----|-1---|\nG|-----|-----|\nD|-----|-----|\n"
    assert len(ascii_tab.parse(padded).document.bars) == 2


def test_double_bar_lines_do_not_make_empty_bars() -> None:
    text = "e|-0---||-1---|\nB|-----||-----|\nG|-----||-----|\nD|-----||-----|\n"
    assert len(ascii_tab.parse(text).document.bars) == 2


def test_short_fragments_and_odd_systems_are_skipped() -> None:
    skipped = ascii_tab.parse("e|-0-----|\nB|-1-----|\n\n" + tab(e2="-0-------------"))
    assert len(skipped.document.bars) == 1
    mixed = ascii_tab.parse(tab(e2="-0-------------") + "\n" + "G|-0-----|\nD|-------|\nA|-------|\nE|-------|\n")
    assert len(mixed.document.bars) == 1
    assert "asciiTab.skippedSystems" in {w.key for w in mixed.warnings}


def test_stacked_systems_without_a_blank_line_are_split() -> None:
    row = "e|-0-----|\nB|-------|\nG|-------|\nD|-------|\n"
    assert len(ascii_tab.parse(row * 3).document.bars) == 3
    assert len(ascii_tab.parse(row * 2 + "A|-------|\n" * 2 + "E|-0-----|\n" * 2).document.bars) == 3


def test_rows_that_fit_no_system_size_are_dropped() -> None:
    nine = "".join(f"{label}|-0-----|\n" for label in "eBGDAEBGD")
    assert not ascii_tab.looks_like_ascii_tab(nine)
    with pytest.raises(ImportError) as caught:
        ascii_tab.parse(nine)
    assert caught.value.key == "asciiTab.noTab"


@pytest.mark.parametrize(
    "text",
    [
        "",
        "Just some lyrics\nAm   G\nwith chords\n",
        "e|-----|\nB|-----|\nG|-----|\nD|-----|\n",
        "| a | b |\n|---|---|\n|---|---|\n|---|---|\n",
    ],
)
def test_text_without_a_tab_is_not_a_tab(text: str) -> None:
    assert not ascii_tab.looks_like_ascii_tab(text)
    with pytest.raises(ImportError) as caught:
        ascii_tab.parse(text)
    assert caught.value.key == "asciiTab.noTab"


def test_a_label_without_a_bar_line_needs_a_dash_next_to_it() -> None:
    assert not ascii_tab.looks_like_ascii_tab("".join(f"{label} 0---0---\n" for label in "eBGD"))


def test_limits_and_bad_options() -> None:
    with pytest.raises(ImportError) as caught:
        ascii_tab.parse("-" * (ascii_tab.MAX_CHARS + 1))
    assert caught.value.key == "asciiTab.tooLong"
    with pytest.raises(ImportError) as caught:
        ascii_tab.parse(tab(e2="-0-------------"), grid=3)
    assert caught.value.key == "asciiTab.badGrid"


def test_looks_like_ascii_tab_accepts_windows_line_endings() -> None:
    assert ascii_tab.looks_like_ascii_tab(tab(e2="-0-------------").replace("\n", "\r\n"))


# Importer and registry ------------------------------------------------------------------------


def request_for(path: Path, name: str | None = None, **options) -> ImportRequest:
    return ImportRequest(owner_id="t", filename=name or path.name, file_path=path, options=options)


def test_registry_sends_tab_files_here_and_chord_sheets_to_chordpro() -> None:
    assert resolve_importer(request_for(CORPUS / "asciitab" / "plain-text.txt")).kind == "ascii-tab"
    assert resolve_importer(request_for(CORPUS / "asciitab" / "unlabeled.tab")).kind == "ascii-tab"
    for sheet in (CORPUS / "ugtext").glob("*.txt"):
        assert resolve_importer(request_for(sheet)).kind == "chordpro"
    assert resolve_importer(ImportRequest(owner_id="t", filename="notes.txt")).kind == "chordpro"
    assert resolve_importer(ImportRequest(owner_id="t", filename="notes.tab")).kind == "ascii-tab"
    assert not ascii_tab.AsciiTabImporter().can_handle(ImportRequest(owner_id="t", filename="song.xml"))


def test_importer_result(tmp_path: Path) -> None:
    source = tmp_path / "Riff Song.tab"
    source.write_text(tab(e2="-0-------------"), encoding="utf-8")
    messages: list[str] = []
    result = ascii_tab.AsciiTabImporter().import_score(
        request_for(source, grid=16, signature=[3, 4], bpm=80, title="Named", artist="Someone"),
        lambda message, key="": messages.append(key),
    )
    assert (result.title, result.artist, result.slug, result.source_kind) == (
        "Named",
        "Someone",
        "riff-song",
        "ascii-tab",
    )
    assert result.source_ref == {"filename": "Riff Song.tab", "rhythm_estimated": True, "grid": 16}
    assert result.document is not None and result.document.bpm == 80
    assert result.document.bars[0].signature == (3, 4)
    assert result.warnings[0].key == "import.rhythmEstimated"
    assert messages == ["import.readingFile", "import.tabReady"]


def test_importer_falls_back_to_the_file_name_and_reads_cp1252(tmp_path: Path) -> None:
    source = tmp_path / "caf.tab"
    source.write_bytes(b"\xe9\n" + tab(e2="-0-------------").encode())
    result = ascii_tab.AsciiTabImporter().import_score(request_for(source), silent_progress)
    assert result.title == "é"
    plain = tmp_path / "plain-name.tab"
    plain.write_text(tab(e2="-0-------------"), encoding="utf-8")
    assert ascii_tab.AsciiTabImporter().import_score(request_for(plain), silent_progress).title == "plain-name"


def test_importer_needs_a_file_and_a_tab(tmp_path: Path) -> None:
    with pytest.raises(ImportError) as caught:
        ascii_tab.AsciiTabImporter().import_score(ImportRequest(owner_id="t", filename="x.tab"), silent_progress)
    assert caught.value.key == "import.needsFile"
    empty = tmp_path / "empty.tab"
    empty.write_text("nothing here\n", encoding="utf-8")
    with pytest.raises(ImportError) as caught:
        ascii_tab.AsciiTabImporter().import_score(request_for(empty), silent_progress)
    assert caught.value.key == "asciiTab.noTab"


# API --------------------------------------------------------------------------------------------


def client_for(tmp_path: Path) -> TestClient:
    return TestClient(create_app(Settings.for_tests(tmp_path)))


def test_preview_returns_a_document_without_saving(tmp_path: Path) -> None:
    with client_for(tmp_path) as client:
        response = client.post("/api/imports/ascii-tab/preview", json={"text": tab(e2="-0---3---------"), "grid": 16})
        assert response.status_code == 200
        body = response.json()
        assert body["content_kind"] == "tab"
        assert body["rhythm_estimated"] is True
        assert body["chordpro"] is None
        assert body["warnings"][0]["key"] == "import.rhythmEstimated"
        ScoreDocument.model_validate(body["document"])
        assert client.get("/api/songs").json() == []


def test_preview_routes_chords_over_lyrics_to_chordpro(tmp_path: Path) -> None:
    with client_for(tmp_path) as client:
        response = client.post(
            "/api/imports/ascii-tab/preview", json={"text": "G        C\nHello my friend\n", "title": "Hi"}
        )
        body = response.json()
        assert (body["content_kind"], body["document"], body["rhythm_estimated"]) == ("chords", None, False)
        assert "[G]Hello my [C]friend" in body["chordpro"]
        assert body["title"] == "Hi"
        titled = client.post("/api/imports/ascii-tab/preview", json={"text": "{title: From Text}\n[G]Hi\n"}).json()
        assert titled["title"] == "From Text"


@pytest.mark.parametrize(
    ("payload", "key"),
    [
        ({"text": "   "}, "asciiTab.empty"),
        ({"text": "x", "signature": [0, 4]}, "song.badSignature"),
        ({"text": "x", "signature": [4, 3]}, "song.badSignature"),
        ({"text": "no\n" * 3 + "e|---|\n"}, None),
    ],
)
def test_preview_errors(tmp_path: Path, payload: dict, key: str | None) -> None:
    with client_for(tmp_path) as client:
        response = client.post("/api/imports/ascii-tab/preview", json=payload)
        if key is None:
            assert response.status_code == 200
        else:
            assert response.status_code == 400
            assert response.json()["detail"]["key"] == key


def test_preview_surfaces_parser_errors_with_keys(tmp_path: Path) -> None:
    crowded = "-" + "-".join("1" for _ in range(70))
    with client_for(tmp_path) as client:
        response = client.post("/api/imports/ascii-tab/preview", json={"text": tab(e2=crowded)})
        assert response.status_code == 400
        assert response.json()["detail"] == {
            "key": "asciiTab.tooDense",
            "message": "bar 1 has too many notes to place",
            "params": {"bar": 1},
        }


def test_chord_text_that_is_too_long_is_refused(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("fretbook.chords.chordpro.MAX_CHARS", 10)
    with client_for(tmp_path) as client:
        response = client.post("/api/imports/ascii-tab/preview", json={"text": "G\nHello there my friend\n"})
        assert response.status_code == 400
        assert response.json()["detail"]["key"] == "chords.tooLong"


def test_import_saves_a_tab_marked_as_estimated(tmp_path: Path) -> None:
    with client_for(tmp_path) as client:
        created = client.post(
            "/api/imports/ascii-tab",
            json={"text": tab(e2="-0---3---------"), "title": "My Riff", "artist": "Me", "grid": 16, "bpm": 100},
        )
        assert created.status_code == 201
        song = created.json()
        assert (song["title"], song["artist"], song["content_kind"], song["source_kind"]) == (
            "My Riff",
            "Me",
            "tab",
            "ascii-tab",
        )
        assert song["source_ref"] == {"rhythm_estimated": True, "grid": 16}
        assert song["bpm"] == 100
        assert client.get(f"/api/songs/{song['id']}").json()["document"]["tracks"][0]["tuning_midi"][0] == 64
        untitled = client.post("/api/imports/ascii-tab", json={"text": tab(e2="-0---3---------")}).json()
        assert untitled["title"] == "Untitled"
        titled = client.post("/api/imports/ascii-tab", json={"text": "Name Here\n" + tab(e2="-0---3-------")}).json()
        assert titled["title"] == "Name Here"


def test_import_saves_chords_as_a_chord_sheet(tmp_path: Path) -> None:
    with client_for(tmp_path) as client:
        created = client.post("/api/imports/ascii-tab", json={"text": "G        C\nHello my friend\n", "title": "Hi"})
        assert created.status_code == 201
        song = created.json()
        assert (song["content_kind"], song["source_kind"]) == ("chords", "manual")
        assert "[G]Hello my [C]friend" in song["chordpro"]


def test_uploaded_tab_files_become_songs(tmp_path: Path) -> None:
    with client_for(tmp_path) as client:
        for name, content in [
            ("riff.tab", tab(e2="-0---3---------")),
            ("notes.txt", "Notes\n\n" + tab(e2="-0---3---")),
        ]:
            queued = client.post("/api/imports/file", files={"file": (name, content.encode(), "text/plain")})
            assert queued.status_code == 202
            client.app.state.ctx.jobs.run_once()
            job = {"status": "queued"}
            for _ in range(30):
                job = client.get(f"/api/jobs/{queued.json()['job_id']}").json()
                if job["status"] in {"done", "error"}:
                    break
                time.sleep(0.1)
            assert job["status"] == "done", job
            assert job["result"]["content_kind"] == "tab"
            assert job["result"]["warnings"][0]["key"] == "import.rhythmEstimated"
            song = client.get(f"/api/songs/{job['result']['song_id']}").json()
            assert song["source_kind"] == "ascii-tab"
            assert song["source_ref"]["rhythm_estimated"] is True


def test_a_bar_without_notes_is_a_full_bar_rest() -> None:
    text = "e|-0-------|---------|\nB|---------|---------|\nG|---------|---------|\nD|---------|---------|\n"
    document = ascii_tab.parse(text).document
    assert document.tracks[0].bars[1].voices[0].beats == []
    assert len(document.bars) == 2
