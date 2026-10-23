"""Map source-specific technique fields onto the typed fields of :class:`Note` and :class:`Beat`.

Songsterr JSON names techniques its own way. Importers translate them here so the
renderer only ever reads typed fields.
"""

from __future__ import annotations

from typing import Any

from .model import GraceKind

NOTE_KEYS = {"hp", "slide", "ghost", "vibrato", "harmonic", "bend", "palmMute", "letRing", "staccato"}
BEAT_KEYS = {"graceNote", "tuplet", "palmMute", "letRing"}


def slide_kind(raw: Any) -> str | None:
    if not raw:
        return None
    text = str(raw).lower()
    if "legato" in text:
        return "legato"
    if "below" in text:
        return "in_below"
    if "above" in text:
        return "in_above"
    if "down" in text:
        return "out_down"
    if "up" in text:
        return "out_up"
    return "shift"


def harmonic_kind(raw: Any) -> str | None:
    if not raw:
        return None
    text = str(raw).lower()
    for kind in ("artificial", "pinch", "tap", "semi"):
        if kind in text:
            return kind
    return "natural"


def grace_kind(raw: Any) -> GraceKind | None:
    if not raw:
        return None
    text = str(raw).lower().replace("_", "")
    if "before" in text:
        return "before_beat"
    if "bend" in text:
        return "bend"
    return "on_beat"


def bend_semitones(raw: Any) -> float | None:
    """Songsterr and Guitar Pro use 100 for a full (whole-step) bend."""
    tone: Any = raw
    if isinstance(raw, dict):
        tone = raw.get("tone")
        if tone is None and isinstance(raw.get("points"), list):
            tones = [point.get("tone", 0) for point in raw["points"] if isinstance(point, dict)]
            tone = max(tones, default=0)
    if isinstance(tone, bool) or not isinstance(tone, int | float) or tone <= 0:
        return None
    return round(min(float(tone) / 50, 4.0), 2)


def note_fields(raw: dict[str, Any], beat_raw: dict[str, Any] | None = None) -> dict[str, Any]:
    """Typed note fields from Songsterr-style keys on the note (and beat-wide palm mute / let ring)."""
    beat_raw = beat_raw or {}
    fields: dict[str, Any] = {
        "hammer": bool(raw.get("hp")),
        "slide": slide_kind(raw.get("slide")),
        "ghost": bool(raw.get("ghost")),
        "vibrato": bool(raw.get("vibrato")),
        "harmonic": harmonic_kind(raw.get("harmonic")),
        "bend": bend_semitones(raw.get("bend")),
        "palm_mute": bool(raw.get("palmMute") or beat_raw.get("palmMute")),
        "let_ring": bool(raw.get("letRing") or beat_raw.get("letRing")),
        "staccato": bool(raw.get("staccato")),
    }
    return fields


def tuplet_number(raw: Any) -> int | None:
    if isinstance(raw, bool):
        return None
    if isinstance(raw, int) and 2 <= raw <= 16:
        return raw
    if isinstance(raw, dict):
        return tuplet_number(raw.get("enters") or raw.get("actual"))
    return None


def tuplet_ratio(actual: int) -> tuple[int, int]:
    """``actual`` notes in the time of ``normal``: the largest power of two below it (3:2, 5:4, 6:4), or 2:3."""
    if actual == 2:
        return 2, 3
    normal = 1
    while normal * 2 < actual:
        normal *= 2
    return actual, normal


def strip(extras: dict[str, Any], keys: set[str]) -> dict[str, Any]:
    return {key: value for key, value in extras.items() if key not in keys}


def bar_fields(raw: dict[str, Any]) -> dict[str, Any]:
    """Repeat and section fields for :class:`Bar` from a Songsterr measure."""
    fields: dict[str, Any] = {}
    if raw.get("repeatStart"):
        fields["repeat_start"] = True
    count = raw.get("repeat", raw.get("repeatEnd"))
    if isinstance(count, bool):
        count = 2 if count else 0
    if isinstance(count, int) and count > 0:
        fields["repeat_end"] = min(count, 32)
    alternate = raw.get("alternateEnding")
    if isinstance(alternate, int) and not isinstance(alternate, bool):
        alternate = [alternate]
    if isinstance(alternate, list):
        fields["alternate_endings"] = [int(item) for item in alternate if isinstance(item, int)]
    marker = raw.get("marker")
    if isinstance(marker, dict) and marker.get("text"):
        fields["section"] = str(marker["text"])
    elif isinstance(marker, str) and marker:
        fields["section"] = marker
    return fields
