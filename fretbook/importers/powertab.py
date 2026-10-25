"""Power Tab (``.ptb``) importer.

Parses Power Tab Editor v1.70 (file version 4, ``ptab\\x04\\x00`` header) binary
files, including song and lesson metadata, guitar and bass scores, track
tunings and capos, sections, barlines, time signatures, tempo markers,
repeats, alternate endings, rehearsal signs, multi-voice staves, and note
techniques.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fretbook.importers.base import ImportError, ImportRequest, ImportResult, Notice, Progress
from fretbook.score.model import (
    TICKS_PER_QUARTER,
    Bar,
    Beat,
    Note,
    ScoreDocument,
    Track,
    TrackBar,
    Voice,
)

PTB_MAGIC = b"ptab"


def _is_bass_program(program: int | None) -> bool:
    return program is not None and 32 <= program < 40


def _is_fretted_program(program: int | None) -> bool:
    return program is not None and 24 <= program < 40


def is_powertab(head: bytes) -> bool:
    """Return True if ``head`` starts with the Power Tab binary magic header."""
    if len(head) < 6 or head[:4] != PTB_MAGIC:
        return False
    version = int(struct.unpack("<H", head[4:6])[0])
    return 1 <= version <= 4


class PowerTabImporter:
    kind = "powertab"

    def can_handle(self, request: ImportRequest) -> bool:
        name = (request.filename or "").lower()
        if name.endswith(".ptb"):
            return True
        if request.file_path is not None and request.file_path.is_file():
            with request.file_path.open("rb") as handle:
                return is_powertab(handle.read(6))
        return False

    def import_score(self, request: ImportRequest, progress: Progress) -> ImportResult:
        if request.file_path is None:
            raise ImportError("Power Tab import needs a file", "import.needsFile")
        progress("Reading Power Tab file", "import.readingFile")
        data = request.file_path.read_bytes()
        filename = request.filename or request.file_path.name
        prefer = str(request.options.get("prefer") or "bass")
        document, title, artist, warnings = parse_powertab(data, filename=filename, prefer=prefer)
        title = title or Path(filename).stem or "Untitled"
        slug = Path(filename).stem
        slug = "".join(ch.lower() if ch.isalnum() else "-" for ch in slug).strip("-") or "song"
        progress("Tab ready", "import.tabReady")
        return ImportResult(
            title=title,
            artist=artist,
            slug=slug[:60],
            document=document,
            source_kind=self.kind,
            source_ref={"filename": filename},
            warnings=warnings,
        )


@dataclass
class _PTTrackInfo:
    number: int
    name: str
    instrument: int
    capo: int
    strings: list[int]


@dataclass
class _PTBarLine:
    position: int
    bar_type: int
    repeat_count: int
    signature: tuple[int, int] | None
    section: str | None


@dataclass
class _PTNote:
    string: int
    fret: int
    tie: bool = False
    dead: bool = False
    ghost: bool = False
    hammer: bool = False
    slide: str | None = None
    harmonic: str | None = None
    bend: float | None = None


@dataclass
class _PTPosition:
    position: int
    duration_value: int
    dotted: bool = False
    double_dotted: bool = False
    is_rest: bool = False
    grace: bool = False
    tuplet: int | None = None
    vibrato: bool = False
    palm_mute: bool = False
    let_ring: bool = False
    staccato: bool = False
    multibar_rest: int = 0
    notes: list[_PTNote] = field(default_factory=list)


@dataclass
class _PTStaff:
    string_count: int
    voices: list[list[_PTPosition]]


@dataclass
class _PTSection:
    start_bar: _PTBarLine
    last_bar_type: int
    last_bar_repeats: int
    staffs: list[_PTStaff]
    barlines: list[_PTBarLine]


@dataclass
class _PTScoreBlock:
    default_name: str
    default_strings: list[int]
    default_instrument: int
    infos: list[_PTTrackInfo]
    tempos: dict[tuple[int, int], int]
    endings: dict[tuple[int, int], list[int]]
    sections: list[_PTSection]


class _PTReader:
    def __init__(self, data: bytes) -> None:
        self._data = data
        self._pos = 0

    def _require(self, count: int) -> bytes:
        if self._pos + count > len(self._data):
            raise ImportError("Unexpected end of Power Tab file", "powertab.parse")
        chunk = self._data[self._pos : self._pos + count]
        self._pos += count
        return chunk

    def u8(self) -> int:
        return self._require(1)[0]

    def i8(self) -> int:
        return int(struct.unpack("<b", self._require(1))[0])

    def u16(self) -> int:
        return int(struct.unpack("<H", self._require(2))[0])

    def i32(self) -> int:
        return int(struct.unpack("<i", self._require(4))[0])

    def u32(self) -> int:
        return int(struct.unpack("<I", self._require(4))[0])

    def skip(self, count: int) -> None:
        self._require(count)

    def string(self) -> str:
        length = self.u8()
        if length == 0xFF:
            length = self.u16()
        if length == 0:
            return ""
        raw = self._require(length)
        try:
            return raw.decode("utf-8")
        except UnicodeDecodeError:
            return raw.decode("cp1252", errors="replace")

    def header_items(self) -> int:
        count = self.u16()
        if count != 0:
            self._read_class_tag()
        return count

    def next_item_tag(self) -> None:
        self._read_class_tag()

    def _read_class_tag(self) -> None:
        header = self.u16()
        if header == 0xFFFF:
            schema = self.u16()
            if schema != 1:
                raise ImportError(f"Unsupported Power Tab class schema: {schema}", "powertab.parse")
            class_len = self.u16()
            self.skip(class_len)


def parse_powertab(
    data: bytes, *, filename: str = "song.ptb", prefer: str = "bass"
) -> tuple[ScoreDocument, str, str, list[Notice]]:
    if not is_powertab(data):
        raise ImportError("Not a supported Power Tab (.ptb) file", "powertab.parse")

    r = _PTReader(data)
    r.skip(4)  # "ptab"
    version = r.u16()
    if version != 4:
        raise ImportError(f"Unsupported Power Tab file version: {version}", "powertab.parse")

    title, artist = _read_song_info(r, filename)
    guitar_block = _read_score_block(
        r,
        default_name="Guitar",
        default_strings=[64, 59, 55, 50, 45, 40],
        default_instrument=25,
    )
    bass_block = _read_score_block(
        r,
        default_name="Bass",
        default_strings=[43, 38, 33, 28],
        default_instrument=33,
    )

    built_tracks: list[Track] = []
    block_bars_list: list[list[Bar]] = []
    opening_tempo: float | None = None

    for block_idx, block in enumerate((guitar_block, bass_block)):
        tracks_out, bars_out, block_tempo = _convert_score_block(block_idx, block)
        if tracks_out:
            built_tracks.extend(tracks_out)
            block_bars_list.append(bars_out)
            if opening_tempo is None and block_tempo is not None:
                opening_tempo = block_tempo

    if not built_tracks:
        raise ImportError("Power Tab file contains no playable tracks", "powertab.noTracks")

    master_bars = _merge_bars(block_bars_list)
    for tr in built_tracks:
        while len(tr.bars) < len(master_bars):
            tr.bars.append(TrackBar())

    _mark_preferred(built_tracks, prefer)

    return (
        ScoreDocument(
            bpm=opening_tempo or 120.0,
            bars=master_bars,
            tracks=built_tracks,
        ),
        title,
        artist,
        [],
    )


def _read_song_info(r: _PTReader, filename: str) -> tuple[str, str]:
    classification = r.u8()
    title = ""
    artist = ""
    if classification == 0:
        r.u8()  # flags
        title = r.string()
        artist = r.string()
        release_type = r.u8()
        if release_type == 0:
            r.u8()
            r.string()
            r.u16()
            r.u8()
        elif release_type == 1:
            r.string()
            r.u8()
        elif release_type == 2:
            r.string()
            r.u16()
            r.u16()
            r.u16()
        if r.u8() == 0:
            author = r.string()
            _lyricist = r.string()
            if not artist and author:
                artist = author
        for _ in range(7):
            r.string()
    elif classification == 1:
        title = r.string()
        artist = r.string()
        r.u16()
        r.u8()
        author = r.string()
        if not artist and author:
            artist = author
        r.string()
        r.string()
    else:
        raise ImportError(f"Unsupported Power Tab classification: {classification}", "powertab.parse")

    return title or Path(filename).stem or "Untitled", artist


def _read_score_block(
    r: _PTReader,
    *,
    default_name: str,
    default_strings: list[int],
    default_instrument: int,
) -> _PTScoreBlock:
    # 1. Guitars (PTTrackInfo)
    infos: list[_PTTrackInfo] = []
    info_count = r.header_items()
    for j in range(info_count):
        number = r.u8()
        name = r.string()
        instrument = r.u8()
        r.skip(6)  # volume, balance, reverb, chorus, tremolo, phaser
        capo = max(0, min(24, r.u8()))
        _tuning_name = r.string()
        _offset = r.u8()
        str_count = r.u8()
        strings = [r.u8() for _ in range(str_count)]
        infos.append(
            _PTTrackInfo(
                number=number,
                name=name or default_name,
                instrument=instrument,
                capo=capo,
                strings=strings or list(default_strings),
            )
        )
        if j < info_count - 1:
            r.next_item_tag()

    # 2. Chord diagrams
    cd_count = r.header_items()
    for j in range(cd_count):
        r.u16()
        r.u8()
        r.u8()
        frets_len = r.u8()
        r.skip(frets_len)
        if j < cd_count - 1:
            r.next_item_tag()

    # 3. Floating texts
    ft_count = r.header_items()
    for j in range(ft_count):
        r.string()
        r.skip(16)  # rect
        r.u8()
        # font: name + 13 bytes
        r.string()
        r.skip(13)
        if j < ft_count - 1:
            r.next_item_tag()

    # 4. Guitar-ins
    gi_count = r.header_items()
    for j in range(gi_count):
        r.u16()
        r.u8()
        r.u8()
        r.u8()
        r.u8()
        if j < gi_count - 1:
            r.next_item_tag()

    # 5. Tempo markers
    tempos: dict[tuple[int, int], int] = {}
    tm_count = r.header_items()
    for j in range(tm_count):
        sec = r.u16()
        pos = r.u8()
        bpm = r.u16()
        _data = r.u16()
        _desc = r.string()
        if 10 <= bpm <= 400:
            tempos[(sec, pos)] = bpm
        if j < tm_count - 1:
            r.next_item_tag()

    # 6. Dynamic markers
    dyn_count = r.header_items()
    for j in range(dyn_count):
        r.u16()
        r.u8()
        r.u8()
        r.u16()
        if j < dyn_count - 1:
            r.next_item_tag()

    # 7. Section symbols (alternate endings)
    endings: dict[tuple[int, int], list[int]] = {}
    ss_count = r.header_items()
    for j in range(ss_count):
        sec = r.u16()
        pos = r.u8()
        sdata = r.u32()
        low = sdata & 0xFF
        nums = [bit + 1 for bit in range(8) if low & (1 << bit)]
        if not nums and 1 <= low <= 8:
            nums = [low]
        if nums:
            endings[(sec, pos)] = nums
        if j < ss_count - 1:
            r.next_item_tag()

    # 8. Sections
    sections: list[_PTSection] = []
    sec_count = r.header_items()
    for j in range(sec_count):
        sections.append(_read_section(r))
        if j < sec_count - 1:
            r.next_item_tag()

    return _PTScoreBlock(
        default_name=default_name,
        default_strings=default_strings,
        default_instrument=default_instrument,
        infos=infos,
        tempos=tempos,
        endings=endings,
        sections=sections,
    )


def _read_section(r: _PTReader) -> _PTSection:
    r.skip(16)  # rect
    last_bar_data = r.u8()
    last_bar_type = (last_bar_data >> 5) & 0x07
    last_bar_repeats = last_bar_data & 0x1F
    r.skip(4)  # spacing
    start_bar = _read_barline(r)

    # Directions
    dir_count = r.header_items()
    for j in range(dir_count):
        r.u8()
        sym_count = r.u8()
        r.skip(sym_count * 2)
        if j < dir_count - 1:
            r.next_item_tag()

    # Chord texts
    ct_count = r.header_items()
    for j in range(ct_count):
        r.u8()
        r.u16()
        r.u8()
        r.u8()
        if j < ct_count - 1:
            r.next_item_tag()

    # Rhythm slashes
    rs_count = r.header_items()
    for j in range(rs_count):
        r.u8()
        r.u8()
        r.i32()
        if j < rs_count - 1:
            r.next_item_tag()

    # Staffs
    staffs: list[_PTStaff] = []
    staff_count = r.header_items()
    for j in range(staff_count):
        staffs.append(_read_staff(r))
        if j < staff_count - 1:
            r.next_item_tag()

    # Music bars (barlines)
    barlines: list[_PTBarLine] = []
    bar_count = r.header_items()
    for j in range(bar_count):
        barlines.append(_read_barline(r))
        if j < bar_count - 1:
            r.next_item_tag()

    return _PTSection(
        start_bar=start_bar,
        last_bar_type=last_bar_type,
        last_bar_repeats=last_bar_repeats,
        staffs=staffs,
        barlines=barlines,
    )


def _read_barline(r: _PTReader) -> _PTBarLine:
    pos = r.u8()
    bdata = r.u8()
    bar_type = (bdata >> 5) & 0x07
    repeat_count = bdata & 0x1F

    # Key signature: 1 byte
    r.u8()

    # Time signature: 4-byte data + 1-byte pulses
    ts_data = r.u32()
    _pulses = r.u8()
    # In Power Tab TimeSignature: bits 0..2 = denominator power or meter flags;
    # specifically in PTInputStream / powertabeditor:
    # beatsPerMeasure = ((ts_data >> 24) & 0x1F) + 1
    # beatAmount = 1 << ((ts_data >> 21) & 0x07)
    # shown if (ts_data & 0x80) != 0 or beats > 0
    signature: tuple[int, int] | None = None
    if ts_data != 0:
        num = ((ts_data >> 24) & 0x1F) + 1
        den_pow = (ts_data >> 21) & 0x07
        den = 1 << den_pow
        if 1 <= num <= 32 and den in (1, 2, 4, 8, 16, 32):
            signature = (num, den)

    # Rehearsal sign: i8 letter + string description
    letter = r.i8()
    desc = r.string()
    section_label: str | None = None
    if desc:
        section_label = desc
    elif 65 <= letter <= 90:
        section_label = chr(letter)

    return _PTBarLine(
        position=pos,
        bar_type=bar_type,
        repeat_count=repeat_count,
        signature=signature,
        section=section_label,
    )


def _read_staff(r: _PTReader) -> _PTStaff:
    flags = r.u8()
    string_count = flags & 0x0F
    r.u8()  # clef / tab info
    r.skip(3)  # spacing
    voices: list[list[_PTPosition]] = []
    for _ in range(2):
        positions: list[_PTPosition] = []
        p_count = r.header_items()
        for j in range(p_count):
            positions.append(_read_position(r))
            if j < p_count - 1:
                r.next_item_tag()
        voices.append(positions)
    return _PTStaff(string_count=string_count or 6, voices=voices)


def _read_position(r: _PTReader) -> _PTPosition:
    pos = r.u8()
    beam0 = r.u8()
    _beam1 = r.u8()
    data1 = r.u8()
    data2 = r.u8()
    data3 = r.u8()
    duration_value = max(1, r.u8())

    dotted = bool(data1 & 0x01)
    double_dotted = bool(data1 & 0x02)
    is_rest = bool(data1 & 0x04)
    vibrato = bool(data1 & 0x08) or bool(data1 & 0x10)
    staccato = bool(data2 & 0x02)
    palm_mute = bool(data2 & 0x20)
    let_ring = bool(data2 & 0x40)
    grace = bool(data3 & 0x01)

    tuplet: int | None = None
    irr = beam0 & 0x07
    if irr == 1 or bool(data3 & 0x02):
        tuplet = 3
    elif 2 <= irr <= 6:
        tuplet = {2: 5, 3: 6, 4: 7, 5: 9, 6: 10}.get(irr)

    multibar_rest = 0
    complex_count = r.u8()
    for _ in range(complex_count):
        sym = r.u32()
        stype = sym & 0xFF
        if stype == 117:  # 'u' = multibar rest
            multibar_rest = (sym >> 24) & 0xFF

    notes: list[_PTNote] = []
    n_count = r.header_items()
    for j in range(n_count):
        notes.append(_read_note(r))
        if j < n_count - 1:
            r.next_item_tag()

    return _PTPosition(
        position=pos,
        duration_value=duration_value,
        dotted=dotted,
        double_dotted=double_dotted,
        is_rest=is_rest,
        grace=grace,
        tuplet=tuplet,
        vibrato=vibrato,
        palm_mute=palm_mute,
        let_ring=let_ring,
        staccato=staccato,
        multibar_rest=multibar_rest,
        notes=notes,
    )


def _read_note(r: _PTReader) -> _PTNote:
    pos_byte = r.u8()
    string_idx = (pos_byte >> 5) & 0x07
    fret = pos_byte & 0x1F
    simple = r.u16()

    tie = bool(simple & 0x0001)
    dead = bool(simple & 0x0002)
    hammer = bool(simple & 0x0008) or bool(simple & 0x0010)
    harmonic: str | None = "natural" if (simple & 0x0040) else None
    ghost = bool(simple & 0x0080)

    slide: str | None = None
    bend: float | None = None

    sym_count = r.u8()
    for _ in range(sym_count):
        sym = r.u32()
        stype = sym & 0xFF
        d1 = (sym >> 8) & 0xFF
        if stype == 100:  # 'd' = slide
            slide = "shift" if d1 == 1 else "legato"
        elif stype == 101:  # 'e' = bend
            bent_pitch = d1 & 0x0F
            if bent_pitch > 0:
                bend = min(4.0, round(bent_pitch / 2.0, 2))
        elif stype == 102:  # 'f' = tapped harmonic
            harmonic = "tap"
        elif stype == 104:  # 'h' = artificial harmonic
            harmonic = "artificial"

    return _PTNote(
        string=string_idx,
        fret=fret,
        tie=tie,
        dead=dead,
        ghost=ghost,
        hammer=hammer,
        slide=slide,
        harmonic=harmonic,
        bend=bend,
    )


def _convert_score_block(block_idx: int, block: _PTScoreBlock) -> tuple[list[Track], list[Bar], float | None]:
    if not block.sections:
        return [], [], None

    max_staffs = max((len(sec.staffs) for sec in block.sections), default=0)
    if max_staffs == 0:
        return [], [], None

    bars: list[Bar] = []
    staff_track_bars: list[list[TrackBar]] = [[] for _ in range(max_staffs)]
    staff_has_notes = [False] * max_staffs
    signature = (4, 4)
    opening_tempo: float | None = None

    for sec_idx, sec in enumerate(block.sections):
        # Determine measure slices within this section
        all_positions = sorted({p.position for staff in sec.staffs for voice in staff.voices for p in voice})
        max_pos = all_positions[-1] if all_positions else 0

        interior_bars: list[_PTBarLine] = []
        closing_bars: list[_PTBarLine] = []
        for bl in sorted(sec.barlines, key=lambda b: b.position):
            if bl.position == 0:
                continue
            if all_positions and bl.position > max_pos:
                closing_bars.append(bl)
            else:
                interior_bars.append(bl)

        boundaries: list[tuple[int, int, _PTBarLine, _PTBarLine | None]] = []
        starts = [sec.start_bar, *interior_bars]
        for idx, s_bl in enumerate(starts):
            start_pos = 0 if idx == 0 else s_bl.position
            end_pos = starts[idx + 1].position if idx + 1 < len(starts) else 256
            close_bl: _PTBarLine | None = None
            if idx + 1 < len(starts) and starts[idx + 1].bar_type in (2, 4):
                close_bl = starts[idx + 1]
            elif idx + 1 == len(starts) and closing_bars:
                close_bl = closing_bars[-1]
            boundaries.append((start_pos, end_pos, s_bl, close_bl))

        for b_idx, (start_pos, end_pos, s_bl, close_bl) in enumerate(boundaries):
            if s_bl.signature is not None:
                signature = s_bl.signature
            bar_fields: dict[str, Any] = {}
            if s_bl.section:
                bar_fields["section"] = s_bl.section
            if s_bl.bar_type == 3:
                bar_fields["repeat_start"] = True
            if close_bl is not None and close_bl.bar_type == 4:
                bar_fields["repeat_end"] = max(2, close_bl.repeat_count)
            elif b_idx == len(boundaries) - 1 and sec.last_bar_type == 4:
                bar_fields["repeat_end"] = max(2, sec.last_bar_repeats)

            # Check tempos and alternate endings in [start_pos, end_pos)
            for (t_sec, t_pos), bpm in block.tempos.items():
                if t_sec == sec_idx and start_pos <= t_pos < end_pos:
                    if not bars and opening_tempo is None:
                        opening_tempo = float(bpm)
                    else:
                        bar_fields["tempo"] = float(bpm)

            for (e_sec, e_pos), end_nums in block.endings.items():
                if e_sec == sec_idx and start_pos <= e_pos < end_pos:
                    bar_fields["alternate_endings"] = list(end_nums)

            bars.append(Bar(signature=signature, **bar_fields))

            for staff_idx in range(max_staffs):
                if staff_idx >= len(sec.staffs):
                    staff_track_bars[staff_idx].append(TrackBar())
                    continue
                staff = sec.staffs[staff_idx]
                built_voices: list[Voice] = []
                for voice_positions in staff.voices:
                    slice_positions = [p for p in voice_positions if start_pos <= p.position < end_pos]
                    if not slice_positions:
                        continue
                    v_beats, saw_notes = _positions_to_beats(slice_positions, staff.string_count)
                    if saw_notes:
                        staff_has_notes[staff_idx] = True
                    if v_beats:
                        built_voices.append(Voice(beats=v_beats))
                staff_track_bars[staff_idx].append(TrackBar(voices=built_voices or [Voice()]))

    tracks: list[Track] = []
    for staff_idx in range(max_staffs):
        if not staff_has_notes[staff_idx]:
            continue
        info = block.infos[staff_idx] if staff_idx < len(block.infos) else (block.infos[0] if block.infos else None)
        name = info.name if info is not None else block.default_name
        if max_staffs > 1 and staff_idx >= len(block.infos):
            name = f"{name} {staff_idx + 1}"
        tuning = list(info.strings) if (info is not None and info.strings) else list(block.default_strings)
        capo = info.capo if info is not None else 0
        program = info.instrument if info is not None else block.default_instrument
        instrument = _infer_instrument(tuning, name, program)

        tracks.append(
            Track(
                id=f"ptb-{block_idx}-{staff_idx}",
                name=name,
                instrument=instrument,
                tuning_midi=tuning,
                capo=capo,
                bars=staff_track_bars[staff_idx] or [TrackBar()],
            )
        )

    return tracks, bars, opening_tempo


def _positions_to_beats(positions: list[_PTPosition], num_strings: int) -> tuple[list[Beat], bool]:
    beats: list[Beat] = []
    cursor = 0
    saw_notes = False

    for p in positions:
        ticks = round(TICKS_PER_QUARTER * 4 / max(1, p.duration_value))
        if p.dotted:
            ticks = ticks * 3 // 2
        elif p.double_dotted:
            ticks = ticks * 7 // 4
        if p.tuplet is not None and p.tuplet >= 2:
            normal = 2 if p.tuplet == 3 else 4
            ticks = round(ticks * normal / p.tuplet)
        ticks = max(1, ticks)

        notes_by_str: dict[int, Note] = {}
        if not p.is_rest and not p.multibar_rest:
            for n in p.notes:
                if 0 <= n.string < num_strings:
                    saw_notes = True
                    notes_by_str[n.string] = Note(
                        string=n.string,
                        fret=n.fret,
                        dead=n.dead,
                        ghost=n.ghost,
                        tie=n.tie,
                        hammer=n.hammer,
                        slide=n.slide,  # type: ignore[arg-type]
                        vibrato=p.vibrato,
                        harmonic=n.harmonic,  # type: ignore[arg-type]
                        palm_mute=p.palm_mute,
                        let_ring=p.let_ring,
                        staccato=p.staccato,
                        bend=n.bend,
                    )

        beats.append(
            Beat(
                position=cursor,
                duration=TICKS_PER_QUARTER // 4 if p.grace else ticks,
                notes=[notes_by_str[s] for s in sorted(notes_by_str)],
                grace="before_beat" if p.grace else None,
                tuplet=None if p.grace else p.tuplet,
            )
        )
        if not p.grace:
            cursor += ticks

    return beats, saw_notes


def _merge_bars(block_bars_list: list[list[Bar]]) -> list[Bar]:
    if not block_bars_list:
        return [Bar()]
    longest = max(block_bars_list, key=len)
    merged = [b.model_copy(deep=True) for b in longest]
    for b_list in block_bars_list:
        for idx, b in enumerate(b_list):
            target = merged[idx]
            if b.tempo is not None and target.tempo is None:
                target.tempo = b.tempo
            if b.section and not target.section:
                target.section = b.section
            if b.repeat_start:
                target.repeat_start = True
            if b.repeat_end and not target.repeat_end:
                target.repeat_end = b.repeat_end
            if b.alternate_endings and not target.alternate_endings:
                target.alternate_endings = list(b.alternate_endings)
    return merged or [Bar()]


def _infer_instrument(tuning: list[int], name: str, program: int | None) -> str:
    lower = name.lower()
    if len(tuning) <= 5 or "bass" in lower or (program is not None and _is_bass_program(program)):
        return "bass-guitar"
    return "guitar"


def _mark_preferred(tracks: list[Track], prefer: str) -> None:
    for track in tracks:
        if prefer == "bass" and (len(track.tuning_midi) <= 5 or "bass" in track.instrument):
            track.preferred = True
            return
        if prefer == "guitar" and len(track.tuning_midi) >= 6 and "bass" not in track.instrument:
            track.preferred = True
            return
    tracks[0].preferred = True
