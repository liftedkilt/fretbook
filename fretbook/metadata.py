"""Song metadata: checking what a person types, recognising cover images, and the opt-in online lookup.

The lookup (``FRETBOOK_METADATA_LOOKUP``) asks MusicBrainz which release a recording by this artist with this title
first appeared on, and the Cover Art Archive for that release's front cover. It only runs when a person presses the
button, goes through the SSRF-safe fetcher, and never replaces a value the person already set.
"""

from __future__ import annotations

import json
import re
import threading
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote, urlencode

from fretbook import __version__
from fretbook.importers.base import ImportError
from fretbook.importers.safe_fetch import SafeFetcher
from fretbook.score.key import parse_key

MAX_COVER_BYTES = 5 * 1024 * 1024
COVER_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp"}

_USER_AGENT = f"Fretbook/{__version__} ( https://github.com/liftedkilt/fretbook )"
_MUSICBRAINZ = "https://musicbrainz.org/ws/2/recording/"
_COVER_ARCHIVE = "https://coverartarchive.org"
_YEAR = re.compile(r"^(\d{4})")
# MusicBrainz asks for at most one request a second from a client.
_gate = threading.Lock()
_last_request = 0.0


def sniff_cover(data: bytes) -> tuple[str, str] | None:
    """``(suffix, content type)`` of a PNG, JPEG or WebP image by its first bytes, else ``None``.

    SVG and anything else is refused: the file is served from this origin, and a script in an SVG would run.
    """
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png", COVER_TYPES[".png"]
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg", COVER_TYPES[".jpg"]
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp", COVER_TYPES[".webp"]
    return None


class MetadataError(ValueError):
    """A metadata field that cannot be stored. ``field`` names it."""

    def __init__(self, field: str, message: str) -> None:
        super().__init__(message)
        self.field = field


def clean_metadata(raw: dict[str, Any], limits: dict[str, int], year_range: tuple[int, int]) -> dict[str, Any]:
    """The given fields, trimmed and checked, ready for ``SongRepository.set_metadata``.

    ``key`` may be any spelling :func:`parse_key` understands, or empty to fall back to the detected key.
    ``year`` may be ``None``.
    """
    clean: dict[str, Any] = {}
    for name, value in raw.items():
        if name == "key":
            text = (value or "").strip()
            key = parse_key(text) if text else ""
            if key is None:
                raise MetadataError("key", "not a musical key")
            clean["key"] = key
        elif name == "year":
            if value is not None and not year_range[0] <= value <= year_range[1]:
                raise MetadataError("year", "year out of range")
            clean["year"] = value
        elif name in limits:
            text = (value or "").strip() if name != "notes" else (value or "").replace("\r\n", "\n").strip()
            if len(text) > limits[name]:
                raise MetadataError(name, f"{name} is too long")
            clean[name] = text
    return clean


@dataclass
class Found:
    album: str = ""
    year: int | None = None
    cover: bytes | None = None


def _lucene(text: str) -> str:
    """A phrase for a Lucene query: backslashes and quotes escaped, so a title cannot add clauses."""
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _throttle() -> None:
    global _last_request
    with _gate:
        wait = _last_request + 1.0 - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last_request = time.monotonic()


def lookup(fetcher: SafeFetcher, title: str, artist: str) -> Found | None:
    """The album, year and front cover MusicBrainz and the Cover Art Archive know for this song, if any."""
    if not title.strip():
        return None
    query = f"recording:{_lucene(title.strip())}"
    if artist.strip():
        query += f" AND artist:{_lucene(artist.strip())}"
    _throttle()
    reply = fetcher.fetch(
        f"{_MUSICBRAINZ}?{urlencode({'query': query, 'fmt': 'json', 'limit': 5})}",
        headers={"User-Agent": _USER_AGENT, "Accept": "application/json"},
    )
    try:
        recordings = json.loads(reply.content).get("recordings", [])
    except (ValueError, AttributeError):
        return None
    for recording in recordings:
        releases = [release for release in recording.get("releases", []) if isinstance(release, dict)]
        if not releases:
            continue
        # Official albums first, then anything else, each in the order MusicBrainz ranked them.
        releases.sort(
            key=lambda release: (
                release.get("status") != "Official",
                (release.get("release-group") or {}).get("primary-type") != "Album",
            )
        )
        release = releases[0]
        found = Found(album=str(release.get("title") or ""))
        match = _YEAR.match(str(recording.get("first-release-date") or release.get("date") or ""))
        found.year = int(match.group(1)) if match else None
        group = (release.get("release-group") or {}).get("id")
        for path in ([f"release-group/{quote(str(group))}"] if group else []) + [
            f"release/{quote(str(release['id']))}"
        ]:
            found.cover = _front_cover(fetcher, path)
            if found.cover:
                break
        return found
    return None


def _front_cover(fetcher: SafeFetcher, path: str) -> bytes | None:
    try:
        image = fetcher.fetch(f"{_COVER_ARCHIVE}/{path}/front-500", headers={"User-Agent": _USER_AGENT})
    except ImportError:
        return None
    if len(image.content) > MAX_COVER_BYTES or sniff_cover(image.content) is None:
        return None
    return image.content
