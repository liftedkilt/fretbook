"""Song rows. Every query is scoped by ``owner_id``."""

from __future__ import annotations

import json
import re
import sqlite3
import uuid
from typing import Any

from fretbook.config import Settings
from fretbook.db.connection import connect
from fretbook.db.migrate import utcnow
from fretbook.score.instruments import get_preset
from fretbook.score.model import (
    Beat,
    Measure,
    ScoreDocument,
    TempoMark,
    Track,
    Voice,
    preferred_track,
    summary_fields,
)


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:60] or "song"


class SongRepository:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _conn(self) -> sqlite3.Connection:
        return connect(self.settings.database_path)

    def ensure_user(self, user_id: str, display_name: str, external_subject: str | None = None) -> None:
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO users (id, external_subject, display_name, created_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO NOTHING
                """,
                (user_id, external_subject, display_name, utcnow()),
            )

    def list_songs(self, owner_id: str) -> list[dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                """
                SELECT s.*,
                       EXISTS(
                           SELECT 1 FROM media m
                           WHERE m.song_id = s.id AND m.kind = 'audio'
                       ) AS has_audio
                FROM songs s
                WHERE s.owner_id = ?
                ORDER BY s.updated_at DESC
                """,
                (owner_id,),
            ).fetchall()
        return [_summary(row) for row in rows]

    def get_song(self, owner_id: str, song_id: str) -> dict[str, Any] | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM songs WHERE owner_id = ? AND id = ?",
                (owner_id, song_id),
            ).fetchone()
            if row is None:
                return None
            audio = conn.execute(
                "SELECT id FROM media WHERE song_id = ? AND kind = 'audio' ORDER BY created_at DESC LIMIT 1",
                (song_id,),
            ).fetchone()
        return _detail(row, has_audio=audio is not None)

    def find_by_source(self, owner_id: str, source_kind: str, **ref: Any) -> dict[str, Any] | None:
        clauses = ["owner_id = ?", "source_kind = ?"]
        values: list[Any] = [owner_id, source_kind]
        for key, value in ref.items():
            if not re.fullmatch(r"[A-Za-z0-9_]+", key):
                raise ValueError(f"bad source ref key: {key}")
            clauses.append(f"json_extract(source_ref, '$.{key}') = ?")
            values.append(value)
        with self._conn() as conn:
            row = conn.execute(
                f"SELECT * FROM songs WHERE {' AND '.join(clauses)} LIMIT 1",
                values,
            ).fetchone()
        if row is None:
            return None
        return _detail(row, has_audio=False)

    def create_song(
        self,
        owner_id: str,
        *,
        title: str,
        artist: str,
        document: ScoreDocument,
        source_kind: str,
        source_ref: dict[str, Any] | None = None,
        slug: str | None = None,
    ) -> dict[str, Any]:
        song_id = uuid.uuid4().hex
        now = utcnow()
        base = _slugify(slug or title)
        fields = summary_fields(document)
        with self._conn() as conn:
            unique = _unique_slug(conn, owner_id, base)
            conn.execute(
                """
                INSERT INTO songs (
                    id, owner_id, slug, title, artist, source_kind, source_ref,
                    bpm, measure_count, track_count, string_count, preferred_instrument,
                    has_sync, duration, document, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    song_id,
                    owner_id,
                    unique,
                    title,
                    artist,
                    source_kind,
                    json.dumps(source_ref or {}, ensure_ascii=False),
                    fields["bpm"],
                    fields["measure_count"],
                    fields["track_count"],
                    fields["string_count"],
                    fields["preferred_instrument"],
                    int(fields["has_sync"]),
                    fields["duration"],
                    document.model_dump_json(),
                    now,
                    now,
                ),
            )
        song = self.get_song(owner_id, song_id)
        assert song is not None
        return song

    def create_blank(
        self,
        owner_id: str,
        *,
        title: str,
        artist: str,
        preset_id: str,
        bpm: float,
        measures: int,
        signature: tuple[int, int],
    ) -> dict[str, Any]:
        preset = get_preset(preset_id)
        document = ScoreDocument(
            bpm=bpm,
            tempos=[TempoMark(bpm=bpm, measure=0)],
            tracks=[
                Track(
                    id="trk_" + uuid.uuid4().hex[:8],
                    name=preset.name,
                    instrument=preset.instrument,
                    tuning_midi=list(preset.tuning_midi),
                    preferred=True,
                    measures=[
                        Measure(
                            signature=signature,
                            voices=[
                                Voice(
                                    beats=[
                                        Beat(position=float(index), duration=1.0, rest=True)
                                        for index in range(signature[0])
                                    ]
                                    if signature[1] == 4
                                    else []
                                )
                            ],
                        )
                        for _ in range(measures)
                    ],
                )
            ],
        )
        if signature[1] != 4:
            step = 4 / signature[1]
            for measure in document.tracks[0].measures:
                measure.voices[0].beats = [
                    Beat(position=round(index * step, 4), duration=round(step, 4), rest=True)
                    for index in range(signature[0])
                ]
        return self.create_song(
            owner_id,
            title=title or "Untitled",
            artist=artist,
            document=document,
            source_kind="manual",
            source_ref={"preset": preset.id},
        )

    def update_song(
        self,
        owner_id: str,
        song_id: str,
        *,
        title: str,
        artist: str,
        document: ScoreDocument,
    ) -> dict[str, Any] | None:
        fields = summary_fields(document)
        with self._conn() as conn:
            cursor = conn.execute(
                """
                UPDATE songs SET
                    title = ?, artist = ?, bpm = ?, measure_count = ?, track_count = ?,
                    string_count = ?, preferred_instrument = ?, has_sync = ?, duration = ?,
                    document = ?, updated_at = ?
                WHERE owner_id = ? AND id = ?
                """,
                (
                    title,
                    artist,
                    fields["bpm"],
                    fields["measure_count"],
                    fields["track_count"],
                    fields["string_count"],
                    fields["preferred_instrument"],
                    int(fields["has_sync"]),
                    fields["duration"],
                    document.model_dump_json(),
                    utcnow(),
                    owner_id,
                    song_id,
                ),
            )
            if cursor.rowcount == 0:
                return None
        return self.get_song(owner_id, song_id)

    def update_sync(
        self,
        owner_id: str,
        song_id: str,
        *,
        bpm: float,
        anchors: dict[str, float],
    ) -> dict[str, Any] | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT document FROM songs WHERE owner_id = ? AND id = ?",
                (owner_id, song_id),
            ).fetchone()
            if row is None:
                return None
            document = ScoreDocument.model_validate_json(row["document"])
            document.bpm = bpm
            document.sync.anchors = {str(key): float(value) for key, value in anchors.items()}
            if document.tempos:
                document.tempos[0].bpm = bpm
            fields = summary_fields(document)
            conn.execute(
                """
                UPDATE songs SET bpm = ?, has_sync = ?, duration = ?, document = ?, updated_at = ?
                WHERE owner_id = ? AND id = ?
                """,
                (
                    fields["bpm"],
                    int(fields["has_sync"]),
                    fields["duration"],
                    document.model_dump_json(),
                    utcnow(),
                    owner_id,
                    song_id,
                ),
            )
        return self.get_song(owner_id, song_id)

    def delete_song(self, owner_id: str, song_id: str) -> bool:
        with self._conn() as conn:
            cursor = conn.execute(
                "DELETE FROM songs WHERE owner_id = ? AND id = ?",
                (owner_id, song_id),
            )
            return cursor.rowcount > 0


def _unique_slug(conn: sqlite3.Connection, owner_id: str, base: str) -> str:
    candidate = base
    suffix = 2
    while conn.execute(
        "SELECT 1 FROM songs WHERE owner_id = ? AND slug = ?",
        (owner_id, candidate),
    ).fetchone():
        candidate = f"{base}-{suffix}"
        suffix += 1
    return candidate


def _summary(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "slug": row["slug"],
        "title": row["title"],
        "artist": row["artist"],
        "source_kind": row["source_kind"],
        "bpm": row["bpm"],
        "measure_count": row["measure_count"],
        "track_count": row["track_count"],
        "string_count": row["string_count"],
        "preferred_instrument": row["preferred_instrument"],
        "has_sync": bool(row["has_sync"]),
        "has_audio": bool(row["has_audio"]) if "has_audio" in row.keys() else False,
        "duration": row["duration"],
        "updated_at": row["updated_at"],
    }


def _detail(row: sqlite3.Row, *, has_audio: bool) -> dict[str, Any]:
    document = json.loads(row["document"])
    payload = _summary(row)
    payload["has_audio"] = has_audio
    payload["source_ref"] = json.loads(row["source_ref"] or "{}")
    payload["document"] = document
    payload["created_at"] = row["created_at"]
    payload["audio_url"] = f"api/songs/{row['id']}/audio" if has_audio else None
    track = preferred_track(ScoreDocument.model_validate(document))
    payload["preferred_track_id"] = track.id
    return payload
