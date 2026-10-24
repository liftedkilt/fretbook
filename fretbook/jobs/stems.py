"""The ``audio.stems`` job: split a song's audio into stems (bass, guitar, drums, ...) with Demucs.

It is worker-only: the model needs a GPU to be quick, and a CPU takes minutes per song. The stems are stored as
media of kind ``stem-<name>``, beside the song's audio.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from fretbook.audio import stems as engine
from fretbook.audio.stems import DEFAULT_MODEL, StemsError
from fretbook.jobs.runner import JobRunner, Progress
from fretbook.storage.media import AUDIO_TYPES, MediaStore
from fretbook.storage.repository import SongRepository

KIND = "audio.stems"


def register_stems(
    runner: JobRunner, songs: SongRepository, media: MediaStore, separator: engine.Separator = engine.separate
) -> None:
    def stems(job: dict[str, Any], progress: Progress) -> dict[str, Any]:
        owner_id = job["owner_id"]
        song_id = str(job["payload"]["song_id"])
        model = str(job["payload"].get("model") or DEFAULT_MODEL)
        if songs.get_song(owner_id, song_id) is None:
            raise StemsError("song not found", "song.notFound")
        row = media.audio_for(owner_id, song_id)
        path = media.path_for(row) if row else None
        if path is None or not path.is_file():
            raise StemsError("this song has no audio", "audio.none")
        work = engine.scratch_dir()
        try:
            found = separator(path, model, work, progress)
            progress("Saving the stems", "stems.saving")
            saved: list[str] = []
            for name, file in found.items():
                if name not in engine.STEM_NAMES:
                    continue
                suffix = file.suffix.lower()
                media.save_file(
                    owner_id,
                    song_id,
                    kind=f"stem-{name}",
                    filename=f"{name}{suffix}",
                    content_type=AUDIO_TYPES.get(suffix, "audio/mpeg"),
                    source=Path(file),
                    replace_kind=True,
                )
                saved.append(name)
        finally:
            shutil.rmtree(work, ignore_errors=True)
        return {"song_id": song_id, "model": model, "stems": saved}

    runner.register(KIND, stems, worker_only=True)
