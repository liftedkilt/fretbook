"""Classical tab-region detection and fret OCR for the issue #6 spike.

The recognizer is pure Python. It finds a tab system (ASCII text rows, or a
rendered staff), reads fret numbers by template matching, and builds a
:class:`~fretbook.score.model.ScoreDocument`. OpenCV, Tesseract, and Pillow are
not imported unless a caller asks to load a non-PNM image. See
``docs/design/youtube-tab-import.md``.
"""

from __future__ import annotations

import shutil
import subprocess
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path

from fretbook.score.instruments import get_preset
from fretbook.score.model import (
    TICKS_PER_QUARTER,
    Bar,
    Beat,
    Note,
    ScoreDocument,
    SyncMap,
    Track,
    TrackBar,
    Voice,
)

BAR_TICKS = 4 * TICKS_PER_QUARTER
QUANTUM = TICKS_PER_QUARTER // 4
_RASTER_ROWS = 24
_RASTER_COLS = 16
_PRESET_FOR_STRINGS = {4: "bass-4", 5: "bass-5", 6: "guitar-6", 7: "guitar-7"}
_IMAGE_SUFFIXES = {".ppm", ".pgm", ".pnm", ".png", ".jpg", ".jpeg", ".webp", ".bmp"}


class TabVisionError(ValueError):
    """A frame was readable as an image but not as a tab."""


@dataclass(frozen=True)
class TabNote:
    bar: int
    position: int
    string: int
    fret: int
    dead: bool = False


@dataclass
class RecognizedTab:
    notes: list[TabNote]
    region: tuple[int, int, int, int]
    string_count: int
    bar_count: int
    confidence: float
    frame_index: int = 0
    time: float = 0.0


@dataclass(frozen=True)
class TemplateBook:
    """Raster templates for ``0``–``9`` and ``x``. Each entry is row-major 0/1."""

    rows: int
    cols: int
    glyphs: dict[str, tuple[int, ...]]

    def __post_init__(self) -> None:
        needed = {str(digit) for digit in range(10)} | {"x"}
        missing = needed - set(self.glyphs)
        if missing:
            raise TabVisionError(f"template book is missing {sorted(missing)}")
        width = self.rows * self.cols
        for name, bits in self.glyphs.items():
            if len(bits) != width:
                raise TabVisionError(f"template {name} has {len(bits)} bits, expected {width}")

    @property
    def bits(self) -> int:
        return self.rows * self.cols


@dataclass
class GrayImage:
    width: int
    height: int
    pixels: bytearray

    def __post_init__(self) -> None:
        if len(self.pixels) != self.width * self.height:
            raise TabVisionError("image buffer does not match its size")


@dataclass(frozen=True)
class _Box:
    x0: int
    y0: int
    x1: int
    y1: int

    @property
    def width(self) -> int:
        return self.x1 - self.x0 + 1

    @property
    def height(self) -> int:
        return self.y1 - self.y0 + 1

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2


@dataclass
class _Glyph:
    box: _Box
    kind: str
    distance: int
    band: int


def optional_backends() -> dict[str, bool]:
    """Which heavy vision libraries import. The spike does not require any of them."""

    def has(name: str) -> bool:
        try:
            __import__(name)
        except ImportError:
            return False
        return True

    return {"opencv": has("cv2"), "tesseract": has("pytesseract"), "pillow": has("PIL")}


def average_hash(image: GrayImage, size: int = 8) -> int:
    """64-bit average hash, for dropping near-duplicate frames."""
    values: list[int] = []
    for by in range(size):
        y0 = by * image.height // size
        y1 = max(y0 + 1, (by + 1) * image.height // size)
        for bx in range(size):
            x0 = bx * image.width // size
            x1 = max(x0 + 1, (bx + 1) * image.width // size)
            total = 0
            for y in range(y0, y1):
                row = y * image.width
                total += sum(image.pixels[row + x] for x in range(x0, x1))
            values.append(total // ((y1 - y0) * (x1 - x0)))
    midpoint = sorted(values)[len(values) // 2]
    bits = 0
    for index, value in enumerate(values):
        if value >= midpoint:
            bits |= 1 << index
    return bits


def hash_distance(left: int, right: int) -> int:
    return (left ^ right).bit_count()


def select_stable_frames(images: Sequence[GrayImage], *, duplicate_distance: int = 6) -> list[int]:
    """Drop near-duplicates and frames that match neither neighbor (a scroll blur)."""
    if not images:
        return []
    hashes = [average_hash(image) for image in images]
    kept: list[int] = []
    last = len(hashes) - 1
    for index, digest in enumerate(hashes):
        if 0 < index < last:
            previous = hash_distance(digest, hashes[index - 1])
            nxt = hash_distance(digest, hashes[index + 1])
            if previous > 18 and nxt > 18:
                continue
        if any(hash_distance(digest, hashes[other]) <= duplicate_distance for other in kept):
            continue
        kept.append(index)
    return kept


def estimate_scroll(before: GrayImage, after: GrayImage, *, max_shift: int = 80) -> int:
    """How many pixels the content of ``after`` sits below ``before``.

    Positive means the tab moved down. Frames must be the same size; the search
    is a brute-force match of row brightness, which is enough for a single system.
    """
    if before.width != after.width or before.height != after.height:
        raise TabVisionError("scroll tracking needs frames of equal size")
    height, width = before.height, before.width
    profile_a = [sum(before.pixels[y * width : (y + 1) * width]) for y in range(height)]
    profile_b = [sum(after.pixels[y * width : (y + 1) * width]) for y in range(height)]
    best_shift = 0
    best_score: float | None = None
    limit = min(max_shift, height // 3)
    for shift in range(-limit, limit + 1):
        if shift >= 0:
            pairs = range(shift, height)
            offset = -shift
        else:
            pairs = range(0, height + shift)
            offset = -shift
        count = len(pairs)
        if count < height // 2:
            continue
        score = -sum(abs(profile_a[y + offset] - profile_b[y]) for y in pairs) / count
        if best_score is None or score > best_score:
            best_score = score
            best_shift = shift
    return best_shift


def stitch_tabs(tabs: Sequence[RecognizedTab]) -> tuple[list[TabNote], list[float | None], int, int]:
    """Overlap-merge systems that share bars. Returns notes, per-bar times, bars, strings."""
    if not tabs:
        raise TabVisionError("no frames to stitch")
    strings = tabs[0].string_count
    bar_notes: list[list[TabNote]] = []
    times: list[float | None] = []
    for tab in tabs:
        grouped = _group_bars(tab)
        if not bar_notes:
            bar_notes = grouped
            times = [tab.time for _ in grouped]
            continue
        overlap = _overlap(bar_notes, grouped)
        for extra in grouped[overlap:]:
            shift = len(bar_notes)
            bar_notes.append([_shift_bar(note, shift) for note in extra])
            times.append(tab.time)
    notes = [note for group in bar_notes for note in group]
    return notes, times, len(bar_notes), strings


def notes_to_document(
    notes: Sequence[TabNote],
    *,
    string_count: int,
    bar_count: int,
    bpm: float = 120,
    video_id: str | None = None,
    points: Sequence[float | None] | None = None,
) -> ScoreDocument:
    """Build one 4/4 track. String count picks a standard bass or guitar preset."""
    if string_count not in _PRESET_FOR_STRINGS:
        raise TabVisionError(f"spike supports 4–7 strings, not {string_count}")
    if bar_count < 1:
        raise TabVisionError("tab has no bars")
    preset = get_preset(_PRESET_FOR_STRINGS[string_count])
    by_bar: list[list[TabNote]] = [[] for _ in range(bar_count)]
    for note in notes:
        if note.string < 0 or note.string >= string_count:
            continue
        if 0 <= note.bar < bar_count:
            by_bar[note.bar].append(note)
    track_bars = [TrackBar(voices=[Voice(beats=_beats(group))]) for group in by_bar]
    sync_points = list(points) if points is not None else []
    if len(sync_points) < bar_count:
        sync_points.extend([None] * (bar_count - len(sync_points)))
    return ScoreDocument(
        bpm=bpm,
        bars=[Bar() for _ in range(bar_count)],
        tracks=[
            Track(
                id="yt-tab",
                name=preset.name,
                instrument=preset.instrument,
                tuning_midi=list(preset.tuning_midi),
                preferred=True,
                bars=track_bars,
            )
        ],
        sync=SyncMap(video_id=video_id, points=sync_points[:bar_count]),
    )


def glyph_template(image: GrayImage, *, rows: int = _RASTER_ROWS, cols: int = _RASTER_COLS) -> tuple[int, ...]:
    """Binarize one drawn character and rasterize it for a :class:`TemplateBook`."""
    ink = _binarize(image)
    xs = [index % image.width for index, value in enumerate(ink) if value]
    ys = [index // image.width for index, value in enumerate(ink) if value]
    if not xs:
        raise TabVisionError("glyph template is blank")
    box = _Box(min(xs), min(ys), max(xs), max(ys))
    return _raster(ink, image.width, box, rows, cols)


def recognize_image(image: GrayImage, templates: TemplateBook) -> RecognizedTab:
    """Read one frame. A median-filtered pass is kept when it recovers more notes."""
    readings: list[RecognizedTab] = []
    errors: list[TabVisionError] = []
    for median in (False, True):
        try:
            readings.append(_recognize(image, templates, median=median))
        except TabVisionError as exc:
            errors.append(exc)
    if not readings:
        raise errors[0]
    if len(readings) == 1:
        return readings[0]
    return _prefer(readings[0], readings[1])


def recognize_images(
    images: Sequence[GrayImage],
    templates: TemplateBook,
    *,
    times: Sequence[float] | None = None,
    video_id: str | None = None,
    bpm: float = 120,
) -> ScoreDocument:
    """De-duplicate frames, read each kept frame, and stitch the systems."""
    if not images:
        raise TabVisionError("no frames")
    kept = select_stable_frames(images)
    tabs: list[RecognizedTab] = []
    for order, index in enumerate(kept):
        tab = recognize_image(images[index], templates)
        tab.frame_index = index
        tab.time = times[index] if times is not None else float(order)
        tabs.append(tab)
    notes, points, bars, strings = stitch_tabs(tabs)
    return notes_to_document(notes, string_count=strings, bar_count=bars, bpm=bpm, video_id=video_id, points=points)


def load_image(path: Path) -> GrayImage:
    suffix = path.suffix.lower()
    if suffix in {".ppm", ".pgm", ".pnm"}:
        return read_pnm(path)
    try:
        from PIL import Image
    except ImportError as exc:
        raise TabVisionError(f"reading {suffix or 'this'} image needs Pillow") from exc
    with Image.open(path) as handle:
        gray = handle.convert("L")
        return GrayImage(gray.size[0], gray.size[1], bytearray(gray.tobytes()))


def read_pnm(path: Path) -> GrayImage:
    data = path.read_bytes()
    if data.startswith(b"P5"):
        channels = 1
    elif data.startswith(b"P6"):
        channels = 3
    else:
        raise TabVisionError(f"{path.name} is not a P5 or P6 image")
    width, height, maxval, offset = _pnm_header(data)
    if maxval != 255:
        raise TabVisionError("only 8-bit PNM images are supported")
    count = width * height * channels
    raw = data[offset : offset + count]
    if len(raw) < count:
        raise TabVisionError(f"{path.name} is truncated")
    if channels == 1:
        return GrayImage(width, height, bytearray(raw))
    pixels = bytearray(width * height)
    for index in range(width * height):
        base = index * 3
        pixels[index] = (raw[base] * 30 + raw[base + 1] * 59 + raw[base + 2] * 11) // 100
    return GrayImage(width, height, pixels)


def write_pnm(path: Path, image: GrayImage) -> None:
    header = f"P5\n{image.width} {image.height}\n255\n".encode()
    path.write_bytes(header + bytes(image.pixels))


def frames_in(folder: Path) -> list[Path]:
    if not folder.is_dir():
        raise TabVisionError(f"{folder} is not a folder of frames")
    found = [path for path in folder.iterdir() if path.suffix.lower() in _IMAGE_SUFFIXES and path.is_file()]
    if not found:
        raise TabVisionError(f"no frames in {folder}")
    return sorted(found, key=lambda path: path.name)


def extract_video_frames(video: Path, dest: Path, *, fps: float = 2.0) -> list[Path]:
    """Sample ``fps`` frames with ffmpeg. The spike never shells out to a string."""
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        raise TabVisionError("ffmpeg is not installed")
    if not video.is_file():
        raise TabVisionError(f"video not found: {video}")
    if fps <= 0 or fps > 30:
        raise TabVisionError("frame rate must be between 0 and 30")
    dest.mkdir(parents=True, exist_ok=True)
    pattern = str(dest / "frame-%04d.ppm")
    completed = subprocess.run(
        [ffmpeg, "-y", "-i", str(video), "-vf", f"fps={fps}", "-f", "image2", pattern],
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        raise TabVisionError("ffmpeg could not read this video")
    frames = sorted(dest.glob("frame-*.ppm"))
    if not frames:
        raise TabVisionError("ffmpeg wrote no frames")
    return frames


def _recognize(image: GrayImage, templates: TemplateBook, *, median: bool) -> RecognizedTab:
    source = _median(image) if median else image
    ink = _binarize(source)
    # Bar lines are measured on the original ink. Staff mode then erases the
    # horizontal lines so fret numbers are not welded into one component.
    located = _components(ink, image.width, image.height)
    staff = _staff_lines(ink, image.width, image.height)
    if len(staff) >= 4:
        spacing = _median_gap(staff)
        bands = _windows(staff, spacing, image.height)
        mode_ink = _erase_staff(ink, image.width, image.height, staff)
        components = _components(mode_ink, image.width, image.height)
    else:
        bands = _text_bands(ink, image.width, image.height)
        if len(bands) < 4:
            raise TabVisionError("no tab system found")
        spacing = _median_gap([((top + bottom) // 2) for top, bottom in bands])
        mode_ink = ink
        components = located
    barlines = _barlines(located, bands, spacing)
    if len(barlines) < 2:
        raise TabVisionError("no bar lines found")
    glyphs = _classify(mode_ink, image.width, components, bands, barlines, spacing, templates)
    notes = _notes_from_glyphs(glyphs, barlines)
    if not notes:
        raise TabVisionError("tab region had no fret numbers")
    region = _region(barlines, bands, spacing, image.width, image.height)
    distances = [glyph.distance for glyph in glyphs if glyph.kind != "|"]
    confidence = 1.0 - (sum(distances) / len(distances) / templates.bits if distances else 1.0)
    return RecognizedTab(
        notes=notes,
        region=region,
        string_count=len(bands),
        bar_count=len(barlines) - 1,
        confidence=max(0.0, confidence),
    )


def _prefer(plain: RecognizedTab, filtered: RecognizedTab) -> RecognizedTab:
    if abs(plain.confidence - filtered.confidence) <= 0.25 and len(plain.notes) != len(filtered.notes):
        return plain if len(plain.notes) > len(filtered.notes) else filtered
    return plain if plain.confidence >= filtered.confidence else filtered


def _binarize(image: GrayImage) -> bytearray:
    pixels = image.pixels
    hist = [0] * 256
    for value in pixels:
        hist[value] += 1
    total = len(pixels)
    sum_all = sum(index * count for index, count in enumerate(hist))
    sum_back = weight_back = 0
    best = -1.0
    threshold = 0
    for level in range(256):
        weight_back += hist[level]
        if not weight_back:
            continue
        weight_fore = total - weight_back
        if not weight_fore:
            break
        sum_back += level * hist[level]
        mean_back = sum_back / weight_back
        mean_fore = (sum_all - sum_back) / weight_fore
        variance = weight_back * weight_fore * (mean_back - mean_fore) ** 2
        if variance > best:
            best = variance
            threshold = level
    width = image.width
    corners = sorted(
        (
            pixels[0],
            pixels[width - 1],
            pixels[(image.height - 1) * width],
            pixels[-1],
        )
    )
    background_is_light = corners[1] > threshold
    ink = bytearray(total)
    for index, value in enumerate(pixels):
        if background_is_light:
            ink[index] = 1 if value <= threshold else 0
        else:
            ink[index] = 1 if value > threshold else 0
    return ink


def _median(image: GrayImage) -> GrayImage:
    width, height = image.width, image.height
    source = image.pixels
    out = bytearray(source)
    window = [0] * 9
    for y in range(1, height - 1):
        for x in range(1, width - 1):
            cursor = 0
            for dy in (-1, 0, 1):
                row = (y + dy) * width + x
                window[cursor] = source[row - 1]
                window[cursor + 1] = source[row]
                window[cursor + 2] = source[row + 1]
                cursor += 3
            window.sort()
            out[y * width + x] = window[4]
    return GrayImage(width, height, out)


def _longest_run(ink: bytearray, y: int, width: int) -> int:
    row = y * width
    best = run = 0
    for x in range(width):
        if ink[row + x]:
            run += 1
            if run > best:
                best = run
        else:
            run = 0
    return best


def _staff_lines(ink: bytearray, width: int, height: int) -> list[int]:
    # A staff line is a long horizontal run. Fret digits and ASCII dashes are short,
    # so an absolute cutoff survives a system that only fills part of the frame.
    min_run = max(80, int(width * 0.12))
    centers: list[int] = []
    y = 0
    while y < height:
        if _longest_run(ink, y, width) >= min_run:
            end = y
            while end + 1 < height and _longest_run(ink, end + 1, width) >= int(width * 0.35):
                end += 1
            centers.append((y + end) // 2)
            y = end + 1
        else:
            y += 1
    return _regular_centers(centers)


def _text_bands(ink: bytearray, width: int, height: int) -> list[tuple[int, int]]:
    """Windows around the dash row of each string in an ASCII tab.

    A string of only dashes is a few pixels tall, while a fret number fills the
    em box, so the strings are the evenly spaced bright rows (the dashes), not
    every blob of text. Bar-line columns are ignored so they do not raise the floor.
    """
    column_ink = [0] * width
    for index, value in enumerate(ink):
        if value:
            column_ink[index % width] += 1
    vertical = int(height * 0.35)
    skip = [count > vertical for count in column_ink]
    counts = [0] * height
    for y in range(height):
        row = y * width
        counts[y] = sum(1 for x in range(width) if ink[row + x] and not skip[x])
    peak = max(counts) if counts else 0
    if peak < 8:
        return []
    threshold = peak * 0.45
    plateaus: list[tuple[int, int]] = []
    y = 0
    while y < height:
        if counts[y] >= threshold:
            end = y
            while end + 1 < height and counts[end + 1] >= threshold:
                end += 1
            strength = max(counts[y : end + 1])
            plateaus.append(((y + end) // 2, strength))
            y = end + 1
        else:
            y += 1
    # Digit strokes sit next to the dash row. Keep the stronger of two close peaks.
    plateaus.sort(key=lambda item: item[1], reverse=True)
    kept: list[int] = []
    for center, _strength in plateaus:
        if all(abs(center - other) > 18 for other in kept):
            kept.append(center)
    kept.sort()
    anchors = _regular_centers(kept)
    if len(anchors) < 4:
        return []
    windows: list[tuple[int, int]] = []
    for center in anchors:
        windows.append((max(0, center - 16), min(height - 1, center + 12)))
    return windows


def _regular_centers(centers: list[int]) -> list[int]:
    if len(centers) < 4:
        return centers
    indexes = _regular_index_run(centers, [1] * len(centers))
    return [centers[index] for index in indexes]


def _regular_index_run(centers: list[int], heights: list[int]) -> list[int]:
    best: list[int] = []
    count = len(centers)
    for start in range(count):
        for nxt in range(start + 1, min(start + 3, count)):
            spacing = centers[nxt] - centers[start]
            if spacing < 12:
                continue
            chosen = [start, nxt]
            expected = centers[nxt] + spacing
            cursor = nxt + 1
            while cursor < count and len(chosen) < 8:
                gap = abs(centers[cursor] - expected)
                if gap <= max(4, spacing * 0.18):
                    chosen.append(cursor)
                    expected = centers[cursor] + spacing
                elif centers[cursor] > expected + spacing * 0.5:
                    break
                cursor += 1
            if len(chosen) < 4 or len(chosen) <= len(best):
                continue
            picked = [heights[index] for index in chosen]
            if max(picked) > min(picked) * 1.85:
                continue
            best = chosen
    return best


def _median_gap(centers: list[int]) -> int:
    gaps = [centers[index + 1] - centers[index] for index in range(len(centers) - 1)]
    gaps.sort()
    return max(8, gaps[len(gaps) // 2] if gaps else 8)


def _windows(lines: list[int], spacing: int, height: int) -> list[tuple[int, int]]:
    half = max(8, int(spacing * 0.42))
    return [(max(0, y - half), min(height - 1, y + half)) for y in lines]


def _erase_staff(ink: bytearray, width: int, height: int, lines: list[int]) -> bytearray:
    """Remove staff-line pixels that do not connect a glyph above to one below."""
    out = bytearray(ink)
    for center in lines:
        top = bottom = center
        while top > 0 and _longest_run(ink, top - 1, width) >= int(width * 0.3):
            top -= 1
        while bottom + 1 < height and _longest_run(ink, bottom + 1, width) >= int(width * 0.3):
            bottom += 1
        if bottom - top > 6:
            top = max(0, center - 2)
            bottom = min(height - 1, center + 2)
        for x in range(width):
            if not any(ink[y * width + x] for y in range(top, bottom + 1)):
                continue
            # Look a few pixels past the line. An "8" meets the line at its waist,
            # and the loops that reconnect it are not on the adjacent row.
            above = any(ink[y * width + x] for y in range(max(0, top - 4), top))
            below = any(ink[y * width + x] for y in range(bottom + 1, min(height, bottom + 5)))
            if above and below:
                continue
            for y in range(top, bottom + 1):
                out[y * width + x] = 0
    return out


def _components(ink: bytearray, width: int, height: int, *, min_area: int = 6) -> list[_Box]:
    seen = bytearray(width * height)
    found: list[_Box] = []
    for start, value in enumerate(ink):
        if not value or seen[start]:
            continue
        stack = [start]
        seen[start] = 1
        min_x = max_x = start % width
        min_y = max_y = start // width
        area = 0
        while stack:
            index = stack.pop()
            x, y = index % width, index // width
            area += 1
            if x < min_x:
                min_x = x
            elif x > max_x:
                max_x = x
            if y < min_y:
                min_y = y
            elif y > max_y:
                max_y = y
            for ny in (y - 1, y, y + 1):
                if ny < 0 or ny >= height:
                    continue
                base = ny * width
                for nx in (x - 1, x, x + 1):
                    if nx < 0 or nx >= width:
                        continue
                    nxt = base + nx
                    if ink[nxt] and not seen[nxt]:
                        seen[nxt] = 1
                        stack.append(nxt)
        if area >= min_area:
            found.append(_Box(min_x, min_y, max_x, max_y))
    return found


def _barlines(components: Sequence[_Box], bands: Sequence[tuple[int, int]], spacing: int) -> list[_Box]:
    if len(bands) < 2:
        return []
    min_height = int(spacing * (len(bands) - 1) * 0.62)
    tall = [box for box in components if box.height >= min_height and box.width <= max(8, spacing // 6)]
    tall.sort(key=lambda box: box.x0)
    merged: list[_Box] = []
    for box in tall:
        if merged and box.x0 - merged[-1].x1 <= 6:
            previous = merged[-1]
            merged[-1] = _Box(
                min(previous.x0, box.x0),
                min(previous.y0, box.y0),
                max(previous.x1, box.x1),
                max(previous.y1, box.y1),
            )
        else:
            merged.append(box)
    return merged


def _classify(
    ink: bytearray,
    width: int,
    components: Sequence[_Box],
    bands: Sequence[tuple[int, int]],
    barlines: Sequence[_Box],
    spacing: int,
    templates: TemplateBook,
) -> list[_Glyph]:
    band_height = max(end - start + 1 for start, end in bands)
    glyphs: list[_Glyph] = []
    for box in components:
        if _near_barline(box, barlines):
            continue
        band = _nearest_band(box.cy, bands)
        if band is None:
            continue
        top, bottom = bands[band]
        if box.cy < top - 2 or box.cy > bottom + 2:
            continue
        if box.height <= max(4, int(band_height * 0.34)) and box.width > box.height:
            continue
        if box.height < spacing * 0.22:
            continue
        if box.width / box.height < 0.28 and box.height > band_height * 0.5:
            continue
        bits = _raster(ink, width, box, templates.rows, templates.cols)
        ranking = sorted((_hamming(bits, templates.glyphs[name]), name) for name in templates.glyphs)
        distance, kind = ranking[0]
        margin = ranking[1][0] - distance
        # 100/384 keeps a salt-damaged digit; letters and the title sit further away.
        if distance > 100 or margin < 8:
            continue
        glyphs.append(_Glyph(box, kind, distance, band))
    return glyphs


def _near_barline(box: _Box, barlines: Sequence[_Box]) -> bool:
    return any(not (box.x1 < bar.x0 - 2 or box.x0 > bar.x1 + 2) for bar in barlines)


def _nearest_band(y: float, bands: Sequence[tuple[int, int]]) -> int | None:
    best: int | None = None
    best_distance = 1e9
    for index, (top, bottom) in enumerate(bands):
        distance = abs(y - (top + bottom) / 2)
        if distance < best_distance:
            best_distance = distance
            best = index
    return best


def _raster(ink: bytearray, width: int, box: _Box, rows: int, cols: int) -> tuple[int, ...]:
    box_w, box_h = box.width, box.height
    scale = min(cols / box_w, rows / box_h)
    fitted_w = min(cols, max(1, round(box_w * scale)))
    fitted_h = min(rows, max(1, round(box_h * scale)))
    origin_x = (cols - fitted_w) // 2
    origin_y = (rows - fitted_h) // 2
    bits = [0] * (rows * cols)
    for row in range(fitted_h):
        y0 = box.y0 + int(row * box_h / fitted_h)
        y1 = max(y0 + 1, box.y0 + int((row + 1) * box_h / fitted_h))
        for col in range(fitted_w):
            x0 = box.x0 + int(col * box_w / fitted_w)
            x1 = max(x0 + 1, box.x0 + int((col + 1) * box_w / fitted_w))
            total = inked = 0
            for y in range(y0, min(y1, box.y1 + 1)):
                base = y * width
                for x in range(x0, min(x1, box.x1 + 1)):
                    total += 1
                    inked += ink[base + x]
            if total and inked * 2 >= total:
                bits[(origin_y + row) * cols + (origin_x + col)] = 1
    return tuple(bits)


def _hamming(left: tuple[int, ...], right: tuple[int, ...]) -> int:
    return sum(bit_a != bit_b for bit_a, bit_b in zip(left, right, strict=True))


def _notes_from_glyphs(glyphs: Sequence[_Glyph], barlines: Sequence[_Box]) -> list[TabNote]:
    by_band: dict[int, list[_Glyph]] = {}
    for glyph in glyphs:
        by_band.setdefault(glyph.band, []).append(glyph)
    merged: list[tuple[int, int, int, str]] = []
    for band, group in by_band.items():
        ordered = sorted(group, key=lambda glyph: glyph.box.x0)
        index = 0
        while index < len(ordered):
            current = ordered[index]
            if index + 1 < len(ordered) and current.kind in {"1", "2"} and ordered[index + 1].kind.isdigit():
                gap = ordered[index + 1].box.x0 - current.box.x1
                if 0 <= gap <= 18:
                    kind = current.kind + ordered[index + 1].kind
                    merged.append((band, current.box.x0, ordered[index + 1].box.x1, kind))
                    index += 2
                    continue
            merged.append((band, current.box.x0, current.box.x1, current.kind))
            index += 1
    notes: list[TabNote] = []
    for band, x0, _x1, kind in merged:
        bar = _bar_index(x0, barlines)
        if bar is None:
            continue
        left = barlines[bar]
        right = barlines[bar + 1]
        span = right.x0 - (left.x1 + 1)
        if span <= 0:
            continue
        relative = (x0 - (left.x1 + 1)) / span
        tick = int(round(relative * BAR_TICKS / QUANTUM)) * QUANTUM
        tick = min(max(tick, 0), BAR_TICKS - QUANTUM)
        dead = kind == "x"
        fret = 0 if dead else int(kind)
        if fret > 99:
            continue
        notes.append(TabNote(bar, tick, band, fret, dead))
    return _dedupe_notes(notes)


def _bar_index(x: int, barlines: Sequence[_Box]) -> int | None:
    for index in range(len(barlines) - 1):
        if barlines[index].x1 < x < barlines[index + 1].x0:
            return index
    return None


def _dedupe_notes(notes: Iterable[TabNote]) -> list[TabNote]:
    seen: set[tuple[int, int, int]] = set()
    unique: list[TabNote] = []
    for note in notes:
        key = (note.bar, note.position, note.string)
        if key in seen:
            continue
        seen.add(key)
        unique.append(note)
    return unique


def _region(
    barlines: Sequence[_Box], bands: Sequence[tuple[int, int]], spacing: int, width: int, height: int
) -> tuple[int, int, int, int]:
    pad = int(spacing * 0.2)
    x0 = max(0, barlines[0].x0 - 2)
    y0 = max(0, bands[0][0] - pad)
    x1 = min(width - 1, barlines[-1].x1 + 2)
    y1 = min(height - 1, bands[-1][1] + pad)
    return (x0, y0, x1 - x0 + 1, y1 - y0 + 1)


def _group_bars(tab: RecognizedTab) -> list[list[TabNote]]:
    grouped: list[list[TabNote]] = [[] for _ in range(tab.bar_count)]
    for note in tab.notes:
        if 0 <= note.bar < tab.bar_count:
            grouped[note.bar].append(note)
    return grouped


def _signature(notes: Sequence[TabNote]) -> tuple[tuple[int, int, int, bool], ...]:
    return tuple(sorted((note.position, note.string, note.fret, note.dead) for note in notes))


def _overlap(existing: Sequence[Sequence[TabNote]], incoming: Sequence[Sequence[TabNote]]) -> int:
    limit = min(len(existing), len(incoming))
    for size in range(limit, 0, -1):
        if [_signature(group) for group in existing[-size:]] == [_signature(group) for group in incoming[:size]]:
            return size
    return 0


def _shift_bar(note: TabNote, bar: int) -> TabNote:
    return TabNote(bar, note.position, note.string, note.fret, note.dead)


def _beats(notes: Sequence[TabNote]) -> list[Beat]:
    grouped: dict[int, list[Note]] = {}
    for note in notes:
        grouped.setdefault(note.position, []).append(Note(string=note.string, fret=note.fret, dead=note.dead))
    positions = sorted(grouped)
    beats: list[Beat] = []
    for index, position in enumerate(positions):
        nxt = positions[index + 1] if index + 1 < len(positions) else BAR_TICKS
        duration = max(QUANTUM, min(BAR_TICKS - position, nxt - position))
        beats.append(Beat(position=position, duration=duration, notes=grouped[position]))
    return beats


def _pnm_header(data: bytes) -> tuple[int, int, int, int]:
    tokens: list[bytes] = []
    index = 2
    length = len(data)
    while len(tokens) < 3:
        while index < length and data[index] in b" \t\r\n":
            index += 1
        if index < length and data[index] == ord("#"):
            while index < length and data[index] not in b"\n\r":
                index += 1
            continue
        start = index
        while index < length and data[index] not in b" \t\r\n":
            index += 1
        if start == index:
            raise TabVisionError("truncated PNM header")
        tokens.append(data[start:index])
    if index >= length:
        raise TabVisionError("truncated PNM header")
    # One whitespace byte separates the maxval from the raster.
    if data[index] in b" \t\r\n":
        index += 1
    return int(tokens[0]), int(tokens[1]), int(tokens[2]), index
