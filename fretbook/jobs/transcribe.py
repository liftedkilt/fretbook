"""The ``audio.transcribe`` job: polyphonic audio-to-MIDI-to-tab transcription.

It is worker-only: the basic-pitch model runs on the worker, optionally with Demucs stem isolation.
Results are saved as a draft track on the song, with sync anchors set from the beat grid.
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

from fretbook.audio import transcription as engine
from fretbook.audio.transcription import TranscriptionError
from fretbook.jobs.runner import JobRunner, Progress
from fretbook.score.model import Bar, ScoreDocument, TrackBar
from fretbook.storage.media import AUDIO_TYPES, MediaStore
from fretbook.storage.repository import SongRepository

KIND = "audio.transcribe"


def _is_blank_audio_doc(doc: ScoreDocument, source_kind: str) -> bool:
    """Whether the document is a placeholder created by an audio-only import."""
    if source_kind == "audio":
        return True
    if len(doc.bars) <= 4 and len(doc.tracks) == 1:
        track = doc.tracks[0]
        all_empty = all(all(not beat.notes for beat in voice.beats) for bar in track.bars for voice in bar.voices)
        if all_empty:
            return True
    return False


def register_transcribe(
    runner: JobRunner,
    songs: SongRepository,
    media: MediaStore,
    transcriber: engine.Transcriber = engine.transcribe,
) -> None:
    def transcribe_job(job: dict[str, Any], progress: Progress) -> dict[str, Any]:
        owner_id = job["owner_id"]
        payload = job.get("payload") or {}
        stem = str(payload.get("stem") or "mix")
        preset = payload.get("preset")
        grid = int(payload.get("grid") or 16)
        song_id = payload.get("song_id")
        file_path_str = payload.get("file_path")

        if song_id:
            song = songs.get_song(owner_id, str(song_id))
            if song is None:
                raise TranscriptionError("song not found", "song.notFound")
            row = media.audio_for(owner_id, str(song_id))
            audio_path = media.path_for(row) if row else None
            if audio_path is None or not audio_path.is_file():
                raise TranscriptionError("this song has no audio", "audio.none")

            document, notices = transcriber(audio_path, stem, preset, grid, progress)
            stored_doc = ScoreDocument.model_validate(song["document"]) if song.get("document") else None

            if stored_doc is None or _is_blank_audio_doc(stored_doc, song.get("source_kind", "")):
                final_doc = document
                track_id = document.tracks[0].id if document.tracks else "trk_transcribed"
            else:
                new_track = document.tracks[0]
                new_track.id = f"trk_transcribed_{uuid.uuid4().hex[:8]}"
                new_track.preferred = False
                track_id = new_track.id

                bar_diff = len(document.bars) - len(stored_doc.bars)
                if bar_diff > 0:
                    for _ in range(bar_diff):
                        stored_doc.bars.append(Bar(signature=(4, 4)))
                        for trk in stored_doc.tracks:
                            trk.bars.append(TrackBar())
                elif bar_diff < 0:
                    for _ in range(-bar_diff):
                        new_track.bars.append(TrackBar())

                stored_doc.tracks.append(new_track)
                if not stored_doc.sync.anchors:
                    stored_doc.sync.anchors = document.sync.anchors
                    stored_doc.sync.keyed_by = "played"
                final_doc = stored_doc

            source_ref = dict(song.get("source_ref") or {})
            source_ref["needs_review"] = True
            source_ref["transcribed"] = True
            songs.update_song(
                owner_id,
                str(song_id),
                title=song["title"],
                artist=song["artist"],
                revision=song["revision"],
                document=final_doc,
                source_ref=source_ref,
            )
            return {
                "song_id": str(song_id),
                "track_id": track_id,
                "bars": len(final_doc.bars),
                "bpm": final_doc.bpm,
                "anchors": len(final_doc.sync.anchors),
                "warnings": [n.as_dict() for n in notices],
            }

        elif file_path_str:
            file_path = Path(file_path_str)
            if not file_path.is_file():
                raise TranscriptionError("uploaded audio file not found", "upload.notFound")
            filename = payload.get("filename") or file_path.name
            title = payload.get("title") or Path(filename).stem.replace("-", " ").title() or "Transcribed Audio"
            artist = payload.get("artist") or ""

            try:
                document, notices = transcriber(file_path, stem, preset, grid, progress)
                source_ref = {
                    "filename": filename,
                    "needs_review": True,
                    "transcribed": True,
                    "stem": stem,
                    "preset": preset,
                }
                created = songs.create_song(
                    owner_id,
                    title=title,
                    artist=artist,
                    source_kind="transcription",
                    source_ref=source_ref,
                    document=document,
                )
                suffix = file_path.suffix.lower()
                content_type = AUDIO_TYPES.get(suffix, "audio/mpeg")
                media.save_file(
                    owner_id,
                    created["id"],
                    kind="audio",
                    filename=filename,
                    content_type=content_type,
                    source=file_path,
                    replace_kind=True,
                )
                track_id = document.tracks[0].id if document.tracks else "trk_transcribed"
                return {
                    "song_id": created["id"],
                    "track_id": track_id,
                    "bars": len(document.bars),
                    "bpm": document.bpm,
                    "anchors": len(document.sync.anchors),
                    "warnings": [n.as_dict() for n in notices],
                }
            finally:
                file_path.unlink(missing_ok=True)

        else:
            raise TranscriptionError("transcription needs a song_id or a file", "transcribe.invalidPayload")

    runner.register(KIND, transcribe_job, worker_only=True)
