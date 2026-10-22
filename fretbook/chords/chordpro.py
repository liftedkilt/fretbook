"""ChordPro helpers.

Chord sheets (the usual format for acoustic songs) are stored as ChordPro
text and rendered by ``web/src/components/ChordSheet.svelte``; alphaTab is
built around bars of notation and is not used for them. This module reads the
metadata directives and converts the common "chords over lyrics" layout
(Ultimate Guitar style) into ChordPro, so a pasted sheet and a ``.cho`` file
end up in the same format.
"""

from __future__ import annotations

import re

MAX_CHARS = 200_000

_CHORD = re.compile(
    r"^\(?[A-G][#b]?"
    r"(?:maj|min|mi|m|M|dim|aug|sus|add|\+|°|ø)?"
    r"\d*"
    r"(?:(?:sus|add|maj|no|b|#|\+|-)\d+)*"
    r"(?:\([^)]*\))?"
    r"(?:/[A-G][#b]?)?\)?$"
)
_FILLER = {"|", "||", "-", "/", "%", "N.C.", "NC", "n.c."}
_REPEAT = re.compile(r"^\(?x\d+\)?$", re.IGNORECASE)
_SECTION = re.compile(r"^\s*\[([^\]]+)\]\s*:?\s*$")
_DIRECTIVE = re.compile(r"^\s*\{\s*([A-Za-z_]+)\s*(?::\s*(.*?))?\s*\}\s*$")
_INLINE_CHORD = re.compile(r"\[([^\]\s]+)\]")
_ALIASES = {"t": "title", "st": "subtitle", "c": "comment"}


def is_chord(token: str) -> bool:
    return bool(_CHORD.match(token))


def is_chord_line(line: str) -> bool:
    tokens = line.split()
    if not tokens:
        return False
    chords = [token for token in tokens if token not in _FILLER and not _REPEAT.match(token)]
    return bool(chords) and all(is_chord(token) for token in chords)


def looks_like_chordpro(text: str) -> bool:
    """Directives, or chords in brackets inside lyric lines, mean the text is already ChordPro."""
    for line in text.splitlines():
        if _DIRECTIVE.match(line):
            return True
        stripped = _INLINE_CHORD.sub("", line).strip()
        if _INLINE_CHORD.search(line) and stripped and not _SECTION.match(line):
            return True
    return False


def _merge(chord_line: str, lyric_line: str) -> str:
    positions = [(match.start(), match.group(0)) for match in re.finditer(r"\S+", chord_line)]
    merged = lyric_line.rstrip()
    width = max((start for start, _ in positions), default=0)
    merged = merged.ljust(width)
    for start, chord in reversed(positions):
        if chord in _FILLER or _REPEAT.match(chord):
            continue
        merged = merged[:start] + f"[{chord.strip('()')}]" + merged[start:]
    return merged.rstrip()


def _chords_only(chord_line: str) -> str:
    out: list[str] = []
    for token in chord_line.split():
        if token in _FILLER or _REPEAT.match(token):
            out.append(token)
        else:
            out.append(f"[{token.strip('()')}]")
    return " ".join(out)


def from_chords_over_lyrics(text: str, title: str = "", artist: str = "") -> str:
    """Convert a plain chords-over-lyrics sheet into ChordPro."""
    lines = text.replace("\r\n", "\n").replace("\t", "    ").split("\n")
    out: list[str] = []
    if title:
        out.append(f"{{title: {title}}}")
    if artist:
        out.append(f"{{artist: {artist}}}")
    index = 0
    while index < len(lines):
        line = lines[index]
        section = _SECTION.match(line)
        if section and not is_chord(section.group(1)):
            out.append(f"{{comment: {section.group(1).strip()}}}")
        elif is_chord_line(line):
            following = lines[index + 1] if index + 1 < len(lines) else ""
            if following.strip() and not is_chord_line(following) and not _SECTION.match(following):
                out.append(_merge(line, following))
                index += 1
            else:
                out.append(_chords_only(line))
        else:
            out.append(line.rstrip())
        index += 1
    return "\n".join(out).strip("\n") + "\n"


def normalize(text: str, title: str = "", artist: str = "") -> str:
    """ChordPro text from either ChordPro or chords-over-lyrics input."""
    text = text.replace("\r\n", "\n")
    if len(text) > MAX_CHARS:
        raise ValueError(f"chord sheet is longer than {MAX_CHARS} characters")
    if looks_like_chordpro(text):
        return text if text.endswith("\n") else text + "\n"
    return from_chords_over_lyrics(text, title, artist)


def metadata(text: str) -> dict[str, str]:
    """``title``, ``artist``, ``key``, ``capo`` and other single-value directives."""
    found: dict[str, str] = {}
    for line in text.splitlines():
        match = _DIRECTIVE.match(line)
        if not match or match.group(2) is None:
            continue
        name = _ALIASES.get(match.group(1).lower(), match.group(1).lower())
        if name in {"title", "subtitle", "artist", "key", "capo", "tempo", "composer"} and name not in found:
            found[name] = match.group(2).strip()
    if "artist" not in found and "subtitle" in found:
        found["artist"] = found["subtitle"]
    return found
