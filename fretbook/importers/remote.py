"""Turn a link into something the importers can read.

Links go through a small provider registry, tried in order:

* **Songsterr** pages: the Songsterr importer (queued as ``import.songsterr``).
* **YouTube** videos: a blank tab with the video's audio attached.
* **Anything else** is downloaded with the SSRF-safe fetcher and looked at by
  content: a score or chord file imports as if it had been uploaded, a web page
  is searched for a linked tab file or a ``<pre>`` block that holds a tab.

* **Ultimate Guitar** tab pages: the page is fetched and read by
  :mod:`fretbook.importers.ultimate_guitar` (chords as ChordPro, tabs as ASCII tab).

The YouTube tab-recognition importer (#6) plugs in here as a further provider.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from fretbook.importers import pages, sniff
from fretbook.importers.base import ImportError, Progress
from fretbook.importers.registry import refuse_by_content
from fretbook.importers.safe_fetch import Fetched, SafeFetcher
from fretbook.importers.songsterr import URL_RE as SONGSTERR_URL
from fretbook.importers.ultimate_guitar import URL_RE as ULTIMATE_GUITAR_URL

_YOUTUBE = re.compile(
    r"^https?://(?:(?:www|m|music)\.)?(?:youtube\.com/(?:watch\?(?:[^#]*&)?v=|shorts/|embed/|live/)|youtu\.be/)"
    r"([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])",
    re.IGNORECASE,
)
_HTML_HEAD = re.compile(rb"^\s*(?:<!doctype\s+html|<html|<head|<body)", re.IGNORECASE)
_KIND_SUFFIX = {
    sniff.MUSICXML: ".musicxml",
    sniff.MXL: ".mxl",
    sniff.FRETBOOK_JSON: ".json",
    sniff.CHORDPRO: ".cho",
    sniff.CHORDS_OVER_LYRICS: ".txt",
    sniff.ASCII_TAB: ".tab",
    sniff.GUITAR_PRO: ".gp",
}

Matcher = Callable[[str], bool]


@dataclass(frozen=True)
class Provider:
    name: str
    matches: Matcher


PROVIDERS: tuple[Provider, ...] = (
    Provider("songsterr", lambda url: bool(SONGSTERR_URL.match(url))),
    Provider("youtube", lambda url: youtube_video_id(url) is not None),
    Provider("ultimate-guitar", lambda url: bool(ULTIMATE_GUITAR_URL.match(url))),
)


def youtube_video_id(url: str) -> str | None:
    match = _YOUTUBE.match(url.strip())
    return match.group(1) if match else None


def provider_for(url: str) -> str:
    """``songsterr``, ``youtube``, ``ultimate-guitar`` or ``web`` (any other link)."""
    for provider in PROVIDERS:
        if provider.matches(url.strip()):
            return provider.name
    return "web"


@dataclass
class StagedFile:
    path: Path
    filename: str
    url: str


def _unrecognised() -> ImportError:
    return ImportError(
        "Couldn't recognise what this link points to. Fretbook reads " + "; ".join(sniff.SUPPORTED_LABELS) + ".",
        "import.noFileImporter",
    )


def _stage(inbox: Path, name: str, content: bytes) -> Path:
    inbox.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", name)[:80] or "download"
    path = inbox / f"{uuid.uuid4().hex}-{safe}"
    path.write_bytes(content)
    return path


def _is_html(fetched: Fetched) -> bool:
    return "html" in fetched.content_type or bool(_HTML_HEAD.match(fetched.content[:512]))


def _name_for(fetched: Fetched, kind: str) -> str:
    return (Path(fetched.filename).stem or "download") + _KIND_SUFFIX[kind]


def _accept(fetched: Fetched, inbox: Path) -> StagedFile | None:
    """Stage a download if its content is a format the importers read; ``None`` if it is not."""
    found = sniff.sniff_bytes(fetched.content, fetched.filename)
    if found.kind is None:
        return None
    refuse_by_content(found.kind)
    if found.kind == sniff.AUDIO:
        name = (Path(fetched.filename).stem or "download") + (found.audio_suffix or ".mp3")
    else:
        name = _name_for(fetched, found.kind)
    return StagedFile(_stage(inbox, name, fetched.content), name, fetched.url)


def fetch_importable(url: str, fetcher: SafeFetcher, inbox: Path, progress: Progress) -> StagedFile:
    """Download ``url`` and stage what it holds as a local file. Raises ``ImportError`` when nothing usable is found."""
    progress("Downloading the link", "import.fetching")
    fetched = fetcher.fetch(url)
    if not _is_html(fetched):
        staged = _accept(fetched, inbox)
        if staged is None:
            raise _unrecognised()
        return staged
    text = fetched.content.decode("utf-8", errors="replace")
    progress("Looking for a tab on the page", "import.scanningPage")
    last: ImportError | None = None
    for link in pages.linked_files(text, fetched.url):
        try:
            staged = _accept(fetcher.fetch(link), inbox)
        except ImportError as exc:
            last = last or exc
            continue
        if staged is not None:
            return staged
    blocks = pages.tab_blocks(text)
    if blocks:
        title = pages.page_title(text) or "Tab"
        return StagedFile(_stage(inbox, "page.tab", blocks[0].encode("utf-8")), f"{title}.tab", fetched.url)
    if last is not None:
        raise last
    raise _unrecognised()
