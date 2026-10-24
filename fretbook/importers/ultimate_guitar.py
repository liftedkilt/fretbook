"""Import a chord sheet or a tab from an Ultimate Guitar page.

Ultimate Guitar renders its tab pages from a JSON store embedded in the HTML
(``<div class="js-store" data-content="…">``). This module reads that store and
turns the text version of a tab into what Fretbook already imports:

* **Chords** pages become ChordPro, through the chords-over-lyrics converter.
  Capo and key become ``{capo}`` and ``{key}`` directives. ChordPro has no tuning
  directive, so a non-standard tuning is written as a ``{comment}``.
* **Tabs** and **Bass Tabs** pages go through the ASCII tab importer.
* **Official**, **Pro** and other Guitar Pro based pages are drawn in the
  browser and have no text, so they are refused with a clear message.

Nothing here touches the network: :func:`parse_page` takes the HTML, and the job
handler fetches the page with the SSRF-safe fetcher.
"""

from __future__ import annotations

import html
import json
import re
from dataclasses import dataclass
from typing import Any

from fretbook.chords import chordpro
from fretbook.importers import ascii_tab
from fretbook.importers.base import ImportError, ImportResult, Notice
from fretbook.score.model import ScoreDocument
from fretbook.score.tuning import labels_to_midi

URL_RE = re.compile(r"^https?://(?:(?:www|tabs|m)\.)?ultimate-guitar\.com/tab/\S+", re.IGNORECASE)
SOURCE_KIND = "ultimate-guitar"

_STORE = re.compile(r"""<div\b[^>]*\bclass=["'][^"']*\bjs-store\b[^"']*["'][^>]*>""", re.IGNORECASE)
_DATA_CONTENT = re.compile(r"""\bdata-content=(?:"([^"]*)"|'([^']*)')""", re.IGNORECASE)
_MARKUP = re.compile(r"\[/?(?:ch|tab)\]", re.IGNORECASE)
_STANDARD_TUNING = "E A D G B E"
_CHORD_TYPES = {"chords", "ukulele chords"}
_TAB_TYPES = {"tabs", "bass tabs"}


@dataclass
class Page:
    tab_id: str
    title: str
    artist: str
    kind: str
    """The page's own type name, lower-cased: ``chords``, ``tabs``, ``official``, …"""
    content: str
    capo: int
    key: str
    tuning: str


def _store(page_html: str) -> dict[str, Any]:
    for tag in _STORE.finditer(page_html):
        found = _DATA_CONTENT.search(tag.group(0))
        if not found:
            continue
        try:
            data = json.loads(html.unescape(found.group(1) or found.group(2) or ""))
        except ValueError:
            continue
        if isinstance(data, dict):
            return data
    raise ImportError(
        "Ultimate Guitar's page could not be read. The site may have changed, or it blocked this server.",
        "ultimateGuitar.noStore",
    )


def _find(node: Any, key: str) -> Any:
    """The first value stored under ``key``, anywhere in nested dicts and lists."""
    if isinstance(node, dict):
        if key in node:
            return node[key]
        children: Any = node.values()
    elif isinstance(node, list):
        children = node
    else:
        return None
    for child in children:
        found = _find(child, key)
        if found is not None:
            return found
    return None


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _number(value: Any) -> int:
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0


def read_page(page_html: str) -> Page:
    """Pull the song, its type and its text out of the page's JSON store."""
    store = _store(page_html)
    view = _dict(_find(store, "tab_view"))
    tab = _dict(_find(store, "tab"))
    if not tab and not view:
        raise ImportError("This Ultimate Guitar page has no tab on it.", "ultimateGuitar.noTab")
    meta = _dict(view.get("meta"))
    content = _text(_dict(view.get("wiki_tab")).get("content"))
    return Page(
        tab_id=str(tab.get("id") or ""),
        title=_text(tab.get("song_name")),
        artist=_text(tab.get("artist_name")),
        kind=_text(tab.get("type")).lower(),
        content=content,
        capo=_number(meta.get("capo") if meta.get("capo") is not None else view.get("capo")),
        key=_text(meta.get("tonality") or tab.get("tonality_name")),
        tuning=_text(_dict(meta.get("tuning")).get("value")),
    )


def _plain(content: str) -> str:
    """The text with the ``[ch]`` and ``[tab]`` markup removed; section labels like ``[Chorus]`` stay."""
    return _MARKUP.sub("", content.replace("\r\n", "\n").replace("\r", "\n"))


def _tuning_comment(tuning: str) -> str:
    notes = tuning.split()
    if not notes or " ".join(notes).upper() == _STANDARD_TUNING:
        return ""
    return f"Tuning: {' '.join(notes)}"


def _to_chordpro(page: Page, text: str) -> str:
    if len(text) > chordpro.MAX_CHARS:
        raise ImportError(
            f"chord sheet is longer than {chordpro.MAX_CHARS} characters", "chords.tooLong", limit=chordpro.MAX_CHARS
        )
    body = chordpro.from_chords_over_lyrics(text, page.title, page.artist)
    lines = body.split("\n")
    # After the {title} and {artist} lines the converter writes.
    at = sum(1 for line in lines[:2] if line.startswith(("{title:", "{artist:")))
    extra = []
    if page.key:
        extra.append(f"{{key: {page.key}}}")
    if page.capo:
        extra.append(f"{{capo: {page.capo}}}")
    comment = _tuning_comment(page.tuning)
    if comment:
        extra.append(f"{{comment: {comment}}}")
    return "\n".join([*lines[:at], *extra, *lines[at:]])


def _slug(page: Page) -> str:
    return ascii_tab._slug(f"{page.artist} {page.title}")


def parse_page(page_html: str, url: str) -> ImportResult:
    """Turn an Ultimate Guitar page into an import result. Raises :class:`ImportError` for pages with no text."""
    page = read_page(page_html)
    if page.kind and page.kind not in _CHORD_TYPES | _TAB_TYPES:
        raise ImportError(
            f"Ultimate Guitar's {page.kind or 'official'} tabs are Guitar Pro based and are not available as text. "
            "Import a Guitar Pro file for this song instead.",
            "ultimateGuitar.notText",
            type=page.kind,
        )
    text = _plain(page.content)
    if not text.strip():
        raise ImportError("This Ultimate Guitar page has no text version of the tab.", "ultimateGuitar.noTab")
    source_ref: dict[str, Any] = {"url": url, "tab_id": page.tab_id, "type": page.kind}
    if page.capo:
        source_ref["capo"] = page.capo
    if page.key:
        source_ref["key"] = page.key
    if page.tuning:
        source_ref["tuning"] = page.tuning
    title = page.title or "Untitled"
    if page.kind in _TAB_TYPES and ascii_tab.looks_like_ascii_tab(text):
        parsed = ascii_tab.parse(text)
        warnings: list[Notice] = list(parsed.warnings)
        document = parsed.document
        _apply_tuning(document, page.tuning)
        source_ref.update({"rhythm_estimated": True, "grid": ascii_tab.DEFAULT_GRID})
        if page.capo:
            document.tracks[0].capo = page.capo
        return ImportResult(
            title=title,
            artist=page.artist or parsed.artist,
            slug=_slug(page),
            document=document,
            source_kind=SOURCE_KIND,
            source_ref=source_ref,
            warnings=warnings,
        )
    return ImportResult(
        title=title,
        artist=page.artist,
        slug=_slug(page),
        chordpro=_to_chordpro(page, text),
        source_kind=SOURCE_KIND,
        source_ref=source_ref,
    )


def _apply_tuning(document: ScoreDocument, tuning: str) -> None:
    """Use the page's tuning when it names as many strings as the tab has; otherwise keep what the tab's labels gave."""
    notes = tuning.split()
    track = document.tracks[0]
    if not notes or len(notes) != len(track.tuning_midi):
        return
    try:
        midi = labels_to_midi(notes[::-1])
    except (ValueError, KeyError):
        return
    if midi and len(midi) == len(track.tuning_midi):
        track.tuning_midi = midi
