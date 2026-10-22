#!/usr/bin/env python3
"""Convert a Songsterr part JSON (one instrument track) into a standalone HTML tab.

Usage: tab2html.py <part.json> <out.html>
Reads measures -> voices[0] -> beats -> notes (string index 0 = highest string)
and renders a plain monospace ASCII tab, one row of measures per line.
"""
import html
import json
import sys

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
MEASURES_PER_ROW = 4
CELL = 4  # characters per beat


def string_labels(tuning):
    # tuning is listed highest string first, as MIDI numbers
    return [NOTE_NAMES[t % 12] for t in tuning]


def render_measure(measure, n_strings):
    beats = (measure.get("voices") or [{}])[0].get("beats", [])
    rows = [""] * n_strings
    for beat in beats or [{}]:
        frets = {}
        for note in beat.get("notes", []):
            if not note.get("rest") and "fret" in note:
                frets[note["string"]] = str(note["fret"])
        for s in range(n_strings):
            rows[s] += frets.get(s, "").ljust(CELL, "-")
    return rows


def render(part):
    n = part["strings"]
    labels = string_labels(part["tuning"])
    width = max(len(x) for x in labels)
    measures = [render_measure(m, n) for m in part["measures"]]
    out = []
    for start in range(0, len(measures), MEASURES_PER_ROW):
        chunk = measures[start:start + MEASURES_PER_ROW]
        out.append(f"measure {start + 1}")
        for s in range(n):
            line = labels[s].ljust(width) + "|"
            line += "|".join(m[s] for m in chunk) + "|"
            out.append(line)
        out.append("")
    return "\n".join(out)


def main(src, dst):
    with open(src, encoding="utf-8") as f:
        part = json.load(f)
    title = f'{part.get("instrument", "Tab")} (songId {part.get("songId")})'
    body = html.escape(render(part))
    page = (
        "<!doctype html><meta charset=utf-8>"
        f"<title>{html.escape(title)}</title>"
        "<style>body{background:#1c1c1e;color:#eee;padding:1rem}"
        "pre{font:14px/1.3 monospace}</style>"
        f"<h1>{html.escape(title)}</h1><pre>{body}</pre>"
    )
    with open(dst, "w", encoding="utf-8") as f:
        f.write(page)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
