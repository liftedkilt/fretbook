"""Look through a web page for a tab the importers can read.

Used for a link that is neither a known site nor a file: a forum post or a blog
page may link to a ``.gp5`` or ``.musicxml`` file, or hold the tab itself in a
``<pre>`` block.
"""

from __future__ import annotations

import html
from html.parser import HTMLParser
from urllib.parse import urldefrag, urljoin, urlsplit

from fretbook.importers.ascii_tab import looks_like_ascii_tab

MAX_LINKS = 3
# Best sources first: a Guitar Pro or MusicXML file beats a text sheet.
LINK_EXTENSIONS = (".gp5", ".gp4", ".gp3", ".gpx", ".gp", ".musicxml", ".mxl", ".cho", ".chordpro", ".chopro", ".crd")


class _Page(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[str] = []
        self.blocks: list[str] = []
        self.title = ""
        self._pre = 0
        self._current: list[str] = []
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.links.append(href)
        elif tag == "pre":
            self._pre += 1
        elif tag == "title":
            self._in_title = True
        elif tag == "br" and self._pre:
            self._current.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag == "pre" and self._pre:
            self._pre -= 1
            if not self._pre:
                self.blocks.append("".join(self._current))
                self._current = []
        elif tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._pre:
            self._current.append(data)
        elif self._in_title:
            self.title += data


def _parse(text: str) -> _Page:
    page = _Page()
    page.feed(text)
    page.close()
    return page


def linked_files(text: str, base_url: str) -> list[str]:
    """Absolute http(s) links to supported file types, best format first, at most :data:`MAX_LINKS`."""
    found: dict[str, int] = {}
    for href in _parse(text).links:
        url = urldefrag(urljoin(base_url, html.unescape(href.strip())))[0]
        parts = urlsplit(url)
        if parts.scheme not in {"http", "https"}:
            continue
        path = parts.path.lower()
        for rank, extension in enumerate(LINK_EXTENSIONS):
            if path.endswith(extension):
                found.setdefault(url, rank)
                break
    return [url for url, _rank in sorted(found.items(), key=lambda item: item[1])][:MAX_LINKS]


def tab_blocks(text: str) -> list[str]:
    """``<pre>`` blocks that hold ASCII tab, longest first."""
    blocks = [block for block in _parse(text).blocks if looks_like_ascii_tab(block)]
    return sorted(blocks, key=len, reverse=True)


def page_title(text: str) -> str:
    return " ".join(_parse(text).title.split())
