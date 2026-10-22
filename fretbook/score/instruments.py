"""Instrument presets.

The create-tab form, the editor's add-track menu, and each user's default
instrument setting list whatever this module returns. The score model accepts
any string count, so a new preset needs no schema change.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class InstrumentPreset:
    id: str
    label_key: str
    label: str
    instrument: str
    name: str
    tuning_midi: tuple[int, ...]


PRESETS: tuple[InstrumentPreset, ...] = (
    InstrumentPreset(
        "bass-4",
        "instrument.bass4",
        "4-string bass",
        "bass-guitar",
        "Bass",
        (43, 38, 33, 28),
    ),
    InstrumentPreset(
        "bass-5",
        "instrument.bass5",
        "5-string bass",
        "bass-guitar",
        "Bass",
        (43, 38, 33, 28, 23),
    ),
    InstrumentPreset(
        "guitar-6",
        "instrument.guitar6",
        "6-string guitar",
        "guitar",
        "Guitar",
        (64, 59, 55, 50, 45, 40),
    ),
    InstrumentPreset(
        "guitar-drop-d",
        "instrument.guitarDropD",
        "6-string guitar (Drop D)",
        "guitar",
        "Guitar",
        (64, 59, 55, 50, 45, 38),
    ),
    InstrumentPreset(
        "guitar-7",
        "instrument.guitar7",
        "7-string guitar",
        "guitar",
        "Guitar",
        (64, 59, 55, 50, 45, 40, 35),
    ),
    InstrumentPreset(
        "guitar-acoustic",
        "instrument.guitarAcoustic",
        "Acoustic guitar",
        "acoustic-guitar",
        "Acoustic guitar",
        (64, 59, 55, 50, 45, 40),
    ),
)


DEFAULT_PRESET = "bass-4"


def family(instrument: str) -> str:
    """``bass`` or ``guitar``: which Songsterr parts an import prefers for this instrument."""
    return "bass" if "bass" in instrument.lower() else "guitar"


def is_preset(preset_id: str) -> bool:
    return any(preset.id == preset_id for preset in PRESETS)


def get_preset(preset_id: str) -> InstrumentPreset:
    for preset in PRESETS:
        if preset.id == preset_id:
            return preset
    known = ", ".join(preset.id for preset in PRESETS)
    raise KeyError(f"unknown instrument preset {preset_id!r}; known: {known}")


def presets_payload() -> list[dict[str, object]]:
    return [
        {
            "id": preset.id,
            "label_key": preset.label_key,
            "label": preset.label,
            "instrument": preset.instrument,
            "name": preset.name,
            "tuning_midi": list(preset.tuning_midi),
            "string_count": len(preset.tuning_midi),
            "family": family(preset.instrument),
        }
        for preset in PRESETS
    ]
