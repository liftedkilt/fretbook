"""Song and user rows. Every song query is scoped by ``owner_id``."""

from __future__ import annotations

import json
import re
import sqlite3
import uuid
from typing import Any

from fretbook.config import Settings
from fretbook.db.connection import session
from fretbook.db.migrate import utcnow
from fretbook.score.instruments import DEFAULT_PRESET, get_preset, is_preset
from fretbook.score.model import (
    Bar,
    Beat,
    ScoreDocument,
    Track,
    TrackBar,
    Voice,
    summary_fields,
)

_EMPTY_SUMMARY: dict[str, Any] = {
    "bpm": 0,
    "measure_count": 0,
    "track_count": 0,
    "string_count": 0,
    "preferred_instrument": "",
    "preferred_track_id": "",
    "has_sync": False,
    "duration": None,
}


# ORDER BY fragments per sort key. Missing values (no artist, never opened) sort last either way.
_SORTS: dict[str, tuple[str, str]] = {
    "title": ("s.title COLLATE NOCASE {dir}", "asc"),
    "artist": ("(s.artist = '') ASC, s.artist COLLATE NOCASE {dir}, s.title COLLATE NOCASE ASC", "asc"),
    "added": ("s.created_at {dir}", "desc"),
    "updated": ("s.updated_at {dir}", "desc"),
    "opened": ("(s.last_opened_at IS NULL) ASC, s.last_opened_at {dir}", "desc"),
}

# Library filters. These mirror ``instrumentFamily`` in web/src/lib/instruments.ts.
_BASS = "lower(s.preferred_instrument) LIKE '%bass%'"
_ACOUSTIC = f"lower(s.preferred_instrument) LIKE '%acoustic%' AND NOT ({_BASS})"
_FILTERS: dict[str, str] = {
    "bass": f"(s.content_kind = 'tab' AND {_BASS})",
    "acoustic": f"(s.content_kind = 'tab' AND {_ACOUSTIC})",
    "electric": (
        f"(s.content_kind = 'tab' AND lower(s.preferred_instrument) LIKE '%guitar%' "
        f"AND NOT ({_BASS}) AND lower(s.preferred_instrument) NOT LIKE '%acoustic%')"
    ),
    "chords": "s.content_kind = 'chords'",
}

_SUMMARY_COLUMNS = (
    "s.id, s.slug, s.title, s.artist, s.content_kind, s.source_kind, s.revision, s.bpm, s.measure_count, "
    "s.track_count, s.string_count, s.preferred_instrument, s.has_sync, s.duration, s.updated_at"
)


def _fts_query(text: str) -> str:
    """Turn user text into an FTS5 query: every word is a quoted prefix, all of them required."""
    words = re.findall(r"\w+", text)
    return " ".join(f'"{word}"*' for word in words)


class RevisionConflict(Exception):
    """The song changed since the caller loaded it."""

    def __init__(self, current: int) -> None:
        super().__init__(f"song is at revision {current}")
        self.current = current


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:60] or "song"


def _content_fields(document: ScoreDocument | None, chordpro: str | None) -> dict[str, Any]:
    if document is not None:
        return {
            **summary_fields(document),
            "content_kind": "tab",
            "document": document.model_dump_json(),
            "chordpro": None,
        }
    if chordpro is None:
        raise ValueError("a song needs a score document or ChordPro text")
    return {**_EMPTY_SUMMARY, "content_kind": "chords", "document": None, "chordpro": chordpro}


class SongRepository:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _session(self, *, immediate: bool = False):
        return session(self.settings.database_path, immediate=immediate)

    # --- users -------------------------------------------------------------

    def ensure_user(self, user_id: str, display_name: str, external_subject: str | None = None) -> None:
        with self._session() as conn:
            conn.execute(
                """
                INSERT INTO users (id, external_subject, display_name, created_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO NOTHING
                """,
                (user_id, external_subject, display_name, utcnow()),
            )

    def get_settings(self, user_id: str) -> dict[str, Any]:
        with self._session() as conn:
            row = conn.execute("SELECT default_instrument FROM users WHERE id = ?", (user_id,)).fetchone()
        instrument = row["default_instrument"] if row else DEFAULT_PRESET
        if not is_preset(instrument):
            instrument = DEFAULT_PRESET
        return {"default_instrument": instrument}

    def update_settings(self, user_id: str, *, default_instrument: str) -> dict[str, Any]:
        get_preset(default_instrument)
        with self._session() as conn:
            conn.execute("UPDATE users SET default_instrument = ? WHERE id = ?", (default_instrument, user_id))
        return self.get_settings(user_id)

    # --- songs -------------------------------------------------------------

    def list_songs(
        self,
        owner_id: str,
        *,
        q: str = "",
        sort: str = "updated",
        order: str | None = None,
        instrument: str = "all",
        limit: int = 50,
        offset: int = 0,
    ) -> dict[str, Any]:
        """One page of the owner's songs plus the total match count and per-filter counts.

        ``q`` is matched as word prefixes against title and artist. Summaries come from
        explicit columns so the score and ChordPro text are never read.
        """
        sort_sql, default_order = _SORTS[sort]
        direction = "DESC" if (order or default_order) == "desc" else "ASC"
        where = ["s.owner_id = ?"]
        params: list[Any] = [owner_id]
        match = _fts_query(q)
        if match:
            where.append("s.id IN (SELECT song_id FROM songs_fts WHERE songs_fts MATCH ?)")
            params.append(match)
        if instrument != "all":
            where.append(_FILTERS[instrument])
        clause = " AND ".join(where)
        with self._session() as conn:
            total = conn.execute(f"SELECT count(*) FROM songs s WHERE {clause}", params).fetchone()[0]
            rows = conn.execute(
                f"""
                SELECT {_SUMMARY_COLUMNS},
                       (SELECT m.id FROM media m
                        WHERE m.song_id = s.id AND m.kind = 'audio'
                        ORDER BY m.created_at DESC LIMIT 1) AS audio_id
                FROM songs s
                WHERE {clause}
                ORDER BY {sort_sql.format(dir=direction)}, s.id
                LIMIT ? OFFSET ?
                """,
                [*params, limit, offset],
            ).fetchall()
            counts = {"all": 0, **{name: 0 for name in _FILTERS}}
            for name, sql in _FILTERS.items():
                counts[name] = conn.execute(
                    f"SELECT count(*) FROM songs s WHERE s.owner_id = ? AND {sql}", (owner_id,)
                ).fetchone()[0]
            counts["all"] = conn.execute("SELECT count(*) FROM songs WHERE owner_id = ?", (owner_id,)).fetchone()[0]
        return {"items": [_summary(row) for row in rows], "total": total, "counts": counts}

    def mark_opened(self, owner_id: str, song_id: str) -> bool:
        """Record that the song was opened. Leaves ``updated_at`` and ``revision`` alone."""
        with self._session() as conn:
            cursor = conn.execute(
                "UPDATE songs SET last_opened_at = ? WHERE owner_id = ? AND id = ?",
                (utcnow(), owner_id, song_id),
            )
            return cursor.rowcount > 0

    def get_song(self, owner_id: str, song_id: str) -> dict[str, Any] | None:
        with self._session() as conn:
            row = conn.execute(
                """
                SELECT s.*,
                       (SELECT m.id FROM media m
                        WHERE m.song_id = s.id AND m.kind = 'audio'
                        ORDER BY m.created_at DESC LIMIT 1) AS audio_id
                FROM songs s
                WHERE s.owner_id = ? AND s.id = ?
                """,
                (owner_id, song_id),
            ).fetchone()
        return _detail(row) if row else None

    def find_by_source(self, owner_id: str, source_kind: str, **ref: Any) -> dict[str, Any] | None:
        clauses = ["owner_id = ?", "source_kind = ?"]
        values: list[Any] = [owner_id, source_kind]
        for key, value in ref.items():
            if not re.fullmatch(r"[A-Za-z0-9_]+", key):
                raise ValueError(f"bad source ref key: {key}")
            clauses.append(f"json_extract(source_ref, '$.{key}') = ?")
            values.append(value)
        with self._session() as conn:
            row = conn.execute(
                f"SELECT id FROM songs WHERE {' AND '.join(clauses)} ORDER BY created_at LIMIT 1",
                values,
            ).fetchone()
        return self.get_song(owner_id, row["id"]) if row else None

    def id_taken(self, song_id: str) -> bool:
        """Song ids are global, so this looks at every owner."""
        with self._session() as conn:
            return conn.execute("SELECT 1 FROM songs WHERE id = ?", (song_id,)).fetchone() is not None

    def find_duplicate(self, owner_id: str, title: str, artist: str, source_kind: str) -> bool:
        """Whether the owner has a song with the same title, artist and source (case-insensitive)."""
        with self._session() as conn:
            return (
                conn.execute(
                    """
                    SELECT 1 FROM songs
                    WHERE owner_id = ? AND lower(title) = lower(?) AND lower(artist) = lower(?) AND source_kind = ?
                    """,
                    (owner_id, title.strip(), artist.strip(), source_kind),
                ).fetchone()
                is not None
            )

    def create_song(
        self,
        owner_id: str,
        *,
        title: str,
        artist: str,
        source_kind: str,
        source_ref: dict[str, Any] | None = None,
        slug: str | None = None,
        document: ScoreDocument | None = None,
        chordpro: str | None = None,
        song_id: str | None = None,
    ) -> dict[str, Any]:
        """Add a song. ``song_id`` keeps an id from a restored archive; it must not be :meth:`id_taken`."""
        song_id = song_id or uuid.uuid4().hex
        now = utcnow()
        base = _slugify(slug or title)
        fields = _content_fields(document, chordpro)
        for _attempt in range(5):
            try:
                with self._session(immediate=True) as conn:
                    unique = _unique_slug(conn, owner_id, base)
                    conn.execute(
                        """
                        INSERT INTO songs (
                            id, owner_id, slug, title, artist, content_kind, source_kind, source_ref,
                            bpm, measure_count, track_count, string_count, preferred_instrument,
                            preferred_track_id, has_sync, duration, document, chordpro, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            song_id,
                            owner_id,
                            unique,
                            title,
                            artist,
                            fields["content_kind"],
                            source_kind,
                            json.dumps(source_ref or {}, ensure_ascii=False),
                            fields["bpm"],
                            fields["measure_count"],
                            fields["track_count"],
                            fields["string_count"],
                            fields["preferred_instrument"],
                            fields["preferred_track_id"],
                            int(fields["has_sync"]),
                            fields["duration"],
                            fields["document"],
                            fields["chordpro"],
                            now,
                            now,
                        ),
                    )
                break
            except sqlite3.IntegrityError:
                # Another writer took the slug between the check and the insert.
                continue
        else:
            raise RuntimeError("could not find a free slug")
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
        bar = Bar(signature=signature)
        beat_ticks = bar.length_ticks // signature[0]
        document = ScoreDocument(
            bpm=bpm,
            bars=[Bar(signature=signature) for _ in range(measures)],
            tracks=[
                Track(
                    id="trk_" + uuid.uuid4().hex[:8],
                    name=preset.name,
                    instrument=preset.instrument,
                    tuning_midi=list(preset.tuning_midi),
                    preferred=True,
                    bars=[
                        TrackBar(
                            voices=[
                                Voice(
                                    beats=[
                                        Beat(position=index * beat_ticks, duration=beat_ticks)
                                        for index in range(signature[0])
                                    ]
                                )
                            ]
                        )
                        for _ in range(measures)
                    ],
                )
            ],
        )
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
        revision: int | None,
        document: ScoreDocument | None = None,
        chordpro: str | None = None,
        source_ref: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        """Replace a song's content. ``revision`` must match the stored one unless it is ``None``.

        Returns ``None`` when the song does not exist and raises
        :class:`RevisionConflict` when it changed since ``revision``.
        """
        fields = _content_fields(document, chordpro)
        assignments = [
            "title = ?",
            "artist = ?",
            "content_kind = ?",
            "bpm = ?",
            "measure_count = ?",
            "track_count = ?",
            "string_count = ?",
            "preferred_instrument = ?",
            "preferred_track_id = ?",
            "has_sync = ?",
            "duration = ?",
            "document = ?",
            "chordpro = ?",
            "updated_at = ?",
            "revision = revision + 1",
        ]
        values: list[Any] = [
            title,
            artist,
            fields["content_kind"],
            fields["bpm"],
            fields["measure_count"],
            fields["track_count"],
            fields["string_count"],
            fields["preferred_instrument"],
            fields["preferred_track_id"],
            int(fields["has_sync"]),
            fields["duration"],
            fields["document"],
            fields["chordpro"],
            utcnow(),
        ]
        if source_ref is not None:
            assignments.append("source_ref = ?")
            values.append(json.dumps(source_ref, ensure_ascii=False))
        with self._session(immediate=True) as conn:
            row = conn.execute(
                "SELECT revision FROM songs WHERE owner_id = ? AND id = ?", (owner_id, song_id)
            ).fetchone()
            if row is None:
                return None
            if revision is not None and row["revision"] != revision:
                raise RevisionConflict(row["revision"])
            conn.execute(
                f"UPDATE songs SET {', '.join(assignments)} WHERE owner_id = ? AND id = ?",
                (*values, owner_id, song_id),
            )
        return self.get_song(owner_id, song_id)

    def update_sync(
        self,
        owner_id: str,
        song_id: str,
        *,
        bpm: float,
        anchors: dict[str, float],
    ) -> dict[str, Any] | None:
        """Set the opening tempo and tapped anchors in one locked read-modify-write."""
        with self._session(immediate=True) as conn:
            row = conn.execute(
                "SELECT document FROM songs WHERE owner_id = ? AND id = ? AND content_kind = 'tab'",
                (owner_id, song_id),
            ).fetchone()
            if row is None:
                return None
            document = ScoreDocument.model_validate_json(row["document"])
            document.bpm = bpm
            document.sync.anchors = {str(key): float(value) for key, value in anchors.items()}
            document = ScoreDocument.model_validate(document.model_dump())
            fields = summary_fields(document)
            conn.execute(
                """
                UPDATE songs SET bpm = ?, has_sync = ?, duration = ?, document = ?, updated_at = ?,
                                 revision = revision + 1
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
        with self._session() as conn:
            cursor = conn.execute("DELETE FROM songs WHERE owner_id = ? AND id = ?", (owner_id, song_id))
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


def _audio_url(row: sqlite3.Row) -> str | None:
    audio_id = row["audio_id"]
    # The media id in the query string changes when the audio is replaced, so the <audio> element reloads.
    return f"api/songs/{row['id']}/audio?v={audio_id}" if audio_id else None


def _summary(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "slug": row["slug"],
        "title": row["title"],
        "artist": row["artist"],
        "content_kind": row["content_kind"],
        "source_kind": row["source_kind"],
        "revision": row["revision"],
        "bpm": row["bpm"],
        "measure_count": row["measure_count"],
        "track_count": row["track_count"],
        "string_count": row["string_count"],
        "preferred_instrument": row["preferred_instrument"],
        "has_sync": bool(row["has_sync"]),
        "has_audio": row["audio_id"] is not None,
        "duration": row["duration"],
        "updated_at": row["updated_at"],
    }


def _detail(row: sqlite3.Row) -> dict[str, Any]:
    payload = _summary(row)
    payload["source_ref"] = json.loads(row["source_ref"] or "{}")
    payload["document"] = json.loads(row["document"]) if row["document"] else None
    payload["chordpro"] = row["chordpro"]
    payload["created_at"] = row["created_at"]
    payload["audio_url"] = _audio_url(row)
    payload["preferred_track_id"] = row["preferred_track_id"]
    return payload
