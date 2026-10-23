"""Tag text rules and the tags suggested for a freshly imported song."""

from __future__ import annotations

import re
from typing import Any

from fretbook.chords import chordpro

MAX_TAG_CHARS = 40
MAX_TAGS_PER_SONG = 30

_SPACE = re.compile(r"\s+")
# Alternate tunings worth a tag, highest string first. Standard tuning is the default and gets none.
_TUNINGS: dict[tuple[int, ...], str] = {
    (64, 59, 55, 50, 45, 38): "Drop D",
    (63, 58, 54, 49, 44, 39): "Eb standard",
    (62, 57, 53, 48, 43, 38): "D standard",
    (43, 38, 33, 26): "Drop D",
}


def clean_tag(raw: str) -> str:
    """One tag as stored: whitespace collapsed, trimmed, and cut to :data:`MAX_TAG_CHARS`. May be empty."""
    return _SPACE.sub(" ", raw).strip()[:MAX_TAG_CHARS].strip()


def clean_tags(raw: list[str]) -> list[str]:
    """Cleaned tags in the order given, without empties or case-insensitive repeats, up to :data:`MAX_TAGS_PER_SONG`."""
    seen: set[str] = set()
    tags: list[str] = []
    for item in raw:
        tag = clean_tag(item)
        if tag and tag.casefold() not in seen:
            seen.add(tag.casefold())
            tags.append(tag)
    return tags[:MAX_TAGS_PER_SONG]


def suggest_tags(song: dict[str, Any]) -> list[str]:
    """Instrument, tuning name, capo and key for a song as :meth:`SongRepository.get_song` returns it.

    A tab gives the preferred track's instrument, a named alternate tuning, and its
    capo. A chord sheet gives the ``key`` and ``capo`` directives. Only what is known is returned.
    """
    found: list[str] = []
    if song["content_kind"] == "tab" and song.get("document"):
        document = song["document"]
        tracks = document.get("tracks") or []
        track = next((item for item in tracks if item.get("id") == song.get("preferred_track_id")), None)
        track = track or next(iter(tracks), None)
        if track:
            instrument = str(track.get("instrument") or "").replace("-", " ").strip()
            if instrument:
                found.append(instrument.capitalize())
            tuning = _TUNINGS.get(tuple(int(note) for note in track.get("tuning_midi", [])))
            if tuning:
                found.append(tuning)
            if track.get("capo"):
                found.append(f"Capo {track['capo']}")
    elif song["content_kind"] == "chords":
        meta = chordpro.metadata(song.get("chordpro") or "")
        if meta.get("key"):
            found.append(f"Key of {meta['key']}")
        if meta.get("capo", "").isdigit() and int(meta["capo"]) > 0:
            found.append(f"Capo {int(meta['capo'])}")
    return clean_tags(found)
