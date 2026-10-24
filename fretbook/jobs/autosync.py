"""The ``audio.autosync`` job: estimate a tab's sync anchors from its audio. It only proposes; accepting saves them."""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from fretbook.audio.beats import AudioDecodeError, decode
from fretbook.jobs.runner import JobRunner, Progress
from fretbook.score.autosync import propose
from fretbook.score.model import ScoreDocument
from fretbook.storage.media import MediaStore
from fretbook.storage.repository import SongRepository

KIND = "audio.autosync"


def register_autosync(runner: JobRunner, songs: SongRepository, media: MediaStore) -> None:
    def autosync(job: dict[str, Any], progress: Progress) -> dict[str, Any]:
        owner_id = job["owner_id"]
        song_id = str(job["payload"]["song_id"])
        song = songs.get_song(owner_id, song_id)
        if song is None:
            raise AudioDecodeError("song not found", "song.notFound")
        if song["content_kind"] != "tab" or song["document"] is None:
            raise AudioDecodeError("only tabs have sync marks", "sync.notTab")
        row = media.audio_for(owner_id, song_id)
        path = media.path_for(row) if row else None
        if path is None or not path.is_file():
            raise AudioDecodeError("this song has no audio", "audio.none")
        document = ScoreDocument.model_validate(song["document"])
        progress("Reading the audio", "autoSync.decoding")
        samples = decode(path)
        progress("Finding the beats and matching them to the bars", "autoSync.tracking")
        proposal = propose(document, samples)
        return {"song_id": song_id, "autosync": asdict(proposal)}

    runner.register(KIND, autosync)
