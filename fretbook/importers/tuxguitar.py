"""TuxGuitar (``.tg``) importer.

Supports both TuxGuitar file formats:

* **TuxGuitar 1.x binary** (``TuxGuitar File Format - 1.2``, ``1.3``, ``1.5``): big-endian binary
  stream beginning with a length-prefixed UTF-16BE version string.
* **TuxGuitar 2.0 archive** (``TuxGuitar_file_format 2.x``): a ZIP archive holding ``version.txt``
  and ``content.xml`` (rooted at ``<TuxGuitarFile><TGSong>``).

Conventions in TuxGuitar:

* Strings are 1-based from the **highest-pitched** string (``string = 1`` -> Fretbook ``string = 0``),
  and ``<TGString>`` / track string lists are ordered highest string first, matching Fretbook's
  ``tuning_midi``.
* ``repeatClose`` stores the number of **additional** passes (``repeatClose = 1`` means play twice,
  so Fretbook's ``repeat_end = repeatClose + 1``).
* ``repeatAlternative`` is an 8-bit mask where bit ``k`` (0-based) means ending ``k + 1``.
"""

from __future__ import annotations

import io
import struct
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from xml.etree.ElementTree import Element

from fretbook.importers.base import ImportError, ImportRequest, ImportResult, Progress
from fretbook.importers.musicxml import _directions, _words_marks
from fretbook.score.instruments import canonical_instrument, get_preset
from fretbook.score.model import (
    TICKS_PER_QUARTER,
    Bar,
    Beat,
    HarmonicKind,
    Note,
    ScoreDocument,
    Track,
    TrackBar,
    Voice,
)

EXTENSIONS = (".tg",)
MAX_TG_BYTES = 50 * 1024 * 1024
TG_MAGIC_PREFIX = "TuxGuitar File Format"
_TG_V1_PREFIX = TG_MAGIC_PREFIX.encode("utf-16-be")


def is_tuxguitar_v1(head: bytes) -> bool:
    """Return True if ``head`` begins with the TuxGuitar 1.x binary version string."""
    if len(head) < 1 + len(_TG_V1_PREFIX):
        return False
    length = head[0]
    if length < len(TG_MAGIC_PREFIX) or length > 64:
        return False
    return head[1 : 1 + len(_TG_V1_PREFIX)] == _TG_V1_PREFIX


TRACK_SOLO = 0x01
TRACK_MUTE = 0x02
TRACK_LYRICS = 0x04

MEASURE_HEADER_TIMESIGNATURE = 0x01
MEASURE_HEADER_TEMPO = 0x02
MEASURE_HEADER_REPEAT_OPEN = 0x04
MEASURE_HEADER_REPEAT_CLOSE = 0x08
MEASURE_HEADER_REPEAT_ALTERNATIVE = 0x10
MEASURE_HEADER_MARKER = 0x20
MEASURE_HEADER_TRIPLET_FEEL = 0x40

MEASURE_CLEF = 0x01
MEASURE_KEYSIGNATURE = 0x02

BEAT_HAS_NEXT = 0x01
BEAT_HAS_STROKE = 0x02
BEAT_HAS_CHORD = 0x04
BEAT_HAS_TEXT = 0x08
BEAT_HAS_VOICE = 0x10
BEAT_HAS_VOICE_CHANGES = 0x20

VOICE_HAS_NOTES = 0x01
VOICE_NEXT_DURATION = 0x02
VOICE_DIRECTION_UP = 0x04
VOICE_DIRECTION_DOWN = 0x08

NOTE_HAS_NEXT = 0x01
NOTE_TIED = 0x02
NOTE_EFFECT = 0x04
NOTE_VELOCITY = 0x08

DURATION_DOTTED = 0x01
DURATION_DOUBLE_DOTTED = 0x02
DURATION_NO_TUPLET = 0x04

EFFECT_BEND = 0x000001
EFFECT_TREMOLO_BAR = 0x000002
EFFECT_HARMONIC = 0x000004
EFFECT_GRACE = 0x000008
EFFECT_TRILL = 0x000010
EFFECT_TREMOLO_PICKING = 0x000020
EFFECT_VIBRATO = 0x000040
EFFECT_DEAD = 0x000080
EFFECT_SLIDE = 0x000100
EFFECT_HAMMER = 0x000200
EFFECT_GHOST = 0x000400
EFFECT_ACCENTUATED = 0x000800
EFFECT_HEAVY_ACCENTUATED = 0x001000
EFFECT_PALM_MUTE = 0x002000
EFFECT_STACCATO = 0x004000
EFFECT_TAPPING = 0x008000
EFFECT_SLAPPING = 0x010000
EFFECT_POPPING = 0x020000
EFFECT_FADE_IN = 0x040000
EFFECT_LET_RING = 0x080000

GRACE_FLAG_DEAD = 0x01
GRACE_FLAG_ON_BEAT = 0x02

MIN_OFFSET = -24
MAX_VOICES = 2

_HARMONIC_MAP: dict[int, HarmonicKind] = {
    1: "natural",
    2: "artificial",
    3: "tap",
    4: "pinch",
    5: "semi",
}


@dataclass
class _TGDuration:
    value: int = 4
    dotted: bool = False
    double_dotted: bool = False
    enters: int = 1
    times: int = 1

    def copy(self) -> _TGDuration:
        return _TGDuration(
            value=self.value,
            dotted=self.dotted,
            double_dotted=self.double_dotted,
            enters=self.enters,
            times=self.times,
        )

    def ticks(self) -> int:
        if self.value <= 0:
            return TICKS_PER_QUARTER
        base = (4 * TICKS_PER_QUARTER) // self.value
        if self.dotted:
            base += base // 2
        elif self.double_dotted:
            base += (base * 3) // 4
        if self.enters > 0 and self.times > 0 and (self.enters != self.times):
            base = round(base * self.times / self.enters)
        return max(1, base)

    @property
    def tuplet_hint(self) -> int | None:
        if self.enters != self.times and 2 <= self.enters <= 16:
            return self.enters
        return None


@dataclass
class _TGGrace:
    fret: int
    on_beat: bool = False
    dead: bool = False


@dataclass
class _TGNote:
    string: int
    fret: int
    tied: bool = False
    dead: bool = False
    ghost: bool = False
    hammer: bool = False
    slide: bool = False
    vibrato: bool = False
    harmonic: HarmonicKind | None = None
    bend: float | None = None
    palm_mute: bool = False
    let_ring: bool = False
    staccato: bool = False
    grace: _TGGrace | None = None


@dataclass
class _TGVoiceEvent:
    position: int
    duration: int
    notes: list[_TGNote] = field(default_factory=list)
    tuplet: int | None = None


@dataclass
class _TGChannel:
    channel_id: int
    bank: int = 0
    program: int = 25
    name: str = ""

    @property
    def is_percussion(self) -> bool:
        return self.bank == 128


@dataclass
class _TGMeasureHeader:
    signature: tuple[int, int] = (4, 4)
    tempo: float = 120.0
    repeat_open: bool = False
    repeat_close: int = 0
    repeat_alternative: int = 0
    marker: str | None = None


@dataclass
class _TGTrackData:
    name: str
    channel_id: int
    tuning: list[int]
    offset: int
    measures: list[list[list[_TGVoiceEvent]]]


class _BinaryReader:
    def __init__(self, data: bytes) -> None:
        self._buf = data
        self._pos = 0

    def _need(self, count: int) -> bytes:
        if self._pos + count > len(self._buf):
            raise EOFError("unexpected end of TuxGuitar stream")
        chunk = self._buf[self._pos : self._pos + count]
        self._pos += count
        return chunk

    def read_u8(self) -> int:
        return self._need(1)[0]

    def read_i8(self) -> int:
        return struct.unpack(">b", self._need(1))[0]

    def read_i16(self) -> int:
        return struct.unpack(">h", self._need(2))[0]

    def read_i32(self) -> int:
        return struct.unpack(">i", self._need(4))[0]

    def read_header(self, byte_count: int = 1) -> int:
        val = 0
        for i in range(byte_count, 0, -1):
            val += self.read_u8() << ((8 * i) - 8)
        return val

    def read_ubyte_string(self) -> str:
        length = self.read_u8()
        return self._read_chars(length)

    def read_int_string(self) -> str:
        length = self.read_i32()
        if length < 0 or length > 1_000_000:
            raise ValueError("invalid string length in TuxGuitar stream")
        return self._read_chars(length)

    def _read_chars(self, length: int) -> str:
        if length <= 0:
            return ""
        raw = self._need(length * 2)
        return raw.decode("utf-16-be", errors="replace")


class TuxGuitarImporter:
    kind = "tuxguitar"

    def can_handle(self, request: ImportRequest) -> bool:
        name = (request.filename or "").lower()
        return name.endswith(EXTENSIONS)

    def import_score(self, request: ImportRequest, progress: Progress) -> ImportResult:
        if request.file_path is None:
            raise ImportError("TuxGuitar import needs a file", "import.needsFile")
        progress("Reading TuxGuitar file", "import.readingFile")
        raw = request.file_path.read_bytes()
        if len(raw) > MAX_TG_BYTES:
            raise ImportError("this TuxGuitar file is larger than 50 MB", "tuxguitar.tooLarge")

        filename = request.filename or request.file_path.name
        prefer = str(request.options.get("prefer") or "")

        if raw[:4] == b"PK\x03\x04":
            title, artist, headers, channels, raw_tracks = _read_tg_zip(raw)
        else:
            title, artist, headers, channels, raw_tracks = _read_tg_binary(raw)

        return _build_result(
            title=title,
            artist=artist,
            headers=headers,
            channels=channels,
            raw_tracks=raw_tracks,
            filename=filename,
            prefer=prefer,
            progress=progress,
        )


def _read_tg_binary(data: bytes) -> tuple[str, str, list[_TGMeasureHeader], dict[int, _TGChannel], list[_TGTrackData]]:
    try:
        reader = _BinaryReader(data)
        version_str = reader.read_ubyte_string()
    except (EOFError, ValueError, struct.error) as exc:
        raise ImportError("TuxGuitar file could not be parsed", "tuxguitar.parse") from exc

    if not version_str.startswith(TG_MAGIC_PREFIX):
        raise ImportError("not a TuxGuitar file", "tuxguitar.parse")

    ver_num = version_str.rsplit("-", 1)[-1].strip() if "-" in version_str else ""
    if ver_num.startswith("1.2"):
        minor = 2
    elif ver_num.startswith("1.3") or ver_num.startswith("1.4"):
        minor = 3
    elif ver_num.startswith("1.5"):
        minor = 5
    else:
        raise ImportError(
            f"unsupported TuxGuitar version {version_str}",
            "tuxguitar.unsupportedVersion",
        )

    try:
        title = reader.read_ubyte_string()
        artist = reader.read_ubyte_string()
        _album = reader.read_ubyte_string()
        author = reader.read_ubyte_string()
        if not artist and author:
            artist = author
        if minor >= 3:
            _date = reader.read_ubyte_string()
            _copyright = reader.read_ubyte_string()
            writer = reader.read_ubyte_string()
            _transcriber = reader.read_ubyte_string()
            _comments = reader.read_int_string()
            if not artist and writer:
                artist = writer

        channels: dict[int, _TGChannel] = {}
        if minor >= 3:
            channel_count = reader.read_u8()
            for _ in range(channel_count):
                ch = _read_binary_channel(reader, has_params=(minor >= 5))
                channels[ch.channel_id] = ch

        header_count = reader.read_i16()
        if header_count < 0 or header_count > 10_000:
            raise ImportError("TuxGuitar file has invalid measure count", "tuxguitar.parse")
        headers: list[_TGMeasureHeader] = []
        last_header: _TGMeasureHeader | None = None
        for _ in range(header_count):
            mh = _read_binary_measure_header(reader, last_header)
            headers.append(mh)
            last_header = mh

        track_count = reader.read_u8()
        tracks: list[_TGTrackData] = []
        for idx in range(track_count):
            tracks.append(_read_binary_track(reader, idx, len(headers), minor, channels))
    except ImportError:
        raise
    except (EOFError, ValueError, struct.error) as exc:
        raise ImportError("TuxGuitar file could not be parsed", "tuxguitar.parse") from exc

    return title, artist, headers, channels, tracks


def _read_binary_channel(reader: _BinaryReader, *, has_params: bool) -> _TGChannel:
    channel_id = reader.read_i16()
    bank = reader.read_u8()
    program = reader.read_u8()
    _volume = reader.read_u8()
    _balance = reader.read_u8()
    _chorus = reader.read_u8()
    _reverb = reader.read_u8()
    _phaser = reader.read_u8()
    _tremolo = reader.read_u8()
    name = reader.read_ubyte_string()
    if has_params:
        param_count = reader.read_i16()
        for _ in range(max(0, param_count)):
            _key = reader.read_ubyte_string()
            _val = reader.read_int_string()
    return _TGChannel(channel_id=channel_id, bank=bank, program=program, name=name)


def _read_binary_duration(reader: _BinaryReader, target: _TGDuration) -> None:
    header = reader.read_header()
    target.dotted = bool(header & DURATION_DOTTED)
    target.double_dotted = bool(header & DURATION_DOUBLE_DOTTED)
    target.value = reader.read_u8()
    if header & DURATION_NO_TUPLET:
        target.enters = reader.read_u8()
        target.times = reader.read_u8()
    else:
        target.enters = 1
        target.times = 1


def _read_binary_measure_header(
    reader: _BinaryReader,
    last: _TGMeasureHeader | None,
) -> _TGMeasureHeader:
    header = reader.read_header()
    sig = last.signature if last is not None else (4, 4)
    tempo = last.tempo if last is not None else 120.0

    if header & MEASURE_HEADER_TIMESIGNATURE:
        num = reader.read_u8()
        den_dur = _TGDuration()
        _read_binary_duration(reader, den_dur)
        den = den_dur.value
        if 1 <= num <= 32 and den in {1, 2, 4, 8, 16, 32}:
            sig = (num, den)

    if header & MEASURE_HEADER_TEMPO:
        raw_tempo = reader.read_i16()
        if 0 < raw_tempo < 400:
            tempo = float(raw_tempo)

    repeat_open = bool(header & MEASURE_HEADER_REPEAT_OPEN)
    repeat_close = reader.read_i16() if (header & MEASURE_HEADER_REPEAT_CLOSE) else 0
    repeat_alt = reader.read_u8() if (header & MEASURE_HEADER_REPEAT_ALTERNATIVE) else 0

    marker: str | None = None
    if header & MEASURE_HEADER_MARKER:
        marker = reader.read_ubyte_string()
        _r, _g, _b = reader.read_u8(), reader.read_u8(), reader.read_u8()

    if header & MEASURE_HEADER_TRIPLET_FEEL:
        _triplet_feel = reader.read_u8()

    return _TGMeasureHeader(
        signature=sig,
        tempo=tempo,
        repeat_open=repeat_open,
        repeat_close=max(0, repeat_close),
        repeat_alternative=repeat_alt,
        marker=marker,
    )


def _read_binary_track(
    reader: _BinaryReader,
    index: int,
    measure_count: int,
    minor: int,
    channels: dict[int, _TGChannel],
) -> _TGTrackData:
    header = reader.read_header()
    name = reader.read_ubyte_string() or f"Track {index + 1}"

    if minor == 2:
        # v1.2 inline channel
        program = reader.read_u8()
        for _ in range(6):
            reader.read_u8()
        is_perc = bool(header & 0x08)
        channel_id = index + 1
        channels[channel_id] = _TGChannel(
            channel_id=channel_id,
            bank=128 if is_perc else 0,
            program=program,
            name=name,
        )
    else:
        channel_id = reader.read_i16()

    measures: list[list[list[_TGVoiceEvent]]] = []
    for _ in range(measure_count):
        measures.append(_read_binary_measure(reader))

    string_count = reader.read_u8()
    tuning: list[int] = []
    for _ in range(string_count):
        tuning.append(reader.read_u8())

    offset = MIN_OFFSET + reader.read_i8()
    _r, _g, _b = reader.read_u8(), reader.read_u8(), reader.read_u8()

    if header & TRACK_LYRICS:
        _lyrics_from = reader.read_i16()
        _lyrics_text = reader.read_int_string()

    return _TGTrackData(
        name=name,
        channel_id=channel_id,
        tuning=tuning,
        offset=offset,
        measures=measures,
    )


def _read_binary_measure(reader: _BinaryReader) -> list[list[_TGVoiceEvent]]:
    m_header = reader.read_header()
    voice_cursors = [0, 0]
    voice_flags = [0, 0]
    voice_durations = [_TGDuration(), _TGDuration()]
    voice_events: list[list[_TGVoiceEvent]] = [[], []]

    beat_header = BEAT_HAS_NEXT
    while beat_header & BEAT_HAS_NEXT:
        beat_header = reader.read_header()
        for v_idx in range(MAX_VOICES):
            shift = v_idx * 2
            if beat_header & (BEAT_HAS_VOICE << shift):
                if beat_header & (BEAT_HAS_VOICE_CHANGES << shift):
                    voice_flags[v_idx] = reader.read_header()
                flags = voice_flags[v_idx]
                if flags & VOICE_NEXT_DURATION:
                    _read_binary_duration(reader, voice_durations[v_idx])
                notes: list[_TGNote] = []
                if flags & VOICE_HAS_NOTES:
                    notes = _read_binary_notes(reader)
                dur = voice_durations[v_idx]
                ticks = dur.ticks()
                voice_events[v_idx].append(
                    _TGVoiceEvent(
                        position=voice_cursors[v_idx],
                        duration=ticks,
                        notes=notes,
                        tuplet=dur.tuplet_hint,
                    )
                )
                voice_cursors[v_idx] += ticks

        if beat_header & BEAT_HAS_STROKE:
            _stroke_dir = reader.read_u8()
            _stroke_val = reader.read_u8()
        if beat_header & BEAT_HAS_CHORD:
            chord_strings = reader.read_u8()
            _chord_name = reader.read_ubyte_string()
            _first_fret = reader.read_u8()
            for _ in range(chord_strings):
                reader.read_i8()
        if beat_header & BEAT_HAS_TEXT:
            _text_val = reader.read_ubyte_string()

    if m_header & MEASURE_CLEF:
        _clef = reader.read_u8()
    if m_header & MEASURE_KEYSIGNATURE:
        _keysig = reader.read_u8()

    return voice_events


def _read_binary_notes(reader: _BinaryReader) -> list[_TGNote]:
    notes: list[_TGNote] = []
    header = NOTE_HAS_NEXT
    while header & NOTE_HAS_NEXT:
        header = reader.read_header()
        fret = reader.read_u8()
        tg_string = reader.read_u8()
        tied = bool(header & NOTE_TIED)
        if header & NOTE_VELOCITY:
            _velocity = reader.read_u8()
        note = _TGNote(string=max(0, tg_string - 1), fret=max(0, min(99, fret)), tied=tied)
        if header & NOTE_EFFECT:
            _read_binary_note_effect(reader, note)
        notes.append(note)
    return notes


def _read_binary_note_effect(reader: _BinaryReader, note: _TGNote) -> None:
    eff = reader.read_header(3)
    if eff & EFFECT_BEND:
        pt_count = reader.read_u8()
        max_val = 0
        for _ in range(pt_count):
            _pos = reader.read_u8()
            val = reader.read_u8()
            max_val = max(max_val, val)
        # In TuxGuitar, value 4 = 1 full tone = 2 semitones -> value / 2.0 semitones
        if max_val > 0:
            note.bend = min(4.0, round(max_val / 2.0, 2))
    if eff & EFFECT_TREMOLO_BAR:
        pt_count = reader.read_u8()
        for _ in range(pt_count):
            reader.read_u8()
            reader.read_u8()
    if eff & EFFECT_HARMONIC:
        h_type = reader.read_u8()
        if h_type != 1:
            _h_data = reader.read_u8()
        note.harmonic = _HARMONIC_MAP.get(h_type, "natural")
    if eff & EFFECT_GRACE:
        g_header = reader.read_header()
        g_fret = reader.read_u8()
        _g_dur = reader.read_u8()
        _g_dyn = reader.read_u8()
        _g_trans = reader.read_u8()
        note.grace = _TGGrace(
            fret=max(0, min(99, g_fret)),
            on_beat=bool(g_header & GRACE_FLAG_ON_BEAT),
            dead=bool(g_header & GRACE_FLAG_DEAD),
        )
    if eff & EFFECT_TRILL:
        _trill_fret = reader.read_u8()
        _trill_dur = reader.read_u8()
    if eff & EFFECT_TREMOLO_PICKING:
        _tp_dur = reader.read_u8()

    note.vibrato = bool(eff & EFFECT_VIBRATO)
    note.dead = bool(eff & EFFECT_DEAD)
    note.slide = bool(eff & EFFECT_SLIDE)
    note.hammer = bool(eff & EFFECT_HAMMER)
    note.ghost = bool(eff & EFFECT_GHOST)
    note.palm_mute = bool(eff & EFFECT_PALM_MUTE)
    note.staccato = bool(eff & EFFECT_STACCATO)
    note.let_ring = bool(eff & EFFECT_LET_RING)


def _read_tg_zip(
    data: bytes,
) -> tuple[str, str, list[_TGMeasureHeader], dict[int, _TGChannel], list[_TGTrackData]]:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            names = set(archive.namelist())
            if "content.xml" not in names:
                raise ImportError("this .tg archive has no content.xml inside", "tuxguitar.parse")
            info = archive.getinfo("content.xml")
            if info.file_size > MAX_TG_BYTES:
                raise ImportError("this .tg archive unpacks to more than 50 MB", "tuxguitar.tooLarge")
            with archive.open(info) as handle:
                xml_bytes = handle.read(MAX_TG_BYTES + 1)
            if len(xml_bytes) > MAX_TG_BYTES:
                raise ImportError("this .tg archive unpacks to more than 50 MB", "tuxguitar.tooLarge")
        root = ET.fromstring(xml_bytes)
    except ImportError:
        raise
    except (zipfile.BadZipFile, KeyError, ET.ParseError) as exc:
        raise ImportError("TuxGuitar archive could not be parsed", "tuxguitar.parse") from exc

    song_el = root.find("TGSong") if root.tag == "TuxGuitarFile" else (root if root.tag == "TGSong" else None)
    if song_el is None:
        raise ImportError("expected a TuxGuitar <TGSong> XML document", "tuxguitar.parse")

    title = (song_el.findtext("name") or "").strip()
    artist = (
        (song_el.findtext("artist") or "").strip()
        or (song_el.findtext("author") or "").strip()
        or (song_el.findtext("writer") or "").strip()
    )

    channels: dict[int, _TGChannel] = {}
    for ch_el in song_el.findall("TGChannel"):
        cid = int(ch_el.findtext("channelId") or "0")
        bank = int(ch_el.findtext("bank") or "0")
        prog = int(ch_el.findtext("program") or "25")
        cname = (ch_el.findtext("name") or "").strip()
        channels[cid] = _TGChannel(channel_id=cid, bank=bank, program=prog, name=cname)

    headers: list[_TGMeasureHeader] = []
    for mh_el in song_el.findall("TGMeasureHeader"):
        ts_el = mh_el.find("timeSignature")
        sig = (4, 4)
        if ts_el is not None:
            num = int(ts_el.attrib.get("numerator", "4"))
            den = int(ts_el.attrib.get("denominator", "4"))
            if 1 <= num <= 32 and den in {1, 2, 4, 8, 16, 32}:
                sig = (num, den)
        raw_tempo = float(mh_el.findtext("tempo") or "120")
        tempo = raw_tempo if 0 < raw_tempo < 400 else 120.0
        rep_el = mh_el.find("repeat")
        rep_open = False
        rep_close = 0
        rep_alt = 0
        if rep_el is not None:
            rep_open = rep_el.attrib.get("open", "false").lower() == "true"
            rep_close = max(0, int(rep_el.attrib.get("close", "0")))
            rep_alt = max(0, int(rep_el.attrib.get("alternative", "0")))
        marker_el = mh_el.find("marker")
        marker = (marker_el.text or "").strip() if marker_el is not None and marker_el.text else None
        headers.append(
            _TGMeasureHeader(
                signature=sig,
                tempo=tempo,
                repeat_open=rep_open,
                repeat_close=rep_close,
                repeat_alternative=rep_alt,
                marker=marker,
            )
        )

    tracks: list[_TGTrackData] = []
    for idx, trk_el in enumerate(song_el.findall("TGTrack")):
        t_name = (trk_el.findtext("name") or "").strip() or f"Track {idx + 1}"
        cid = int(trk_el.findtext("channelId") or "0")
        offset = int(trk_el.findtext("offset") or "0")
        strings_el = trk_el.find("strings")
        str_nodes = strings_el.findall("TGString") if strings_el is not None else trk_el.findall("TGString")
        tuning = [int(s.text or "0") for s in str_nodes if (s.text or "").strip().isdigit()]

        measures: list[list[list[_TGVoiceEvent]]] = []
        for m_el in trk_el.findall("TGMeasure"):
            voice_cursors = [0, 0]
            voice_events: list[list[_TGVoiceEvent]] = [[], []]
            for beat_el in m_el.findall("TGBeat"):
                for v_idx, v_el in enumerate(beat_el.findall("TGVoice")[:MAX_VOICES]):
                    if v_el.attrib.get("empty", "false").lower() == "true":
                        continue
                    dur_el = v_el.find("duration")
                    if dur_el is None:
                        continue
                    dur = _TGDuration(
                        value=int(dur_el.attrib.get("value", "4")),
                        dotted=dur_el.attrib.get("dotted", "false").lower() == "true",
                        double_dotted=dur_el.attrib.get("doubleDotted", "false").lower() == "true",
                    )
                    div_el = dur_el.find("divisionType")
                    if div_el is not None:
                        dur.enters = int(div_el.attrib.get("enters", "1"))
                        dur.times = int(div_el.attrib.get("times", "1"))
                    ticks = dur.ticks()
                    notes = [_read_xml_note(n_el) for n_el in v_el.findall("TGNote")]
                    voice_events[v_idx].append(
                        _TGVoiceEvent(
                            position=voice_cursors[v_idx],
                            duration=ticks,
                            notes=notes,
                            tuplet=dur.tuplet_hint,
                        )
                    )
                    voice_cursors[v_idx] += ticks
            measures.append(voice_events)

        tracks.append(
            _TGTrackData(
                name=t_name,
                channel_id=cid,
                tuning=tuning,
                offset=offset,
                measures=measures,
            )
        )

    return title, artist, headers, channels, tracks


def _read_xml_note(note_el: Element) -> _TGNote:
    fret = int(note_el.findtext("value") or note_el.attrib.get("value", "0"))
    tg_string = int(note_el.findtext("string") or note_el.attrib.get("string", "1"))
    tied_text = note_el.findtext("tiedNote") or note_el.attrib.get("tiedNote", "false")
    note = _TGNote(
        string=max(0, tg_string - 1),
        fret=max(0, min(99, fret)),
        tied=tied_text.strip().lower() == "true",
    )
    eff_el = note_el.find("effect")
    if eff_el is not None:
        note.vibrato = eff_el.find("vibrato") is not None
        note.dead = eff_el.find("deadNote") is not None
        note.slide = eff_el.find("slide") is not None
        note.hammer = eff_el.find("hammer") is not None
        note.ghost = eff_el.find("ghostNote") is not None
        note.palm_mute = eff_el.find("palmMute") is not None
        note.staccato = eff_el.find("staccato") is not None
        note.let_ring = eff_el.find("letRing") is not None
        harm_el = eff_el.find("harmonic")
        if harm_el is not None:
            htype = int(harm_el.attrib.get("type", "1"))
            note.harmonic = _HARMONIC_MAP.get(htype, "natural")
        bend_el = eff_el.find("bend")
        if bend_el is not None:
            vals = [int(pt.attrib.get("value", "0")) for pt in bend_el.findall("point")]
            if vals and max(vals) > 0:
                note.bend = min(4.0, round(max(vals) / 2.0, 2))
        grace_el = eff_el.find("grace")
        if grace_el is not None:
            note.grace = _TGGrace(
                fret=max(0, min(99, int(grace_el.attrib.get("fret", "0")))),
                on_beat=grace_el.attrib.get("onBeat", "false").lower() == "true",
                dead=grace_el.attrib.get("dead", "false").lower() == "true",
            )
    return note


def _build_result(
    *,
    title: str,
    artist: str,
    headers: list[_TGMeasureHeader],
    channels: dict[int, _TGChannel],
    raw_tracks: list[_TGTrackData],
    filename: str,
    prefer: str,
    progress: Progress,
) -> ImportResult:
    if not headers or not raw_tracks:
        raise ImportError("this TuxGuitar file has no playable tracks", "tuxguitar.noNotes")

    opening_tempo = headers[0].tempo if headers else 120.0
    master_bars: list[Bar] = []
    marks_per_bar: list[set[str]] = []
    prev_tempo = opening_tempo

    for idx, mh in enumerate(headers):
        tempo_change: float | None = None
        if idx > 0 and mh.tempo != prev_tempo:
            tempo_change = mh.tempo
        prev_tempo = mh.tempo

        alt_endings = [bit + 1 for bit in range(8) if mh.repeat_alternative & (1 << bit)]
        own_marks: set[str] = set()
        section: str | None = None
        if mh.marker:
            own_marks = _words_marks(mh.marker)
            if not own_marks:
                section = mh.marker
        marks_per_bar.append(own_marks)
        master_bars.append(
            Bar(
                signature=mh.signature,
                tempo=tempo_change,
                repeat_start=mh.repeat_open,
                repeat_end=min(32, mh.repeat_close + 1) if mh.repeat_close > 0 else 0,
                alternate_endings=alt_endings,
                section=section,
            )
        )

    for bar, directions in zip(master_bars, _directions(marks_per_bar), strict=True):
        bar.directions = directions  # type: ignore[assignment]

    tracks: list[Track] = []
    for raw_trk in raw_tracks:
        channel = channels.get(raw_trk.channel_id)
        if channel is not None and channel.is_percussion:
            continue

        tuning = list(raw_trk.tuning)
        if not tuning:
            preset = get_preset("bass-4" if "bass" in raw_trk.name.lower() else "guitar-6")
            tuning = list(preset.tuning_midi)

        is_bass = (
            "bass" in raw_trk.name.lower() or (channel is not None and 32 <= channel.program < 40) or len(tuning) <= 5
        )
        instrument_kind = canonical_instrument(
            raw_trk.name,
            is_bass=is_bass,
            is_guitar=not is_bass,
        )
        capo = max(0, min(24, raw_trk.offset)) if raw_trk.offset > 0 else 0

        track_bars: list[TrackBar] = []
        has_any_notes = False
        for m_voices in raw_trk.measures[: len(master_bars)]:
            built_voices: list[Voice] = []
            for v_events in m_voices:
                if not v_events:
                    continue
                built_beats: list[Beat] = []
                for ev in v_events:
                    grace_notes = [
                        Note(
                            string=n.string,
                            fret=n.grace.fret,
                            dead=n.grace.dead,
                        )
                        for n in ev.notes
                        if n.grace is not None and 0 <= n.string < len(tuning)
                    ]
                    if grace_notes:
                        on_beat = any(n.grace.on_beat for n in ev.notes if n.grace is not None)
                        built_beats.append(
                            Beat(
                                position=ev.position,
                                duration=TICKS_PER_QUARTER // 4,
                                notes=sorted(grace_notes, key=lambda item: item.string),
                                grace="on_beat" if on_beat else "before_beat",
                            )
                        )
                    notes = [
                        Note(
                            string=n.string,
                            fret=n.fret,
                            dead=n.dead,
                            tie=n.tied,
                            ghost=n.ghost,
                            hammer=n.hammer,
                            slide="shift" if n.slide else None,
                            vibrato=n.vibrato,
                            harmonic=n.harmonic,
                            bend=n.bend,
                            palm_mute=n.palm_mute,
                            let_ring=n.let_ring,
                            staccato=n.staccato,
                        )
                        for n in ev.notes
                        if 0 <= n.string < len(tuning)
                    ]
                    if notes:
                        has_any_notes = True
                    notes.sort(key=lambda item: item.string)
                    built_beats.append(
                        Beat(
                            position=ev.position,
                            duration=max(1, ev.duration),
                            notes=notes,
                            tuplet=ev.tuplet,
                        )
                    )
                if built_beats:
                    built_voices.append(Voice(beats=built_beats))
            track_bars.append(TrackBar(voices=built_voices or [Voice()]))

        if not has_any_notes:
            continue

        while len(track_bars) < len(master_bars):
            track_bars.append(TrackBar())

        tracks.append(
            Track(
                id=f"trk_tg_{len(tracks)}",
                name=raw_trk.name,
                instrument=instrument_kind,
                capo=capo,
                tuning_midi=tuning,
                preferred=False,
                bars=track_bars,
            )
        )

    if not tracks:
        raise ImportError("this TuxGuitar file has no playable notes", "tuxguitar.noNotes")

    preferred_idx = 0
    if prefer:
        for idx, trk in enumerate(tracks):
            is_bass = trk.instrument == "bass-guitar" or len(trk.tuning_midi) <= 5
            if is_bass == (prefer == "bass"):
                preferred_idx = idx
                break
    for idx, trk in enumerate(tracks):
        trk.preferred = idx == preferred_idx

    slug_source = Path(filename or "song").stem or title or "song"
    slug = "".join(ch.lower() if ch.isalnum() else "-" for ch in slug_source).strip("-") or "song"
    progress("Tab ready", "import.tabReady")
    return ImportResult(
        title=title or slug,
        artist=artist,
        slug=slug[:60],
        document=ScoreDocument(bpm=opening_tempo, bars=master_bars, tracks=tracks),
        source_kind="tuxguitar",
        source_ref={"filename": filename},
    )
