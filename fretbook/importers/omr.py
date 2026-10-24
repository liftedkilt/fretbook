"""Standard-notation sheet music (PDF or image) to a tab draft, by optical music recognition.

`Audiveris <https://github.com/Audiveris/audiveris>`_ turns the pages into MusicXML. The MusicXML reader then keeps
the pitches (standard notation has no strings or frets), :func:`fretbook.score.fingering.assign_frets` picks a string
and fret for every note on the instrument the reader chose, and the result is saved as a song marked ``needs_review``:
recognition is never perfect, so the song says so and the reader checks it against the page.

Audiveris is a Java program and large, so it is optional. Only the job worker runs it (``Dockerfile.worker`` installs it
when asked to); see :func:`available`. Tests pass a fake :data:`Recognizer`.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from collections.abc import Callable
from pathlib import Path

from fretbook.importers.base import ImportError, ImportRequest, ImportResult, Notice, Progress
from fretbook.importers.musicxml import read_score
from fretbook.score.fingering import assign_frets
from fretbook.score.instruments import InstrumentPreset, get_preset
from fretbook.score.model import Note, ScoreDocument, Track, TrackBar

ENGINE_ENV = "FRETBOOK_AUDIVERIS"
TIMEOUT_SECONDS = 900
SUFFIXES = (".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".gif", ".webp")
_CANDIDATES = ("audiveris", "Audiveris", "/opt/audiveris/bin/Audiveris")

# (page file, directory for the output, progress callback) -> the MusicXML file the engine wrote.
Recognizer = Callable[[Path, Path, Progress], Path]


def find_engine() -> str | None:
    """The Audiveris launcher: ``FRETBOOK_AUDIVERIS``, else ``audiveris`` on the PATH, else the package's own path."""
    configured = os.environ.get(ENGINE_ENV, "").strip()
    if configured:
        return configured if shutil.which(configured) else None
    for name in _CANDIDATES:
        found = shutil.which(name)
        if found:
            return found
    return None


def available() -> bool:
    """Whether this machine can run Audiveris. A worker that cannot does not advertise the job."""
    return find_engine() is not None


def run_audiveris(source: Path, out_dir: Path, progress: Progress) -> Path:
    """Recognise ``source`` and return the MusicXML Audiveris exported into ``out_dir``."""
    engine = find_engine()
    if engine is None:
        raise ImportError(
            "Audiveris is not installed on this worker, so sheet music cannot be read", "omr.unavailable"
        )
    progress("Reading the sheet music", "import.omrReading")
    command = [engine, "-batch", "-export", "-output", str(out_dir), str(source)]
    try:
        done = subprocess.run(
            command, capture_output=True, text=True, timeout=TIMEOUT_SECONDS, check=False, stdin=subprocess.DEVNULL
        )
    except subprocess.TimeoutExpired as exc:
        raise ImportError("reading the sheet music took too long", "omr.timeout") from exc
    except OSError as exc:
        raise ImportError(f"Audiveris could not be started: {exc}", "omr.unavailable") from exc
    found = sorted(path for suffix in ("*.mxl", "*.musicxml", "*.xml") for path in out_dir.rglob(suffix))
    if done.returncode != 0 or not found:
        raise ImportError("no music could be recognised in this file", "omr.noMusic")
    return found[0]


def _octave_shift(clef: tuple[str, int] | None, bass: bool) -> int:
    """Semitones from the written pitch to the sounding one.

    Guitar is written an octave above where it sounds, and so is bass guitar. A clef that already says so
    (treble 8vb) is left alone, and so is a guitar part written in a bass clef.
    """
    sign, change = clef or ("G", 0)
    if change != 0:
        return 0
    return -12 if sign == "G" or bass else 0


def _preset(options: dict) -> InstrumentPreset:
    return get_preset("bass-4" if str(options.get("prefer") or "") == "bass" else "guitar-6")


def _slug(name: str) -> str:
    slug = "".join(ch.lower() if ch.isalnum() else "-" for ch in Path(name).stem).strip("-")
    return (slug or "sheet-music")[:60]


class OmrImporter:
    kind = "omr"

    def __init__(self, recognizer: Recognizer | None = None) -> None:
        self._recognizer = recognizer or run_audiveris

    def can_handle(self, request: ImportRequest) -> bool:
        return (request.filename or "").lower().endswith(SUFFIXES)

    def import_score(self, request: ImportRequest, progress: Progress) -> ImportResult:
        if request.file_path is None:
            raise ImportError("sheet music import needs a file", "import.needsFile")
        preset = _preset(request.options)
        with tempfile.TemporaryDirectory(prefix="fretbook-omr-") as scratch:
            xml = self._recognizer(request.file_path, Path(scratch), progress)
            progress("Choosing frets", "import.omrFingering")
            title, artist, parts = read_score(xml, pitched=True)
        parts = [part for part in parts if part.has_pitches and not part.has_tab]
        if not parts:
            raise ImportError("no notes were recognised in this file", "omr.noMusic")
        bars = parts[0].bars
        notices = [Notice("omr.review", "recognition can be wrong; check the tab against the page")]
        tracks = []
        for index, part in enumerate(parts):
            track_bars = (part.track_bars + [TrackBar() for _ in bars])[: len(bars)]
            shifted, dropped = _finger(
                track_bars, part.pitches, preset, _octave_shift(part.clef, preset.instrument == "bass-guitar")
            )
            name = part.name
            if shifted:
                notices.append(
                    Notice(
                        "midi.shifted",
                        "{count} note(s) on '{track}' are outside the instrument's range and were moved by octaves",
                        {"count": shifted, "track": name},
                    )
                )
            if dropped:
                notices.append(
                    Notice(
                        "midi.dropped",
                        "{count} chord(s) on '{track}' cannot be fingered in one position and lost some notes",
                        {"count": dropped, "track": name},
                    )
                )
            tracks.append(
                Track(
                    id=f"trk_omr_{index}",
                    name=name,
                    instrument=preset.instrument,
                    tuning_midi=list(preset.tuning_midi),
                    preferred=index == 0,
                    bars=track_bars,
                )
            )
        slug = _slug(request.filename or request.file_path.name)
        progress("Tab ready", "import.tabReady")
        return ImportResult(
            title=title or slug.replace("-", " ").title(),
            artist=artist,
            slug=slug,
            document=ScoreDocument(bpm=parts[0].opening_tempo or 120.0, bars=bars, tracks=tracks),
            source_kind="omr",
            source_ref={
                "filename": request.filename or request.file_path.name,
                "needs_review": True,
                "engine": "audiveris",
            },
            warnings=notices,
        )


def _finger(
    track_bars: list[TrackBar], pitches: dict[tuple[int, int, int], list[int]], preset: InstrumentPreset, shift: int
) -> tuple[int, int]:
    """Replace each placeholder note by a fingered one. Returns how many groups were octave-shifted or thinned."""
    # One group per onset, across voices, so two voices never share a string.
    onsets: dict[tuple[int, int], list[tuple[int, int]]] = {}
    for bar, voice, beat in pitches:
        position = track_bars[bar].voices[voice].beats[beat].position
        onsets.setdefault((bar, position), []).append((voice, beat))
    keys = sorted(onsets)
    groups: list[list[int]] = []
    owners: list[list[tuple[int, int, int, int]]] = []
    for key in keys:
        group: list[int] = []
        owner: list[tuple[int, int, int, int]] = []
        for voice, beat in sorted(onsets[key]):
            for slot, pitch in enumerate(pitches[(key[0], voice, beat)]):
                group.append(pitch + shift)
                owner.append((key[0], voice, beat, slot))
        groups.append(group)
        owners.append(owner)
    fingering = assign_frets(groups, list(preset.tuning_midi))
    placed: dict[tuple[int, int, int], dict[int, tuple[int, int, int]]] = {}
    last: dict[tuple[int, int], tuple[int, int]] = {}
    for index, placements in enumerate(fingering.groups):
        for item in placements:
            bar, voice, beat, slot = owners[index][item.source]
            note = track_bars[bar].voices[voice].beats[beat].notes[slot]
            position = (item.string, item.fret)
            if note.tie and (voice, item.pitch) in last:
                position = last[(voice, item.pitch)]
            last[(voice, item.pitch)] = position
            placed.setdefault((bar, voice, beat), {})[slot] = (*position, item.pitch)
    for bar, voice, beat in pitches:
        target = track_bars[bar].voices[voice].beats[beat]
        kept = placed.get((bar, voice, beat), {})
        target.notes = [
            Note(string=kept[slot][0], fret=kept[slot][1], tie=note.tie)
            for slot, note in enumerate(target.notes)
            if slot in kept
        ]
    return len(fingering.shifted), len(fingering.dropped)

