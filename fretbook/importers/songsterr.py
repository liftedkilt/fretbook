"""Songsterr importer.

Ports ``fetch_song.py`` and ``make_data.py``. The default track selection is
still the bass part, which is what the original player downloaded. Every
fretted part is listed on ``source_ref["available_tracks"]`` so issue #4 can
ask the user which guitar tracks to import and pass ``options["part_ids"]``.
"""

from __future__ import annotations

import json
import re
from typing import Any, Protocol
from urllib.parse import quote

from fretbook.importers.base import AudioFetch, ImportError, ImportRequest, ImportResult, Progress
from fretbook.score.model import Beat, Measure, Note, ScoreDocument, SyncMap, TempoMark, Track, Voice

URL_RE = re.compile(r"^https://www\.songsterr\.com/a/wsa/[\w-]+-s(\d+)(?:t\d+)?/?(?:[?#].*)?$")
DEFAULT_CDN = "dqsljvtekg760.cloudfront.net"
VIDEO_ID_RE = re.compile(r"^[\w-]{11}$")
_BEAT_SKIP = {"duration", "notes", "rest", "type", "dots"}
_NOTE_FIELDS = {"string", "fret", "rest", "dead", "tie"}


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
        raise ImportError("Songsterr page state was not found (the site layout may have changed)")
    try:
        state = json.loads(match.group(1))
        return state["meta"]["current"]
    except (KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ImportError("Songsterr page state could not be read") from exc


def fretted_tracks(meta: dict[str, Any]) -> list[dict[str, Any]]:
    chosen: list[dict[str, Any]] = []
    for track in meta.get("tracks") or []:
        if track.get("isEmpty") or track.get("isDrums") or track.get("isVocalTrack"):
            continue
        if track.get("isPiano"):
            continue
        tuning = track.get("tuning") or []
        if not tuning:
            continue
        chosen.append(track)
    return chosen


def choose_tracks(meta: dict[str, Any], part_ids: list[int] | None) -> list[dict[str, Any]]:
    """Bass parts by default. ``part_ids`` is the hook issue #4's picker calls."""
    available = fretted_tracks(meta)
    if part_ids is not None:
        wanted = set(part_ids)
        chosen = [track for track in available if track.get("partId") in wanted]
        if not chosen:
            raise ImportError("none of the requested Songsterr parts are fretted tracks")
        return chosen
    bass = [track for track in available if track.get("isBassGuitar")]
    if bass:
        return bass
    if available:
        return [available[0]]
    names = ", ".join(track.get("instrument", "?") for track in meta.get("tracks") or [])
    raise ImportError(f"this song has no fretted track: {names}")


def _notes(raw_notes: list[dict[str, Any]]) -> list[Note]:
    notes: list[Note] = []
    for raw in raw_notes:
        if raw.get("rest") or "fret" not in raw or "string" not in raw:
            continue
        extras = {key: value for key, value in raw.items() if key not in _NOTE_FIELDS}
        notes.append(
            Note(
                string=int(raw["string"]),
                fret=int(raw["fret"]),
                dead=bool(raw.get("dead")),
                tie=bool(raw.get("tie")),
                extras=extras,
            )
        )
    return notes


def part_to_track(part: dict[str, Any], meta_track: dict[str, Any], track_id: str, preferred: bool) -> Track:
    signature = [4, 4]
    measures: list[Measure] = []
    for raw_measure in part.get("measures") or []:
        if raw_measure.get("signature"):
            signature = [int(raw_measure["signature"][0]), int(raw_measure["signature"][1])]
        voices: list[Voice] = []
        for raw_voice in raw_measure.get("voices") or []:
            position = 0.0
            beats: list[Beat] = []
            for raw_beat in raw_voice.get("beats") or []:
                duration = raw_beat.get("duration")
                if not isinstance(duration, list) or len(duration) != 2 or not duration[1]:
                    continue
                quarters = 4 * float(duration[0]) / float(duration[1])
                notes = _notes(raw_beat.get("notes") or [])
                extras = {key: value for key, value in raw_beat.items() if key not in _BEAT_SKIP}
                grace = bool(raw_beat.get("graceNote"))
                beats.append(
                    Beat(
                        position=round(position, 4),
                        duration=round(max(quarters, 0.01), 4),
                        notes=notes,
                        rest=not notes,
                        extras=extras,
                    )
                )
                if not grace:
                    position += quarters
            voices.append(Voice(beats=beats))
        if not voices:
            voices = [Voice()]
        extras = {key: value for key, value in raw_measure.items() if key not in {"voices", "signature"}}
        measures.append(
            Measure(signature=(signature[0], signature[1]), voices=voices, extras=extras)
        )
    if not measures:
        measures = [Measure()]
    tuning = [int(note) for note in (part.get("tuning") or meta_track.get("tuning") or [])]
    if not tuning:
        raise ImportError(f"part {meta_track.get('partId')} has no tuning")
    return Track(
        id=track_id,
        name=str(part.get("name") or meta_track.get("name") or meta_track.get("instrument") or "Track"),
        instrument=str(part.get("instrument") or meta_track.get("instrument") or "unknown"),
        capo=int(part.get("capo") or 0),
        tuning_midi=tuning,
        preferred=preferred,
        measures=measures,
    )


def tempos_from(part: dict[str, Any]) -> list[TempoMark]:
    marks: list[TempoMark] = []
    for item in (part.get("automations") or {}).get("tempo") or []:
        if "bpm" not in item:
            continue
        marks.append(TempoMark(bpm=float(item["bpm"]), measure=int(item.get("measure") or 0)))
    return marks


def legacy_events(part: dict[str, Any]) -> tuple[float, list[list[Any]]]:
    """Reproduce ``make_data.convert`` for voice 0, including grace-note time.

    Tests use this to prove the port still lines up with the original player.
    The stored document itself does not let grace notes consume measure time,
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
            raise ImportError(f"video {video_id} has no sync points; available: {available}")
        return found[0]
    for entry in usable:
        if not entry.get("feature"):
            return entry
    return usable[0]


def describe_track(track: dict[str, Any]) -> dict[str, Any]:
    return {
        "part_id": track.get("partId"),
        "name": track.get("name") or "",
        "instrument": track.get("instrument") or "",
        "is_bass": bool(track.get("isBassGuitar")),
        "is_guitar": bool(track.get("isGuitar")),
        "tuning": list(track.get("tuning") or []),
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

    def import_score(self, request: ImportRequest, progress: Progress) -> ImportResult:
        url = (request.url or "").strip()
        match = URL_RE.match(url)
        if not match:
            raise ImportError(
                "URL must look like https://www.songsterr.com/a/wsa/<name>-s<digits>"
            )
        song_id = int(match.group(1))
        progress("Fetching the tab", "import.fetchingTab")
        html = self.fetcher.get_text(url)
        meta = parse_page_state(html)
        if int(meta["songId"]) != song_id:
            raise ImportError(f"page song id {meta['songId']} does not match the URL ({song_id})")
        revision = meta["revisionId"]
        image = str(meta["image"])
        host = cdn_host(html)
        raw_ids = request.options.get("part_ids")
        part_ids = [int(part_id) for part_id in raw_ids] if raw_ids is not None else None
        selected = choose_tracks(meta, part_ids)
        video_id = request.options.get("video_id") or None

        tracks: list[Track] = []
        tempos: list[TempoMark] = []
        warnings: list[str] = []
        bass_ids = [track["partId"] for track in selected if track.get("isBassGuitar")]
        preferred_part = bass_ids[0] if bass_ids else selected[0]["partId"]
        for meta_track in selected:
            part_url = (
                f"https://{host}/{song_id}/{revision}/{quote(image, safe='')}/"
                f"{meta_track['partId']}.json"
            )
            try:
                part = json.loads(self.fetcher.get_text(part_url))
            except json.JSONDecodeError as exc:
                raise ImportError(
                    f"Songsterr part {meta_track['partId']} was not valid JSON"
                ) from exc
            track = part_to_track(
                part,
                meta_track,
                f"trk_{meta_track['partId']}",
                meta_track["partId"] == preferred_part,
            )
            tracks.append(track)
            if track.preferred and not tempos:
                tempos = tempos_from(part)

        if not any(track.preferred for track in tracks):
            tracks[0].preferred = True
        bpm = tempos[0].bpm if tempos else 120.0
        if not tempos:
            tempos = [TempoMark(bpm=bpm, measure=0)]

        progress("Fetching sync points", "import.fetchingSync")
        points_url = f"https://www.songsterr.com/api/video-points/{song_id}/{revision}/list"
        try:
            listing = json.loads(self.fetcher.get_text(points_url))
        except json.JSONDecodeError as exc:
            raise ImportError("Songsterr sync points were not valid JSON") from exc
        if not isinstance(listing, list):
            raise ImportError("Songsterr sync points had an unexpected shape")
        video = pick_video(listing, video_id)
        points: list[float] = []
        chosen_video: str | None = None
        if video:
            chosen_video = str(video["videoId"])
            if not VIDEO_ID_RE.fullmatch(chosen_video):
                raise ImportError("unexpected video id")
            points = [float(point) for point in video["points"]]
            measure_count = len(next(track for track in tracks if track.preferred).measures)
            if len(points) != measure_count:
                warnings.append(
                    "sync point count does not match the measure count; playback may drift"
                )
        else:
            warnings.append("no sync points are published for this song")

        slug = str(request.options.get("slug") or slug_from_url(url))
        if not re.fullmatch(r"[\w-]+", slug):
            raise ImportError("invalid slug")
        document = ScoreDocument(
            bpm=bpm,
            tempos=tempos,
            tracks=tracks,
            sync=SyncMap(video_id=chosen_video, points=points),
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
                "available_tracks": [describe_track(track) for track in fretted_tracks(meta)],
            },
            audio=AudioFetch(video_id=chosen_video) if chosen_video else None,
            warnings=warnings,
        )
