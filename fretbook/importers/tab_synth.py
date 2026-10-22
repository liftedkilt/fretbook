"""Render synthetic on-screen tabs and score the spike against them.

Pillow is imported inside the functions that draw. The default Fretbook install
does not depend on it; ``requirements-dev.txt`` does, so CI can measure accuracy.
The monospace font is ``tests/fixtures/fonts/DejaVuSansMono.ttf`` (Bitstream Vera
license, see the LICENSE beside it).
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from pathlib import Path

from fretbook.importers.tab_vision import (
    BAR_TICKS,
    QUANTUM,
    GrayImage,
    TabNote,
    TemplateBook,
    recognize_image,
)

_FONT_SIZE = 32
_BAR_SPAN = 420
_BARLINE_WIDTH = 3


@dataclass(frozen=True)
class Sound:
    string: int
    fret: int
    dead: bool = False


@dataclass(frozen=True)
class Piece:
    """One system. Each bar is a sequence of beats; a beat is the notes sounding there."""

    name: str
    strings: int
    bars: tuple[tuple[tuple[Sound, ...], ...], ...]


@dataclass(frozen=True)
class GroundTruth:
    notes: tuple[TabNote, ...]
    region: tuple[int, int, int, int]
    image: GrayImage


@dataclass(frozen=True)
class CaseScore:
    piece: str
    style: str
    condition: str
    expected: int
    matched: int
    recognized: int
    iou: float

    @property
    def precision(self) -> float:
        return self.matched / self.recognized if self.recognized else 1.0

    @property
    def recall(self) -> float:
        return self.matched / self.expected if self.expected else 1.0

    @property
    def f1(self) -> float:
        if self.precision + self.recall == 0:
            return 0.0
        return 2 * self.precision * self.recall / (self.precision + self.recall)


@dataclass
class AccuracyReport:
    cases: list[CaseScore]
    cross_font: list[CaseScore]

    @property
    def matched(self) -> int:
        return sum(case.matched for case in self.cases)

    @property
    def expected(self) -> int:
        return sum(case.expected for case in self.cases)

    @property
    def recognized(self) -> int:
        return sum(case.recognized for case in self.cases)

    @property
    def precision(self) -> float:
        return self.matched / self.recognized if self.recognized else 1.0

    @property
    def recall(self) -> float:
        return self.matched / self.expected if self.expected else 1.0

    @property
    def f1(self) -> float:
        if self.precision + self.recall == 0:
            return 0.0
        return 2 * self.precision * self.recall / (self.precision + self.recall)

    @property
    def mean_iou(self) -> float:
        if not self.cases:
            return 0.0
        return sum(case.iou for case in self.cases) / len(self.cases)

    def clean_exact(self) -> bool:
        return all(case.matched == case.expected == case.recognized for case in self.cases if case.condition == "clean")

    def text(self) -> str:
        lines = [
            f"notes {self.matched}/{self.expected} recognized {self.recognized} "
            f"precision {self.precision:.3f} recall {self.recall:.3f} f1 {self.f1:.3f} "
            f"region IoU {self.mean_iou:.3f}",
            f"{'piece':<16} {'style':<8} {'condition':<14} {'hit':>7} {'iou':>6}",
        ]
        for case in self.cases:
            lines.append(
                f"{case.piece:<16} {case.style:<8} {case.condition:<14} "
                f"{case.matched:>2}/{case.expected:<2} {case.iou:6.3f}"
            )
        if self.cross_font:
            lines.append("cross-font (DejaVu templates, other drawing font):")
            for case in self.cross_font:
                lines.append(
                    f"{case.piece:<16} {case.style:<8} {case.condition:<14} "
                    f"{case.matched:>2}/{case.expected:<2} {case.iou:6.3f} f1 {case.f1:.3f}"
                )
        return "\n".join(lines)


def bundled_font() -> Path | None:
    """DejaVu Sans Mono shipped with the tests, or a system copy."""
    bundled = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "fonts" / "DejaVuSansMono.ttf"
    candidates = [
        bundled,
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"),
    ]
    for path in candidates:
        if path.is_file():
            return path
    return None


def liberation_font() -> Path | None:
    path = Path("/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf")
    return path if path.is_file() else None


def beat_tick(index: int, count: int) -> int:
    if count <= 0:
        raise ValueError("a bar needs a beat count")
    return int(round(index / count * BAR_TICKS / QUANTUM)) * QUANTUM


def pieces() -> tuple[Piece, ...]:
    return (
        Piece(
            "bass-walk",
            4,
            (
                (
                    (Sound(0, 0),),
                    (Sound(1, 3),),
                    (Sound(2, 5),),
                    (Sound(3, 7),),
                ),
            ),
        ),
        Piece(
            "guitar-mix",
            6,
            (
                (
                    (Sound(0, 0), Sound(1, 2), Sound(2, 2)),
                    (Sound(0, 3),),
                    (Sound(1, 12),),
                    (Sound(4, 0, True),),
                ),
            ),
        ),
        Piece(
            "two-bars",
            4,
            (
                (
                    (Sound(0, 1),),
                    (Sound(1, 0),),
                    (Sound(2, 3),),
                    (Sound(3, 0),),
                ),
                (
                    (Sound(0, 5),),
                    (Sound(1, 5),),
                    (Sound(2, 5),),
                    (Sound(3, 7),),
                ),
            ),
        ),
        Piece(
            "with-rest",
            4,
            (((), (Sound(0, 8),), (Sound(1, 10),), (Sound(2, 0), Sound(3, 3))),),
        ),
    )


def build_templates(font_path: Path) -> TemplateBook:
    glyphs = {str(digit): _render_template(font_path, str(digit)) for digit in range(10)}
    glyphs["x"] = _render_template(font_path, "x")
    return TemplateBook(_RASTER_ROWS, _RASTER_COLS, glyphs)


def render_case(
    piece: Piece,
    font_path: Path,
    *,
    style: str,
    condition: str,
    seed: int = 0,
) -> GroundTruth:
    """Draw ``piece`` and apply one degradation. ``style`` is ``ascii`` or ``staff``."""
    image, notes, region = _draw(piece, font_path, style=style)
    image, region = _degrade(image, region, condition, seed)
    return GroundTruth(tuple(notes), region, _to_gray(image))


def evaluate(font_path: Path | None = None) -> AccuracyReport:
    """Measure note F1 and tab-region IoU on the synthetic corpus."""
    path = font_path or bundled_font()
    if path is None:
        raise FileNotFoundError("DejaVu Sans Mono was not found")
    templates = build_templates(path)
    cases: list[CaseScore] = []
    for piece in pieces():
        for style in ("ascii", "staff"):
            for condition in ("clean", "salt", "blur", "dark", "low-contrast", "shift"):
                truth = render_case(piece, path, style=style, condition=condition, seed=len(cases) + 1)
                reading = recognize_image(truth.image, templates)
                matched, expected, recognized = _match(truth.notes, reading.notes)
                cases.append(
                    CaseScore(
                        piece.name,
                        style,
                        condition,
                        expected,
                        matched,
                        recognized,
                        _iou(truth.region, reading.region),
                    )
                )
    cross: list[CaseScore] = []
    other = liberation_font()
    if other is not None:
        piece = pieces()[0]
        truth = render_case(piece, other, style="ascii", condition="clean", seed=0)
        reading = recognize_image(truth.image, templates)
        matched, expected, recognized = _match(truth.notes, reading.notes)
        cross.append(
            CaseScore(
                piece.name,
                "ascii",
                "liberation",
                expected,
                matched,
                recognized,
                _iou(truth.region, reading.region),
            )
        )
    return AccuracyReport(cases, cross)


def _draw(piece: Piece, font_path: Path, *, style: str):
    from PIL import Image, ImageDraw, ImageFont

    font = ImageFont.truetype(str(font_path), _FONT_SIZE)
    ascent, descent = font.getmetrics()
    line_h = ascent + descent
    step = line_h + 18
    origin_y = 96
    origin_x = 48
    bar_count = len(piece.bars)
    width = origin_x + bar_count * _BAR_SPAN + 80
    height = origin_y + piece.strings * step + 48
    image = Image.new("L", (width, height), 242)
    draw = ImageDraw.Draw(image)
    draw.text((origin_x, 16), "Lesson", font=font, fill=60)

    if style == "staff":
        baselines = [origin_y + line_h // 2 + index * step for index in range(piece.strings)]
        # Stop short of each bar line so the staff does not weld the bar lines together.
        for bar_index in range(bar_count):
            x0 = origin_x + bar_index * _BAR_SPAN + _BARLINE_WIDTH + 3
            x1 = origin_x + (bar_index + 1) * _BAR_SPAN - 3
            for baseline in baselines:
                draw.rectangle([x0, baseline, x1, baseline + 1], fill=20)
        band_top = baselines[0]
        band_bottom = baselines[-1]
    elif style == "ascii":
        baselines = [origin_y + index * step for index in range(piece.strings)]
        band_top = baselines[0]
        band_bottom = baselines[-1] + line_h
    else:
        raise ValueError(f"unknown style {style}")

    labels = _labels(piece.strings)
    notes: list[TabNote] = []
    barline_lefts: list[int] = []
    for bar_index, beats in enumerate(piece.bars):
        bar_x = origin_x + bar_index * _BAR_SPAN
        barline_lefts.append(bar_x)
        _barline(draw, bar_x, band_top - 8, band_bottom + 8)
        # The recognizer measures from the pixel after a bar line to the next bar line.
        edge = bar_x + _BARLINE_WIDTH
        span = _BAR_SPAN - _BARLINE_WIDTH
        _dashes(draw, font, style, baselines, edge, bar_x + _BAR_SPAN, beats, span)
        for beat_index, sounds in enumerate(beats):
            tick = beat_tick(beat_index, len(beats))
            target = edge + int(round(tick / BAR_TICKS * span))
            # A fret sitting on the bar line becomes part of that line. A few pixels
            # still rounds back to tick 0.
            if target < edge + 5:
                target = edge + 5
            for sound in sounds:
                text = "x" if sound.dead else str(sound.fret)
                bbox = font.getbbox(text)
                pen_x = target - bbox[0]
                if style == "staff":
                    pen_y = baselines[sound.string] - (bbox[1] + bbox[3]) // 2
                else:
                    pen_y = baselines[sound.string]
                draw.text((pen_x, pen_y), text, font=font, fill=15)
                notes.append(TabNote(bar_index, tick, sound.string, 0 if sound.dead else sound.fret, sound.dead))
        if style == "ascii":
            for string, label in enumerate(labels):
                draw.text((8, baselines[string]), label, font=font, fill=30)
    closing = origin_x + bar_count * _BAR_SPAN
    barline_lefts.append(closing)
    _barline(draw, closing, band_top - 8, band_bottom + 8)
    region = _system_box(style, baselines, barline_lefts, step, width, height)
    return image, notes, region


def _system_box(style: str, baselines: list[int], barlines: list[int], step: int, width: int, height: int):
    """The box the recognizer reports for a clean frame of this layout."""
    x0 = max(0, barlines[0] - 2)
    x1 = min(width - 1, barlines[-1] + _BARLINE_WIDTH - 1 + 2)
    if style == "staff":
        half = int(step * 0.42)
        pad = int(step * 0.2)
        y0 = max(0, baselines[0] - half - pad)
        y1 = min(height - 1, baselines[-1] + half + pad)
    else:
        # ASCII windows hang off the dash row, which sits near the middle of the em box.
        y0 = max(0, baselines[0] - 4)
        y1 = min(height - 1, baselines[-1] + 40)
    return (x0, y0, x1 - x0 + 1, y1 - y0 + 1)


def _labels(strings: int) -> tuple[str, ...]:
    if strings >= 6:
        return ("e", "B", "G", "D", "A", "E", "B")[:strings]
    return ("G", "D", "A", "E", "B")[:strings]


def _barline(draw, x: int, top: int, bottom: int) -> None:
    draw.rectangle([x, top, x + _BARLINE_WIDTH - 1, bottom], fill=0)


def _dashes(draw, font, style: str, baselines: list[int], left: int, right: int, beats, span: int) -> None:
    if style != "ascii":
        return
    advance = max(8, int(round(font.getlength("-"))))
    occupied: list[tuple[int, int]] = []
    for beat_index, sounds in enumerate(beats):
        if not sounds:
            continue
        tick = beat_tick(beat_index, len(beats))
        target = left + int(round(tick / BAR_TICKS * span))
        occupied.append((target - 4, target + advance * 3))
    x = left + 6
    while x < right - advance:
        if any(start <= x <= end for start, end in occupied):
            x += advance
            continue
        for baseline in baselines:
            draw.text((x, baseline), "-", font=font, fill=25)
        x += advance


def _degrade(image, region: tuple[int, int, int, int], condition: str, seed: int):
    from PIL import ImageFilter, ImageOps

    if condition == "clean":
        return image, region
    if condition == "salt":
        rng = random.Random(seed)
        noisy = image.copy()
        pixels = noisy.load()
        width, height = noisy.size
        for y in range(height):
            for x in range(width):
                if rng.random() < 0.012:
                    pixels[x, y] = 0 if rng.random() < 0.5 else 255
        return noisy, region
    if condition == "blur":
        return image.filter(ImageFilter.BoxBlur(0.7)), region
    if condition == "dark":
        return ImageOps.invert(image), region
    if condition == "low-contrast":
        return image.point(lambda value: 48 + value * 150 // 255), region
    if condition == "shift":
        from PIL import Image

        dx, dy = 18, 14
        canvas = Image.new("L", (image.size[0] + dx + 12, image.size[1] + dy + 12), image.getpixel((0, 0)))
        canvas.paste(image, (dx, dy))
        x, y, width, height = region
        return canvas, (x + dx, y + dy, width, height)
    raise ValueError(f"unknown condition {condition}")


def _render_template(font_path: Path, character: str) -> tuple[int, ...]:
    from PIL import Image, ImageDraw, ImageFont

    from fretbook.importers.tab_vision import glyph_template

    font = ImageFont.truetype(str(font_path), _FONT_SIZE)
    ascent, descent = font.getmetrics()
    image = Image.new("L", (ascent + descent, ascent + descent), 255)
    ImageDraw.Draw(image).text((4, 4), character, font=font, fill=0)
    return glyph_template(_to_gray(image), rows=_RASTER_ROWS, cols=_RASTER_COLS)


def _to_gray(image) -> GrayImage:
    gray = image.convert("L")
    return GrayImage(gray.size[0], gray.size[1], bytearray(gray.tobytes()))


def _match(expected: tuple[TabNote, ...], actual: list[TabNote]) -> tuple[int, int, int]:
    pool = {(note.bar, note.position, note.string, note.fret, note.dead) for note in actual}
    matched = sum(
        (note.bar, note.position, note.string, note.fret, note.dead) in pool for note in expected
    )
    return matched, len(expected), len(actual)


def _iou(left: tuple[int, int, int, int], right: tuple[int, int, int, int]) -> float:
    ax, ay, aw, ah = left
    bx, by, bw, bh = right
    x1, y1 = max(ax, bx), max(ay, by)
    x2, y2 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    intersection = max(0, x2 - x1) * max(0, y2 - y1)
    union = aw * ah + bw * bh - intersection
    return intersection / union if union else 0.0


# Raster size shared with the recognizer. Kept here so the template builder matches.
_RASTER_ROWS = 24
_RASTER_COLS = 16
