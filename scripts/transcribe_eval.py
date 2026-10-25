"""Measure note accuracy of audio transcription on synthetic audio.

    .venv/bin/python scripts/transcribe_eval.py          # prints a Markdown table
    .venv/bin/python scripts/transcribe_eval.py --quick  # one row, for a smoke check

Each row takes a phrase from the MIDI corpus (``tests/fixtures/corpus/midi``, original or written byte by byte),
renders it to plucked-string audio with ``fretbook.audio.synth.render_notes`` (a kick and snare under it so the beat
tracker has a pulse), runs :func:`fretbook.audio.transcription.predict_notes` and scores the notes with
:func:`note_f_measure` (equal pitch, onset within 50 ms). FluidSynth is not needed. Synthetic audio is easier
than a recording, so this shows the pipeline is wired right, not how a real mix behaves.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fretbook.audio import transcription  # noqa: E402
from fretbook.audio.synth import render_notes  # noqa: E402
from fretbook.importers.midi import read_midi  # noqa: E402
from fretbook.score.model import TICKS_PER_QUARTER  # noqa: E402

MIDI = ROOT / "tests" / "fixtures" / "corpus" / "midi"
MAX_SECONDS = 20.0


def phrase(path: Path) -> tuple[list[tuple[float, float, int]], float]:
    """The in-range notes of a MIDI file as ``(start_sec, end_sec, pitch)`` and its opening tempo."""
    parsed = read_midi(path)
    bpm = parsed.opening_bpm
    seconds = 60 / bpm / TICKS_PER_QUARTER
    notes = [
        (start * seconds, end * seconds, pitch)
        for source in parsed.sources
        if source.in_range
        for start, end, pitch in source.notes
        if start * seconds < MAX_SECONDS
    ]
    return sorted(notes), bpm


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--quick", action="store_true", help="only the first phrase")
    args = parser.parse_args()
    if not transcription.available():
        sys.exit("onnxruntime or the basic-pitch model is missing: pip install -r requirements-transcribe.txt")
    files = sorted(MIDI.glob("*.mid"))[: 1 if args.quick else None]
    print("| phrase | notes | precision | recall | F-measure |")
    print("| --- | ---: | ---: | ---: | ---: |")
    totals = [0.0, 0.0, 0.0]
    for path in files:
        reference, bpm = phrase(path)
        audio = render_notes(reference, bpm=bpm)
        estimated = [(event.start_sec, event.end_sec, event.pitch) for event in transcription.predict_notes(audio)]
        precision, recall, f_measure = transcription.note_f_measure(reference, estimated)
        for index, value in enumerate((precision, recall, f_measure)):
            totals[index] += value / len(files)
        print(f"| {path.stem} | {len(reference)} | {precision:.2f} | {recall:.2f} | {f_measure:.2f} |")
    print(f"| **mean** | | {totals[0]:.2f} | {totals[1]:.2f} | {totals[2]:.2f} |")


if __name__ == "__main__":
    main()
