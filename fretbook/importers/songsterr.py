"""Songsterr importer.

Ports ``fetch_song.py`` and ``make_data.py`` from bass-tab-sync onto the score
model. By default an import takes the parts matching the user's default
instrument family (bass parts for a bass preset, otherwise guitar parts,
acoustic and electric together) and lists every fretted part on
``source_ref["available_tracks"]``. ``preview`` returns that list without
downloading the parts, and a picker passes ``options["part_ids"]``.
"""

from __future__ import annotations

import json
import re
from fractions import Fraction
from typing import Any, Literal, Protocol
from urllib.parse import quote

from fretbook.importers.base import AudioFetch, ImportError, ImportRequest, ImportResult, Notice, Progress
from fretbook.score import techniques
from fretbook.score.instruments import canonical_instrument, family
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
from fretbook.score.playback import played_bars

URL_RE = re.compile(r"^https://www\.songsterr\.com/a/wsa/[\w-]+-s(\d+)(?:t\d+)?/?(?:[?#].*)?$")
DEFAULT_CDN = "dqsljvtekg760.cloudfront.net"
VIDEO_ID_RE = re.compile(r"^[\w-]{11}$")
_BEAT_SKIP = {"duration", "notes", "rest", "type", "dots"} | techniques.BEAT_KEYS
_NOTE_FIELDS = {"string", "fret", "rest", "dead", "tie"} | techniques.NOTE_KEYS
_BAR_KEYS = {"voices", "signature", "repeatStart", "repeat", "repeatEnd", "alternateEnding", "marker"}
WHOLE = 4 * TICKS_PER_QUARTER


class TextFetcher(Protocol):
    def get_text(self, url: str) -> str: ...


def slug_from_url(url: str) -> str:
    segment = url.split("?", 1)[0].split("#", 1)[0].rstrip("/").split("/")[-1]
    slug = re.sub(r"-s\d+(?:t\d+)?$", "", segment)
    slug = re.sub(r"[^a-z0-9]+", "-", slug.lower()).strip("-")
    return slug[:60] or "song"


def cdn_host(html: str) -> str:
    match = re.search(r"//([\w.-]+\.cloudfront\.net)/", html)
    return match.group(1) if match else DEFAULT_CDN


def parse_page_state(html: str) -> dict[str, Any]:
    match = re.search(r'<script[^>]*id="state"[^>]*>(.*?)</script>', html, re.S)
    if not match:
        raise ImportError("Songsterr page state was not found (the site layout may have changed)", "songsterr.noState")
    try:
        state = json.loads(match.group(1))
        return state["meta"]["current"]
    except (KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ImportError("Songsterr page state could not be read", "songsterr.noState") from exc


def fretted_tracks(meta: dict[str, Any]) -> list[dict[str, Any]]:
    chosen: list[dict[str, Any]] = []
    for track in meta.get("tracks") or []:
        if track.get("isEmpty") or track.get("isDrums") or track.get("isVocalTrack") or track.get("isPiano"):
            continue
        if not track.get("tuning"):
            continue
        chosen.append(track)
    return chosen


def _is_bass(track: dict[str, Any]) -> bool:
    return bool(track.get("isBassGuitar")) or "bass" in str(track.get("instrument") or "").lower()


def choose_tracks(meta: dict[str, Any], part_ids: list[int] | None, prefer: str = "bass") -> list[dict[str, Any]]:
    """Parts of the ``prefer`` family ("bass" or "guitar") by default, or exactly ``part_ids``."""
    available = fretted_tracks(meta)
    if part_ids is not None:
        wanted = set(part_ids)
        chosen = [track for track in available if track.get("partId") in wanted]
        if not chosen:
            raise ImportError("none of the requested Songsterr parts are fretted tracks", "songsterr.noSuchPart")
        return chosen
    matching = [track for track in available if _is_bass(track) == (prefer == "bass")]
    if matching:
        return matching
    if available:
        return [available[0]]
    names = ", ".join(str(track.get("instrument", "?")) for track in meta.get("tracks") or [])
    raise ImportError(f"this song has no fretted track: {names}", "songsterr.noFrettedTrack", names=names)


def beat_ticks(raw_beat: dict[str, Any]) -> int | None:
    """Duration in ticks. ``duration`` already includes dots; a tuplet scales it unless the fraction already has."""
    duration = raw_beat.get("duration")
    if not isinstance(duration, list) or len(duration) != 2 or not duration[1]:
        return None
    value = Fraction(int(duration[0]), int(duration[1])) * WHOLE
    tuplet = techniques.tuplet_number(raw_beat.get("tuplet"))
    denominator = int(duration[1])
    if tuplet and denominator & (denominator - 1) == 0:
        actual, normal = techniques.tuplet_ratio(tuplet)
        value = value * normal / actual
    return max(1, round(value))


def _notes(raw_beat: dict[str, Any]) -> list[Note]:
    notes: list[Note] = []
    for raw in raw_beat.get("notes") or []:
        if raw.get("rest") or "fret" not in raw or "string" not in raw:
            continue
        notes.append(
            Note(
                string=int(raw["string"]),
                fret=int(raw["fret"]),
                dead=bool(raw.get("dead")),
                tie=bool(raw.get("tie")),
                **techniques.note_fields(raw, raw_beat),
                extras={key: value for key, value in raw.items() if key not in _NOTE_FIELDS},
            )
        )
    return notes


def part_bars(part: dict[str, Any]) -> tuple[list[Bar], list[TrackBar]]:
    """Song-level bars and this part's content, from one Songsterr part."""
    signature = (4, 4)
    bars: list[Bar] = []
    track_bars: list[TrackBar] = []
    for raw_measure in part.get("measures") or []:
        if raw_measure.get("signature"):
            signature = (int(raw_measure["signature"][0]), int(raw_measure["signature"][1]))
        voices: list[Voice] = []
        for raw_voice in raw_measure.get("voices") or []:
            position = 0
            beats: list[Beat] = []
            for raw_beat in raw_voice.get("beats") or []:
                ticks = beat_ticks(raw_beat)
                if ticks is None:
                    continue
                grace = techniques.grace_kind(raw_beat.get("graceNote"))
                beats.append(
                    Beat(
                        position=position,
                        duration=ticks,
                        notes=_notes(raw_beat),
                        grace=grace,
                        tuplet=techniques.tuplet_number(raw_beat.get("tuplet")),
                        extras={key: value for key, value in raw_beat.items() if key not in _BEAT_SKIP},
                    )
                )
                if grace is None:
                    position += ticks
            voices.append(Voice(beats=beats))
        bars.append(
            Bar(
                signature=signature,
                **techniques.bar_fields(raw_measure),
                extras={key: value for key, value in raw_measure.items() if key not in _BAR_KEYS},
            )
        )
        track_bars.append(TrackBar(voices=voices or [Voice()]))
    return bars, track_bars


def apply_tempos(part: dict[str, Any], bars: list[Bar]) -> float:
    """Write tempo changes onto ``bars`` and return the opening tempo."""
    opening = 120.0
    for item in (part.get("automations") or {}).get("tempo") or []:
        if "bpm" not in item:
            continue
        bpm = float(item["bpm"])
        measure = int(item.get("measure") or 0)
        if measure == 0:
            opening = bpm
        elif measure < len(bars):
            bars[measure].tempo = bpm
    return opening


def legacy_events(part: dict[str, Any]) -> tuple[float, list[list[Any]]]:
    """Reproduce ``make_data.convert`` for voice 0, including grace-note time.

    Tests use this to prove the port still lines up with the original player.
    The stored document itself does not let grace notes consume bar time,
    because alphaTab draws them as grace notes.
    """
    signature = [4, 4]
    measures: list[list[Any]] = []
    bpm = float(part["automations"]["tempo"][0]["bpm"])
    for raw_measure in part["measures"]:
        signature = raw_measure.get("signature", signature)
        length = 4 * signature[0] / signature[1]
        position = 0.0
        events: list[list[Any]] = []
        for beat in (raw_measure.get("voices") or [{}])[0].get("beats", []):
            numerator, denominator = beat["duration"]
            notes = [
                [note["string"], note["fret"]]
                for note in beat.get("notes", [])
                if not note.get("rest") and "fret" in note
            ]
            if notes:
                events.append([round(position, 4), notes])
            position += 4 * numerator / denominator
        measures.append([length, events])
    return bpm, measures


def pick_video(entries: list[dict[str, Any]], video_id: str | None) -> dict[str, Any] | None:
    usable = [entry for entry in entries if entry.get("points")]
    if not usable:
        return None
    if video_id:
        found = [entry for entry in usable if entry.get("videoId") == video_id]
        if not found:
            available = [entry.get("videoId") for entry in usable]
            raise ImportError(
                f"video {video_id} has no sync points; available: {available}",
                "songsterr.noSuchVideo",
                video=video_id,
            )
        return found[0]
    for entry in usable:
        if not entry.get("feature"):
            return entry
    return usable[0]


def _capo(part: dict[str, Any]) -> int:
    """Songsterr puts the capo on the part, sometimes only on the first measure."""
    raw = part.get("capo", part.get("capoFret"))
    if raw in (None, ""):
        measures = part.get("measures") or []
        if measures and isinstance(measures[0], dict):
            raw = measures[0].get("capo", measures[0].get("capoFret"))
    try:
        value = int(raw or 0)
    except (TypeError, ValueError):
        return 0
    return max(0, min(24, value))


def track_instrument(part: dict[str, Any], meta_track: dict[str, Any]) -> str:
    raw = str(part.get("instrument") or meta_track.get("instrument") or "")
    return canonical_instrument(
        raw,
        is_bass=_is_bass(part) or _is_bass(meta_track),
        is_guitar=bool(part.get("isGuitar") or meta_track.get("isGuitar")),
    )


def describe_track(track: dict[str, Any]) -> dict[str, Any]:
    raw = str(track.get("instrument") or "")
    is_bass = _is_bass(track)
    is_guitar = bool(track.get("isGuitar")) or (not is_bass and "guitar" in raw.lower())
    tuning = [int(note) for note in (track.get("tuning") or [])]
    return {
        "part_id": track.get("partId"),
        "name": str(track.get("name") or ""),
        "instrument": raw,
        "canonical_instrument": canonical_instrument(raw, is_bass=is_bass, is_guitar=is_guitar),
        "is_bass": is_bass,
        "is_guitar": is_guitar and not is_bass,
        "tuning": tuning,
        "string_count": len(tuning),
        "capo": _capo(track),
    }


class SongsterrImporter:
    kind = "songsterr"

    def __init__(self, fetcher: TextFetcher | None = None) -> None:
        if fetcher is None:
            from fretbook.importers.http import HttpFetcher

            fetcher = HttpFetcher()
        self.fetcher = fetcher

    def can_handle(self, request: ImportRequest) -> bool:
        return bool(request.url and URL_RE.match(request.url.strip()))

    def _page(self, url: str) -> tuple[int, dict[str, Any], str]:
        match = URL_RE.match(url)
        if not match:
            raise ImportError("URL must look like https://www.songsterr.com/a/wsa/<name>-s<digits>", "songsterr.badUrl")
        song_id = int(match.group(1))
        html = self.fetcher.get_text(url)
        meta = parse_page_state(html)
        if int(meta["songId"]) != song_id:
            raise ImportError(
                f"page song id {meta['songId']} does not match the URL ({song_id})", "songsterr.idMismatch"
            )
        return song_id, meta, html

    def preview(self, request: ImportRequest) -> dict[str, Any]:
        """Fretted parts for the track picker. Does not download part JSON or audio."""
        url = (request.url or "").strip()
        song_id, meta, _html = self._page(url)
        tracks = fretted_tracks(meta)
        if not tracks:
            names = ", ".join(str(track.get("instrument", "?")) for track in meta.get("tracks") or [])
            raise ImportError(f"this song has no fretted track: {names}", "songsterr.noFrettedTrack", names=names)
        return {
            "title": str(meta.get("title") or ""),
            "artist": str(meta.get("artist") or ""),
            "song_id": song_id,
            "tracks": [describe_track(track) for track in tracks],
        }

    def _json(self, url: str, what: str) -> Any:
        try:
            return json.loads(self.fetcher.get_text(url))
        except json.JSONDecodeError as exc:
            raise ImportError(f"Songsterr {what} was not valid JSON", "songsterr.badJson", what=what) from exc

    def import_score(self, request: ImportRequest, progress: Progress) -> ImportResult:
        url = (request.url or "").strip()
        progress("Fetching the tab", "import.fetchingTab")
        song_id, meta, html = self._page(url)
        revision = meta["revisionId"]
        image = str(meta["image"])
        host = cdn_host(html)
        raw_ids = request.options.get("part_ids")
        part_ids = [int(part_id) for part_id in raw_ids] if raw_ids is not None else None
        prefer = str(request.options.get("prefer") or "bass")
        selected = choose_tracks(meta, part_ids, prefer)

        bars: list[Bar] = []
        bpm = 120.0
        tracks: list[Track] = []
        warnings: list[Notice] = []
        for index, meta_track in enumerate(selected):
            part_id = meta_track["partId"]
            part = self._json(
                f"https://{host}/{song_id}/{revision}/{quote(image, safe='')}/{part_id}.json", f"part {part_id}"
            )
            part_song_bars, track_bars = part_bars(part)
            if index == 0:
                bars = part_song_bars or [Bar()]
                bpm = apply_tempos(part, bars)
            if not track_bars:
                track_bars = [TrackBar()]
            # Parts of one Songsterr song normally have the same bar count; pad or trim to the first.
            track_bars = (track_bars + [TrackBar() for _ in bars])[: len(bars)]
            tuning = [int(note) for note in (part.get("tuning") or meta_track.get("tuning") or [])]
            if not tuning:
                raise ImportError(f"part {part_id} has no tuning", "songsterr.noTuning", part=part_id)
            tracks.append(
                Track(
                    id=f"trk_{part_id}",
                    name=str(part.get("name") or meta_track.get("name") or meta_track.get("instrument") or "Track"),
                    instrument=track_instrument(part, meta_track),
                    capo=_capo(part),
                    tuning_midi=tuning,
                    preferred=False,
                    bars=track_bars,
                )
            )
        # Among the imported parts, the one matching the user's default family
        # is the track the song opens on. A bass-only import still prefers the
        # first bass part, as before.
        prefer_index = next((index for index, track in enumerate(tracks) if family(track.instrument) == prefer), 0)
        tracks[prefer_index].preferred = True

        progress("Fetching sync points", "import.fetchingSync")
        listing = self._json(f"https://www.songsterr.com/api/video-points/{song_id}/{revision}/list", "sync points")
        if not isinstance(listing, list):
            raise ImportError("Songsterr sync points had an unexpected shape", "songsterr.badJson", what="sync points")
        video = pick_video(listing, request.options.get("video_id") or None)
        points: list[float | None] = []
        keyed_by: Literal["written", "played"] = "written"
        chosen_video: str | None = None
        if video:
            chosen_video = str(video["videoId"])
            if not VIDEO_ID_RE.fullmatch(chosen_video):
                raise ImportError("unexpected video id", "songsterr.badVideo")
            points = [float(point) for point in video["points"]]
            # A video follows the song as played. Points that count the played bars (repeats
            # expanded) are already in the order Fretbook keys sync marks by.
            if len(points) != len(bars) and len(points) == len(played_bars(bars)):
                keyed_by = "played"
            elif len(points) != len(bars):
                warnings.append(
                    Notice(
                        "import.syncCountMismatch",
                        "sync point count does not match the bar count; playback may drift",
                        {"points": len(points), "bars": len(bars)},
                    )
                )
        else:
            warnings.append(Notice("import.noSyncPoints", "no sync points are published for this song"))

        slug = str(request.options.get("slug") or slug_from_url(url))
        if not re.fullmatch(r"[\w-]+", slug):
            raise ImportError("invalid slug", "import.badSlug")
        document = ScoreDocument(
            bpm=bpm,
            bars=bars,
            tracks=tracks,
            sync=SyncMap(video_id=chosen_video, points=points, keyed_by=keyed_by),
        )
        progress("Tab ready", "import.tabReady")
        return ImportResult(
            title=str(meta.get("title") or "Untitled"),
            artist=str(meta.get("artist") or ""),
            slug=slug,
            document=document,
            source_kind="songsterr",
            source_ref={
                "song_id": song_id,
                "revision_id": revision,
                "image": image,
                "url": url,
                "video_id": chosen_video,
                "part_ids": [track["partId"] for track in selected],
                "available_tracks": [describe_track(track) for track in fretted_tracks(meta)],
            },
            audio=AudioFetch(video_id=chosen_video) if chosen_video else None,
            warnings=warnings,
        )
