"""Measure how well auto-sync recovers known bar times from synthetic audio.

    .venv/bin/python scripts/autosync_eval.py          # prints a Markdown table
    .venv/bin/python scripts/autosync_eval.py --quick  # a few rows, for a smoke check

Each row renders a score to audio with ``fretbook.audio.synth`` (kick on bar starts, snare, hats, the
bass line), with bar starts known exactly, then compares the anchors ``propose`` returns. The error is
``|estimated - true|`` over every played bar start. Synthetic audio is easier than a recording: it shows
that the alignment is right, not how a real mix behaves.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fretbook.audio.synth import bar_starts_for, build_document, render  # noqa: E402
from fretbook.score.autosync import propose  # noqa: E402
from fretbook.score.model import ScoreDocument  # noqa: E402

RIFF = ROOT / "tests" / "fixtures" / "corpus" / "json" / "riff.tab.json"


def corpus_riff(bars: int, bpm: float) -> ScoreDocument:
    """The corpus's two-bar bass riff (CC0, see tests/fixtures/corpus/README.md) repeated to ``bars`` bars."""
    base = ScoreDocument.model_validate(json.loads(RIFF.read_text())["document"])
    document = base.model_copy(deep=True)
    document.bpm = bpm
    document.bars = [base.bars[index % 2].model_copy(deep=True) for index in range(bars)]
    for track in document.tracks:
        track.bars = [track.bars[index % 2].model_copy(deep=True) for index in range(bars)]
    return ScoreDocument.model_validate(document.model_dump())


@dataclass
class Case:
    name: str
    document: ScoreDocument
    lead_in: float = 1.5
    drift: float = 0.0
    speed: float = 1.0
    """Performance speed relative to the score: 0.88 is 12 % slower."""
    noise: float = 0.01
    sway: float = 0.0
    ritardando: float = 0.0
    jitter: float = 0.0
    count_in: int = 0
    intro: float = 0.0
    stated: bool = False
    """Tell ``propose`` where the music starts (the true start, 80 ms off, as a listener would say it)."""
    cut_bar: int = 0
    """The recording starts at this played bar, not the first."""


def cases(quick: bool) -> list[Case]:
    out = [Case(f"corpus riff, 4/4, {bpm} BPM", corpus_riff(32, bpm)) for bpm in (60, 90, 120, 160, 200)]
    out += [
        Case("3/4, 100 BPM", build_document([(3, 4)] * 32, bpm=100), lead_in=1.1),
        Case("6/8, 120 BPM", build_document([(6, 8)] * 32, bpm=120), lead_in=0.8),
        Case("4/4 3/4 7/8 mixed, 110 BPM", build_document([(4, 4), (4, 4), (3, 4), (7, 8)] * 8, bpm=110), lead_in=1.9),
        Case("repeat x3 (bars 3-6), 120 BPM", build_document([(4, 4)] * 10, bpm=120, repeat=(2, 5, 3)), lead_in=1.0),
        Case("no lead-in, 120 BPM", corpus_riff(32, 120), lead_in=0.0),
        Case("tempo drift +-8 %, 100 BPM", corpus_riff(40, 100), drift=0.08),
        Case("tempo change 100, 130, 90 BPM", build_document([(4, 4)] * 36, bpm=100, tempos={12: 130, 24: 90})),
        Case("played 12 % slower than the score", corpus_riff(32, 120), speed=0.88),
        Case("played 10 % faster than the score", corpus_riff(32, 100), speed=1.1),
        Case("noisy (noise floor x10)", corpus_riff(32, 120), noise=0.1),
    ]
    out += performed_cases()
    return out[:3] if quick else out


def performed_cases() -> list[Case]:
    """Rows that stand in for a human take: timing jitter, rubato, a ritardando, and music the tab lacks."""
    riff = corpus_riff(32, 100)
    plain = Case("human feel: 15 ms jitter, 100 BPM", riff, jitter=0.015)
    return [
        plain,
        Case("rubato +-15 %, 4 swells", riff, sway=0.15, jitter=0.01),
        Case("rubato +-25 %, 4 swells", riff, sway=0.25, jitter=0.01),
        Case("ritardando over the last bars", riff, ritardando=0.5, jitter=0.01),
        Case("count-in of 4 clicks", riff, lead_in=3.0, count_in=4),
        Case("count-in, start stated", riff, lead_in=3.0, count_in=4, stated=True),
        Case("6 s unmetered intro, start stated", riff, lead_in=6.0, intro=5.0, stated=True),
        Case("6 s unmetered intro, not stated", riff, lead_in=6.0, intro=5.0),
        Case("recording cut at bar 9, bar given", riff, cut_bar=8, lead_in=0.4),
    ]


def evaluate(case: Case, tracker: str = "auto") -> dict[str, float | str]:
    performed = case.document.model_copy(deep=True)
    performed.bpm = case.document.bpm * case.speed
    for bar in performed.bars:
        if bar.tempo is not None:
            bar.tempo *= case.speed
    starts = bar_starts_for(
        performed,
        lead_in=case.lead_in,
        drift=case.drift,
        sway=case.sway,
        ritardando=case.ritardando,
        jitter=case.jitter,
    )
    audio = render(case.document, starts, noise=case.noise, count_in=case.count_in, intro=case.intro)
    if case.cut_bar:
        audio = audio[int((starts[case.cut_bar] - case.lead_in) * 22050) :]
        starts = [start - starts[case.cut_bar] + case.lead_in for start in starts[case.cut_bar :]]
    began = time.perf_counter()
    try:
        proposal = propose(
            case.document,
            audio,
            start_bar=case.cut_bar,
            start_seconds=starts[0] + 0.08 if case.stated else None,
            tracker=tracker,
        )
    except Exception as error:  # a failed row is a result too
        return {"name": case.name, "error": f"{type(error).__name__}: {error}"}
    seconds = time.perf_counter() - began
    errors = np.array(
        [
            abs(proposal.anchors[str(case.cut_bar + i)] - t) * 1000
            for i, t in enumerate(starts)
            if str(case.cut_bar + i) in proposal.anchors
        ]
    )
    return {
        "name": case.name,
        "bars": f"{len(errors)}/{len(starts)}",
        "median": float(np.median(errors)),
        "p95": float(np.percentile(errors, 95)),
        "max": float(errors.max()),
        "within50": float(np.mean(errors <= 50) * 100),
        "confidence": proposal.overall,
        "seconds": seconds,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--quick", action="store_true")
    parser.add_argument("--tracker", choices=("steady", "flexible", "auto"), default="auto")
    args = parser.parse_args(argv)
    print("| Case | Bars marked | Median error | 95th percentile | Max | Within 50 ms | Confidence | Time |")
    print("| --- | --- | --- | --- | --- | --- | --- | --- |")
    results = [evaluate(case, args.tracker) for case in cases(args.quick)]
    for row in results:
        if "error" in row:
            print(f"| {row['name']} | failed: {row['error']} | | | | | | |")
        else:
            print(
                f"| {row['name']} | {row['bars']} | {row['median']:.1f} ms | {row['p95']:.1f} ms | {row['max']:.1f} ms"
                f" | {row['within50']:.0f} % | {row['confidence']:.2f} | {row['seconds']:.1f} s |"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
