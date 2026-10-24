"""Work out what a file or a piece of text is from its content.

The extension is only a fallback: a download called ``song.txt`` may be a
Guitar Pro file, and a ``.xml`` may not be MusicXML at all. :func:`sniff_bytes`
looks at magic bytes first and falls back to the extension for formats that
have none (plain text).

The kinds returned here are format names, not importer names. The registry maps
them to importers; formats Fretbook cannot read yet (PDF, images) are still
named so the UI can say so instead of "unrecognised".
"""

from __future__ import annotations

import io
import json
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path

from fretbook.chords import chordpro
from fretbook.importers.ascii_tab import looks_like_ascii_tab

GUITAR_PRO = "guitarpro"
MUSICXML = "musicxml"
MXL = "mxl"
MIDI = "midi"
CHORDPRO = "chordpro"
CHORDS_OVER_LYRICS = "chords-over-lyrics"
ASCII_TAB = "ascii-tab"
FRETBOOK_JSON = "fretbook-json"
FRETBOOK_ARCHIVE = "fretbook-archive"
PDF = "pdf"
IMAGE = "image"
AUDIO = "audio"

SUPPORTED_LABELS = (
    "Guitar Pro (.gp, .gp3, .gp4, .gp5, .gpx)",
    "MusicXML (.musicxml, .xml, .mxl)",
    "ChordPro and chords over lyrics",
    "ASCII tab",
    "MIDI (.mid, .midi)",
    "Fretbook JSON",
    "audio files (.mp3, .wav, .ogg, .m4a, .flac, .webm)",
)

HEAD_BYTES = 8192
"""How much of a file :func:`sniff_bytes` needs to see (a ZIP is read whole, up to :data:`MAX_ZIP_SNIFF`)."""
MAX_ZIP_SNIFF = 64 * 1024 * 1024
MAX_TEXT_CHARS = 200_000

# content type to store for audio, chosen from the bytes and never from the client
_AUDIO_SUFFIX = {
    "mp3": ".mp3",
    "wav": ".wav",
    "ogg": ".ogg",
    "m4a": ".m4a",
    "flac": ".flac",
    "webm": ".webm",
}
_MUSICXML_ROOT = re.compile(rb"<score-(?:partwise|timewise)[\s>]")
_GP_EXTENSIONS = {".gp", ".gp3", ".gp4", ".gp5", ".gpx"}
_XML_EXTENSIONS = {".musicxml", ".xml"}


@dataclass(frozen=True)
class Sniffed:
    kind: str | None
    """One of the format constants above, or ``None`` when nothing matched."""
    audio_suffix: str | None = None
    """For ``AUDIO``: the extension that matches the bytes (``.mp3``, ``.m4a`` …)."""


def _audio(head: bytes) -> str | None:
    if head.startswith(b"ID3") or (len(head) > 1 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0):
        return "mp3"
    if head.startswith(b"RIFF") and head[8:12] == b"WAVE":
        return "wav"
    if head.startswith(b"OggS"):
        return "ogg"
    if head.startswith(b"fLaC"):
        return "flac"
    if head[4:8] == b"ftyp" and head[8:12] in {b"M4A ", b"M4B ", b"mp42", b"isom", b"M4P "}:
        return "m4a"
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return "webm"
    return None


def _zip_kind(data: bytes) -> str | None:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            names = set(archive.namelist())
    except (zipfile.BadZipFile, ValueError):
        return None
    if "Content/score.gpif" in names:
        return GUITAR_PRO
    if "META-INF/container.xml" in names:
        return MXL
    if "manifest.json" in names:
        return FRETBOOK_ARCHIVE
    return None


def sniff_text(text: str) -> str | None:
    """Classify decoded text. Prose that matches nothing is ``None``, not a chord sheet."""
    stripped = text.strip()
    if not stripped or len(text) > MAX_TEXT_CHARS:
        return None
    if stripped.startswith("{"):
        try:
            payload = json.loads(stripped)
        except ValueError:
            payload = None
        if isinstance(payload, dict) and (
            payload.get("format") == "fretbook-song"
            or "document" in payload
            or "content_kind" in payload
            or {"bars", "tracks"} <= payload.keys()
        ):
            return FRETBOOK_JSON
    if stripped.startswith("<") and _MUSICXML_ROOT.search(stripped[:HEAD_BYTES].encode("utf-8", "ignore")):
        return MUSICXML
    if looks_like_ascii_tab(text):
        return ASCII_TAB
    if chordpro.looks_like_chordpro(text):
        return CHORDPRO
    lines = text.splitlines()[:400]
    for index, line in enumerate(lines[:-1]):
        following = lines[index + 1]
        if chordpro.is_chord_line(line) and following.strip() and not chordpro.is_chord_line(following):
            return CHORDS_OVER_LYRICS
    return None


def _decode(data: bytes) -> str | None:
    if b"\x00" in data:
        return None
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return None


def sniff_bytes(data: bytes, filename: str | None = None) -> Sniffed:
    """Identify ``data`` (the whole file, or at least :data:`HEAD_BYTES` of it).

    A ZIP needs the whole file to read its member names; pass ``data`` complete for ``.gp``,
    ``.mxl`` and archives, or use :func:`sniff_path`.
    """
    head = data[:HEAD_BYTES]
    suffix = Path(filename or "").suffix.lower()
    if head.startswith(b"\x18FICHIER GUITAR PRO") or head[:4] in {b"BCFZ", b"BCFS"}:
        return Sniffed(GUITAR_PRO)
    if head.startswith(b"PK\x03\x04"):
        return Sniffed(_zip_kind(data))
    if head.startswith(b"MThd"):
        return Sniffed(MIDI)
    if head.startswith(b"%PDF"):
        return Sniffed(PDF)
    if head.startswith(b"\x89PNG\r\n\x1a\n") or head.startswith(b"\xff\xd8\xff") or head[:6] in {b"GIF87a", b"GIF89a"}:
        return Sniffed(IMAGE)
    if head.startswith(b"RIFF") and head[8:12] == b"WEBP":
        return Sniffed(IMAGE)
    audio = _audio(head)
    if audio and not (audio == "mp3" and suffix in _GP_EXTENSIONS | _XML_EXTENSIONS | {".txt"}):
        return Sniffed(AUDIO, _AUDIO_SUFFIX[audio])
    text = _decode(data[: MAX_TEXT_CHARS * 2])
    if text is None:
        return Sniffed(None)
    return Sniffed(sniff_text(text))


def sniff_path(path: Path, filename: str | None = None) -> Sniffed:
    """:func:`sniff_bytes` for a file on disk, reading only what the format needs."""
    with path.open("rb") as handle:
        head = handle.read(HEAD_BYTES)
        if head.startswith(b"PK\x03\x04"):
            if path.stat().st_size > MAX_ZIP_SNIFF:
                return Sniffed(None)
            handle.seek(0)
            return sniff_bytes(handle.read(), filename)
        rest = handle.read(MAX_TEXT_CHARS * 2 - len(head)) if len(head) == HEAD_BYTES else b""
    return sniff_bytes(head + rest, filename)
