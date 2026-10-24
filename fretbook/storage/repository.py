"""Song and user rows.

``owner_id`` on a song is a library id. Listing stays inside one library. Reading one song, and
changing it, also allow a band member (see ``fretbook.storage.access``). A personal library id
is the user's id, so a caller passing their own id still sees only their songs unless they are
a member somewhere else and ask for that song by id.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import uuid
from dataclasses import asdict
from typing import Any

from fretbook.chords import chordpro as chordpro_text
from fretbook.config import Settings
from fretbook.db.connection import session
from fretbook.db.migrate import utcnow
from fretbook.score import difficulty as difficulty_estimate
from fretbook.score import key as key_detect
from fretbook.score.instruments import DEFAULT_PRESET, get_preset, is_preset
from fretbook.score.model import (
    Bar,
    Beat,
    ScoreDocument,
    Track,
    TrackBar,
    Voice,
    content_hash,
    summary_fields,
)
from fretbook.storage.access import can_read, editable_library
from fretbook.tags import MAX_TAGS_PER_SONG, clean_tags, tag_key

_EMPTY_SUMMARY: dict[str, Any] = {
    "bpm": 0,
    "measure_count": 0,
    "track_count": 0,
    "string_count": 0,
    "preferred_instrument": "",
    "preferred_track_id": "",
    "has_sync": False,
    "duration": None,
    "difficulty": None,
    "difficulty_detail": None,
    "difficulty_version": None,
}

# The text and number fields a person fills in on a song (PATCH /api/songs/{id}/metadata).
METADATA_TEXT_LIMITS = {"genre": 80, "album": 200, "notes": 20000}
YEAR_RANGE = (1000, 2999)


# ORDER BY fragments per sort key. Missing values (no artist, never opened) sort last either way.
_SORTS: dict[str, tuple[str, str]] = {
    "title": ("s.title COLLATE NOCASE {dir}", "asc"),
    "artist": ("(s.artist = '') ASC, s.artist COLLATE NOCASE {dir}, s.title COLLATE NOCASE ASC", "asc"),
    "added": ("s.created_at {dir}", "desc"),
    "updated": ("s.updated_at {dir}", "desc"),
    "opened": ("(s.last_opened_at IS NULL) ASC, s.last_opened_at {dir}", "desc"),
    "difficulty": ("(s.difficulty IS NULL) ASC, s.difficulty {dir}, s.title COLLATE NOCASE ASC", "asc"),
}

# The key the library shows: the one a person set, else the one detected.
_KEY_SQL = "COALESCE(NULLIF(s.musical_key, ''), s.detected_key)"
_COVER_COLUMN = (
    "(SELECT m.id FROM media m WHERE m.song_id = s.id AND m.kind = 'cover' "
    "ORDER BY m.created_at DESC LIMIT 1) AS cover_id"
)

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
    "s.track_count, s.string_count, s.preferred_instrument, s.has_sync, s.duration, s.updated_at, s.favourite, "
    "s.difficulty, s.musical_key, s.detected_key, s.genre, s.album, s.year"
)
# The song's tags as a JSON array, sorted, so a page of songs needs no query per song.
_TAGS_COLUMN = (
    "(SELECT json_group_array(tag) FROM "
    "(SELECT tag FROM song_tags WHERE song_id = s.id ORDER BY tag_key, tag)) AS tags_json"
)


# Around each matched word in a lyrics snippet. `_index_lyrics` strips them from the indexed words.
SNIPPET_START = "\x02"
SNIPPET_END = "\x03"


def _fts_query(text: str) -> str:
    """Turn user text into an FTS5 query: every word is a quoted prefix, all of them required."""
    words = re.findall(r"\w+", text)
    return " ".join(f'"{word}"*' for word in words)


class RevisionConflict(Exception):
    """The song changed since the caller loaded it."""

    def __init__(self, current: int) -> None:
        super().__init__(f"song is at revision {current}")
        self.current = current


def normalize_text(text: str) -> str:
    """Normalize text for duplicate comparison: lowercase and collapsed whitespace."""
    return re.sub(r"\s+", " ", text.strip().lower())


def song_content_hash(document: ScoreDocument | None, chordpro: str | None) -> str | None:
    if document is not None:
        return content_hash(document)
    if chordpro is not None:
        return hashlib.sha256(chordpro.strip().encode("utf-8")).hexdigest()
    return None


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:60] or "song"


def difficulty_fields(document: ScoreDocument) -> dict[str, Any]:
    """The stored difficulty columns for a score: the preferred track's level and every track's breakdown."""
    tracks = difficulty_estimate.estimate(document)
    return {
        "difficulty": difficulty_estimate.song_level(document, tracks),
        "difficulty_detail": json.dumps([asdict(track) for track in tracks]),
        "difficulty_version": difficulty_estimate.VERSION,
    }


def chord_difficulty_fields(chordpro: str) -> dict[str, Any]:
    """The stored difficulty columns for a chord sheet; the level is ``None`` when it has no chords."""
    tracks = difficulty_estimate.estimate_chordpro(chordpro)
    return {
        "difficulty": tracks[0].level if tracks else None,
        "difficulty_detail": json.dumps([asdict(track) for track in tracks]) if tracks else None,
        "difficulty_version": difficulty_estimate.VERSION,
    }


def key_fields(document: ScoreDocument | None, chordpro: str | None) -> dict[str, Any]:
    """The stored detected-key columns: from a score's notes, or from a chord sheet's ``{key}`` directive."""
    detected = key_detect.detect_key(document) if document is not None else key_detect.chordpro_key(chordpro or "")
    return {"detected_key": detected, "key_version": key_detect.VERSION}


def _content_fields(document: ScoreDocument | None, chordpro: str | None) -> dict[str, Any]:
    if document is not None:
        return {
            **summary_fields(document),
            **difficulty_fields(document),
            **key_fields(document, None),
            "content_kind": "tab",
            "document": document.model_dump_json(),
            "chordpro": None,
        }
    if chordpro is None:
        raise ValueError("a song needs a score document or ChordPro text")
    return {
        **_EMPTY_SUMMARY,
        **chord_difficulty_fields(chordpro),
        **key_fields(None, chordpro),
        "content_kind": "chords",
        "document": None,
        "chordpro": chordpro,
    }


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

    def reset_user_data(self, user_id: str) -> None:
        """Forget everything the user did besides their songs (the demo instance's nightly reset).

        Songs are removed by the caller. This clears practice sessions, goals and exercises, lesson progress,
        audio calibrations and setlists, and puts the default instrument back.
        """
        with self._session(immediate=True) as conn:
            for table in (
                "practice_sessions",
                "practice_goals",
                "practice_exercises",
                "lesson_progress",
                "audio_calibrations",
                "setlists",
            ):
                conn.execute(f"DELETE FROM {table} WHERE owner_id = ?", (user_id,))  # noqa: S608 - fixed names
            conn.execute("UPDATE users SET default_instrument = ? WHERE id = ?", (DEFAULT_PRESET, user_id))

    # --- audio calibration -------------------------------------------------

    def get_calibration(
        self,
        owner_id: str,
        output_device: str = "default",
        input_device: str = "default",
    ) -> dict[str, Any] | None:
        with self._session() as conn:
            row = conn.execute(
                """
                SELECT output_device, input_device, offset_ms, jitter_ms, updated_at
                FROM audio_calibrations
                WHERE owner_id = ? AND output_device = ? AND input_device = ?
                """,
                (owner_id, output_device, input_device),
            ).fetchone()
        if not row:
            return None
        return {
            "output_device": row["output_device"],
            "input_device": row["input_device"],
            "offset_ms": row["offset_ms"],
            "jitter_ms": row["jitter_ms"],
            "updated_at": row["updated_at"],
        }

    def list_calibrations(self, owner_id: str) -> list[dict[str, Any]]:
        with self._session() as conn:
            rows = conn.execute(
                """
                SELECT output_device, input_device, offset_ms, jitter_ms, updated_at
                FROM audio_calibrations
                WHERE owner_id = ?
                ORDER BY updated_at DESC
                """,
                (owner_id,),
            ).fetchall()
        return [
            {
                "output_device": row["output_device"],
                "input_device": row["input_device"],
                "offset_ms": row["offset_ms"],
                "jitter_ms": row["jitter_ms"],
                "updated_at": row["updated_at"],
            }
            for row in rows
        ]

    def save_calibration(
        self,
        owner_id: str,
        *,
        output_device: str = "default",
        input_device: str = "default",
        offset_ms: float,
        jitter_ms: float | None = None,
    ) -> dict[str, Any]:
        now = utcnow()
        cal_id = uuid.uuid4().hex
        with self._session() as conn:
            conn.execute(
                """
                INSERT INTO audio_calibrations (
                    id, owner_id, output_device, input_device, offset_ms, jitter_ms, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(owner_id, output_device, input_device) DO UPDATE SET
                    offset_ms = excluded.offset_ms,
                    jitter_ms = excluded.jitter_ms,
                    updated_at = excluded.updated_at
                """,
                (cal_id, owner_id, output_device, input_device, offset_ms, jitter_ms, now, now),
            )
        return {
            "output_device": output_device,
            "input_device": input_device,
            "offset_ms": offset_ms,
            "jitter_ms": jitter_ms,
            "updated_at": now,
        }

    def delete_calibration(
        self,
        owner_id: str,
        output_device: str = "default",
        input_device: str = "default",
    ) -> bool:
        with self._session() as conn:
            cursor = conn.execute(
                """
                DELETE FROM audio_calibrations
                WHERE owner_id = ? AND output_device = ? AND input_device = ?
                """,
                (owner_id, output_device, input_device),
            )
            return cursor.rowcount > 0

    # --- songs -------------------------------------------------------------

    def list_songs(
        self,
        owner_id: str,
        *,
        q: str = "",
        sort: str = "updated",
        order: str | None = None,
        instrument: str = "all",
        tags: list[str] | None = None,
        favourite: bool = False,
        difficulty_min: int | None = None,
        difficulty_max: int | None = None,
        key: str | None = None,
        genre: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict[str, Any]:
        """One page of the owner's songs plus the total match count and per-filter counts.

        ``q`` is matched as word prefixes against title, artist, chord-sheet lyrics and tags. ``tags`` keeps songs
        that have every one of them, and ``favourite`` only starred songs. ``difficulty_min`` and
        ``difficulty_max`` keep tabs whose level, rounded to 1..10, is in range; chord sheets have none and are
        left out. ``key`` keeps songs in that key (the one set, else the detected one) and ``genre`` songs with
        that genre, ignoring case. Summaries come from explicit columns so the score and ChordPro text are never
        read. The counts ignore the search, tags and favourites.
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
        wanted = [tag_key(tag) for tag in clean_tags(tags or [])]
        if wanted:
            marks = ", ".join("?" for _ in wanted)
            where.append(
                f"s.id IN (SELECT song_id FROM song_tags WHERE tag_key IN ({marks}) "
                "GROUP BY song_id HAVING count(*) = ?)"
            )
            params.extend([*wanted, len(wanted)])
        if favourite:
            where.append("s.favourite = 1")
        if difficulty_min is not None:
            where.append("round(s.difficulty) >= ?")
            params.append(difficulty_min)
        if difficulty_max is not None:
            where.append("round(s.difficulty) <= ?")
            params.append(difficulty_max)
        if key:
            where.append(f"{_KEY_SQL} = ?")
            params.append(key)
        if genre:
            where.append("s.genre = ? COLLATE NOCASE")
            params.append(genre)
        clause = " AND ".join(where)
        with self._session() as conn:
            total = conn.execute(f"SELECT count(*) FROM songs s WHERE {clause}", params).fetchone()[0]
            rows = conn.execute(
                f"""
                SELECT {_SUMMARY_COLUMNS}, {_TAGS_COLUMN}, {_COVER_COLUMN},
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
            counts = {"all": 0, "favourites": 0, **{name: 0 for name in _FILTERS}}
            for name, sql in _FILTERS.items():
                counts[name] = conn.execute(
                    f"SELECT count(*) FROM songs s WHERE s.owner_id = ? AND {sql}", (owner_id,)
                ).fetchone()[0]
            counts["all"] = conn.execute("SELECT count(*) FROM songs WHERE owner_id = ?", (owner_id,)).fetchone()[0]
            counts["favourites"] = conn.execute(
                "SELECT count(*) FROM songs WHERE owner_id = ? AND favourite = 1", (owner_id,)
            ).fetchone()[0]
            snippets = _lyric_snippets(conn, match, [row["id"] for row in rows]) if match else {}
        items = [_summary(row) for row in rows]
        for item in items:
            item["lyrics_snippet"] = snippets.get(item["id"])
        return {"items": items, "total": total, "counts": counts}

    def mark_opened(self, owner_id: str, song_id: str) -> bool:
        """Record that the song was opened. Leaves ``updated_at`` and ``revision`` alone."""
        with self._session() as conn:
            if not can_read(conn, owner_id, song_id):
                return False
            cursor = conn.execute(
                "UPDATE songs SET last_opened_at = ? WHERE id = ?",
                (utcnow(), song_id),
            )
            return cursor.rowcount > 0

    def get_song(self, owner_id: str, song_id: str) -> dict[str, Any] | None:
        with self._session() as conn:
            row = conn.execute(
                f"""
                SELECT s.*, {_TAGS_COLUMN}, {_COVER_COLUMN},
                       (SELECT m.id FROM media m
                        WHERE m.song_id = s.id AND m.kind = 'audio'
                        ORDER BY m.created_at DESC LIMIT 1) AS audio_id,
                       CASE
                         WHEN s.owner_id = ? THEN 'edit'
                         ELSE (
                           SELECT m.role FROM library_members m
                           WHERE m.library_id = s.owner_id AND m.user_id = ?
                         )
                       END AS library_role
                FROM songs s
                WHERE s.id = ?
                  AND (
                    s.owner_id = ?
                    OR EXISTS (
                      SELECT 1 FROM library_members m
                      WHERE m.library_id = s.owner_id AND m.user_id = ?
                    )
                  )
                """,
                (owner_id, owner_id, song_id, owner_id, owner_id),
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
        return self.find_duplicate_id(owner_id, title, artist, source_kind) is not None

    def find_duplicate_id(self, owner_id: str, title: str, artist: str, source_kind: str) -> str | None:
        """The id of the owner's song with the same title, artist and source (case-insensitive), if any."""
        with self._session() as conn:
            row = conn.execute(
                """
                SELECT id FROM songs
                WHERE owner_id = ? AND lower(title) = lower(?) AND lower(artist) = lower(?) AND source_kind = ?
                ORDER BY created_at, id LIMIT 1
                """,
                (owner_id, title.strip(), artist.strip(), source_kind),
            ).fetchone()
        return row["id"] if row else None

    def find_existing_duplicate(
        self,
        owner_id: str,
        *,
        content_hash: str | None = None,
        title: str = "",
        artist: str = "",
    ) -> dict[str, Any] | None:
        """Find an existing song matching content_hash, or normalized title and artist."""
        with self._session() as conn:
            if content_hash:
                row = conn.execute(
                    """
                    SELECT id FROM songs
                    WHERE owner_id = ? AND json_extract(source_ref, '$.content_hash') = ?
                    ORDER BY created_at LIMIT 1
                    """,
                    (owner_id, content_hash),
                ).fetchone()
                if row:
                    return self.get_song(owner_id, row["id"])

            norm_title = normalize_text(title)
            norm_artist = normalize_text(artist)
            if norm_title and norm_title != "untitled":
                rows = conn.execute(
                    """
                    SELECT id, title, artist FROM songs
                    WHERE owner_id = ?
                    ORDER BY created_at
                    """,
                    (owner_id,),
                ).fetchall()
                for row in rows:
                    if normalize_text(row["title"]) == norm_title and normalize_text(row["artist"]) == norm_artist:
                        return self.get_song(owner_id, row["id"])
        return None

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
                            preferred_track_id, has_sync, duration, document, chordpro, created_at, updated_at,
                            difficulty, difficulty_detail, difficulty_version, detected_key, key_version
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                            fields["difficulty"],
                            fields["difficulty_detail"],
                            fields["difficulty_version"],
                            fields["detected_key"],
                            fields["key_version"],
                        ),
                    )
                    _index_lyrics(conn, song_id, fields["chordpro"])
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
            "difficulty = ?",
            "difficulty_detail = ?",
            "difficulty_version = ?",
            "detected_key = ?",
            "key_version = ?",
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
            fields["difficulty"],
            fields["difficulty_detail"],
            fields["difficulty_version"],
            fields["detected_key"],
            fields["key_version"],
        ]
        if source_ref is not None:
            assignments.append("source_ref = ?")
            values.append(json.dumps(source_ref, ensure_ascii=False))
        with self._session(immediate=True) as conn:
            library_id = editable_library(conn, owner_id, song_id)
            if library_id is None:
                return None
            row = conn.execute(
                "SELECT revision FROM songs WHERE owner_id = ? AND id = ?", (library_id, song_id)
            ).fetchone()
            if row is None:
                return None
            if revision is not None and row["revision"] != revision:
                raise RevisionConflict(row["revision"])
            conn.execute(
                f"UPDATE songs SET {', '.join(assignments)} WHERE owner_id = ? AND id = ?",
                (*values, library_id, song_id),
            )
            _index_lyrics(conn, song_id, fields["chordpro"])
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
            library_id = editable_library(conn, owner_id, song_id)
            if library_id is None:
                return None
            row = conn.execute(
                "SELECT document FROM songs WHERE owner_id = ? AND id = ? AND content_kind = 'tab'",
                (library_id, song_id),
            ).fetchone()
            if row is None:
                return None
            document = ScoreDocument.model_validate_json(row["document"])
            document.bpm = bpm
            document.sync.anchors = {str(key): float(value) for key, value in anchors.items()}
            document = ScoreDocument.model_validate(document.model_dump())
            fields = {**summary_fields(document), **difficulty_fields(document)}
            conn.execute(
                """
                UPDATE songs SET bpm = ?, has_sync = ?, duration = ?, document = ?, updated_at = ?,
                                 difficulty = ?, difficulty_detail = ?, difficulty_version = ?,
                                 revision = revision + 1
                WHERE owner_id = ? AND id = ?
                """,
                (
                    fields["bpm"],
                    int(fields["has_sync"]),
                    fields["duration"],
                    document.model_dump_json(),
                    utcnow(),
                    fields["difficulty"],
                    fields["difficulty_detail"],
                    fields["difficulty_version"],
                    library_id,
                    song_id,
                ),
            )
        return self.get_song(owner_id, song_id)

    def refresh_difficulty(self) -> int:
        """Estimate the difficulty of every song that has none, or one from an older estimate. Returns the count.

        Songs saved before the estimate existed, and every song after its algorithm changes, are filled in here at
        start-up. Rows are updated without touching ``updated_at`` or ``revision``: the score did not change.
        """
        done = 0
        while True:
            with self._session() as conn:
                rows = conn.execute(
                    """
                    SELECT id, document, chordpro FROM songs
                    WHERE (difficulty_version IS NULL OR difficulty_version != ?)
                    LIMIT 100
                    """,
                    (difficulty_estimate.VERSION,),
                ).fetchall()
            if not rows:
                return done
            with self._session(immediate=True) as conn:
                for row in rows:
                    try:
                        fields = (
                            difficulty_fields(ScoreDocument.model_validate_json(row["document"]))
                            if row["document"] is not None
                            else chord_difficulty_fields(row["chordpro"] or "")
                        )
                    except ValueError:
                        # A score that no longer validates keeps no level; the version stops it being retried.
                        fields = {"difficulty": None, "difficulty_detail": None}
                        fields["difficulty_version"] = difficulty_estimate.VERSION
                    conn.execute(
                        "UPDATE songs SET difficulty = ?, difficulty_detail = ?, difficulty_version = ? WHERE id = ?",
                        (fields["difficulty"], fields["difficulty_detail"], fields["difficulty_version"], row["id"]),
                    )
            done += len(rows)

    def refresh_lyrics(self) -> int:
        """Index the lyrics of every chord sheet that is not in the search index yet. Returns the count.

        Sheets saved before lyrics were searchable are filled in here at start-up, without touching
        ``updated_at`` or ``revision``.
        """
        done = 0
        while True:
            with self._session() as conn:
                rows = conn.execute("SELECT id, chordpro FROM songs WHERE lyrics_indexed = 0 LIMIT 100").fetchall()
            if not rows:
                return done
            with self._session(immediate=True) as conn:
                for row in rows:
                    _index_lyrics(conn, row["id"], row["chordpro"])
            done += len(rows)

    def refresh_keys(self) -> int:
        """Detect the key of every song that has not been looked at, or was by an older detection. Returns the count.

        Like :meth:`refresh_difficulty`, rows are updated without touching ``updated_at`` or ``revision``.
        """
        done = 0
        while True:
            with self._session() as conn:
                rows = conn.execute(
                    "SELECT id, document, chordpro FROM songs WHERE key_version IS NULL OR key_version != ? LIMIT 100",
                    (key_detect.VERSION,),
                ).fetchall()
            if not rows:
                return done
            with self._session(immediate=True) as conn:
                for row in rows:
                    try:
                        document = ScoreDocument.model_validate_json(row["document"]) if row["document"] else None
                        fields = key_fields(document, row["chordpro"])
                    except ValueError:
                        fields = {"detected_key": None, "key_version": key_detect.VERSION}
                    conn.execute(
                        "UPDATE songs SET detected_key = ?, key_version = ? WHERE id = ?",
                        (fields["detected_key"], fields["key_version"], row["id"]),
                    )
            done += len(rows)

    # --- metadata ------------------------------------------------------------

    def set_metadata(self, owner_id: str, song_id: str, changes: dict[str, Any]) -> bool:
        """Set the given metadata fields (``key``, ``genre``, ``album``, ``year``, ``notes``); others stay as they are.

        Values must already be valid (see ``metadata_routes``). Like tags, this leaves ``revision`` and
        ``updated_at`` alone, so it never conflicts with the editor. Returns whether the song is the owner's.
        """
        columns = {"key": "musical_key", "genre": "genre", "album": "album", "year": "year", "notes": "notes"}
        assignments = [f"{columns[name]} = ?" for name in changes]
        with self._session() as conn:
            library_id = editable_library(conn, owner_id, song_id)
            if library_id is None:
                return False
            if not assignments:
                return True
            cursor = conn.execute(
                f"UPDATE songs SET {', '.join(assignments)} WHERE owner_id = ? AND id = ?",  # noqa: S608 - fixed names
                (*changes.values(), library_id, song_id),
            )
            return cursor.rowcount > 0

    def facets(self, owner_id: str) -> dict[str, list[dict[str, Any]]]:
        """The keys and genres in the owner's library with their song counts, most used first."""
        with self._session() as conn:
            keys = conn.execute(
                f"SELECT {_KEY_SQL} AS name, count(*) AS count FROM songs s "  # noqa: S608 - fixed SQL
                f"WHERE s.owner_id = ? AND {_KEY_SQL} IS NOT NULL GROUP BY name ORDER BY count DESC, name",
                (owner_id,),
            ).fetchall()
            genres = conn.execute(
                "SELECT min(genre) AS name, count(*) AS count FROM songs WHERE owner_id = ? AND genre != '' "
                "GROUP BY lower(genre) ORDER BY count DESC, lower(genre)",
                (owner_id,),
            ).fetchall()
        return {
            "keys": [{"name": row["name"], "count": row["count"]} for row in keys],
            "genres": [{"name": row["name"], "count": row["count"]} for row in genres],
        }

    # --- tags and favourites -----------------------------------------------
    # These leave ``revision`` and ``updated_at`` alone, like ``mark_opened``: an open editor can still save.

    def set_tags(self, owner_id: str, song_id: str, tags: list[str]) -> list[str] | None:
        """Replace the song's tags. Returns the stored tags, or ``None`` when the song is not the owner's."""
        wanted = clean_tags(tags)
        with self._session(immediate=True) as conn:
            if not _owns(conn, owner_id, song_id):
                return None
            conn.execute("DELETE FROM song_tags WHERE song_id = ?", (song_id,))
            _insert_tags(conn, song_id, wanted)
            return _stored_tags(conn, song_id)

    def add_tags(self, owner_id: str, song_ids: list[str], tags: list[str]) -> int:
        """Add tags to each of the owner's songs, skipping what a song has. A song stops at its tag limit.

        Returns how many songs were updated; ids that are not the owner's are ignored.
        """
        wanted = clean_tags(tags)
        updated = 0
        with self._session(immediate=True) as conn:
            for song_id in dict.fromkeys(song_ids):
                if not _owns(conn, owner_id, song_id):
                    continue
                have = {tag_key(tag) for tag in _stored_tags(conn, song_id)}
                room = MAX_TAGS_PER_SONG - len(have)
                fresh = [tag for tag in wanted if tag_key(tag) not in have][: max(room, 0)]
                _insert_tags(conn, song_id, fresh)
                updated += 1
        return updated

    def set_favourite(self, owner_id: str, song_id: str, favourite: bool) -> bool:
        """Star or unstar a song. Returns whether the caller may edit it."""
        with self._session() as conn:
            library_id = editable_library(conn, owner_id, song_id)
            if library_id is None:
                return False
            cursor = conn.execute(
                "UPDATE songs SET favourite = ? WHERE owner_id = ? AND id = ?",
                (int(favourite), library_id, song_id),
            )
            return cursor.rowcount > 0

    def list_tags(self, owner_id: str) -> list[dict[str, Any]]:
        """Every tag on the owner's songs with its song count, most used first, then A to Z."""
        with self._session() as conn:
            rows = conn.execute(
                """
                SELECT min(t.tag) AS tag, count(*) AS count
                FROM song_tags t JOIN songs s ON s.id = t.song_id
                WHERE s.owner_id = ?
                GROUP BY t.tag_key
                ORDER BY count DESC, t.tag_key
                """,
                (owner_id,),
            ).fetchall()
        return [{"tag": row["tag"], "count": row["count"]} for row in rows]

    def rename_tag(self, owner_id: str, tag: str, new_name: str) -> int | None:
        """Rename a tag on every one of the owner's songs, or merge it into ``new_name`` when that tag exists.

        ``new_name`` must already be cleaned. A song that has both ends up with one. Returns how many songs
        had ``tag``, or ``None`` when none did.
        """
        old_key, new_key = tag_key(tag), tag_key(new_name)
        with self._session(immediate=True) as conn:
            owned = "SELECT id FROM songs WHERE owner_id = ?"
            count = conn.execute(
                f"SELECT count(*) FROM song_tags WHERE tag_key = ? AND song_id IN ({owned})", (old_key, owner_id)
            ).fetchone()[0]
            if not count:
                return None
            if old_key != new_key:
                conn.execute(
                    f"DELETE FROM song_tags WHERE tag_key = ? AND song_id IN ({owned}) "
                    "AND song_id IN (SELECT song_id FROM song_tags WHERE tag_key = ?)",
                    (old_key, owner_id, new_key),
                )
                conn.execute(
                    f"UPDATE song_tags SET tag = ?, tag_key = ? WHERE tag_key = ? AND song_id IN ({owned})",
                    (new_name, new_key, old_key, owner_id),
                )
            # Songs that already had the target keep their spelling otherwise, so the tag reads one way.
            conn.execute(
                f"UPDATE song_tags SET tag = ? WHERE tag_key = ? AND song_id IN ({owned})",
                (new_name, new_key, owner_id),
            )
            return count

    def delete_tag(self, owner_id: str, tag: str) -> int:
        """Remove a tag from every one of the owner's songs. Returns how many songs had it."""
        with self._session(immediate=True) as conn:
            cursor = conn.execute(
                "DELETE FROM song_tags WHERE tag_key = ? AND song_id IN (SELECT id FROM songs WHERE owner_id = ?)",
                (tag_key(tag), owner_id),
            )
            return cursor.rowcount

    def delete_song(self, owner_id: str, song_id: str) -> bool:
        with self._session() as conn:
            library_id = editable_library(conn, owner_id, song_id)
            if library_id is None:
                return False
            cursor = conn.execute("DELETE FROM songs WHERE owner_id = ? AND id = ?", (library_id, song_id))
            return cursor.rowcount > 0


def _owns(conn: sqlite3.Connection, owner_id: str, song_id: str) -> bool:
    """Whether ``owner_id`` may change this song (their library, or edit membership of its library)."""
    return editable_library(conn, owner_id, song_id) is not None


def _index_lyrics(conn: sqlite3.Connection, song_id: str, chordpro: str | None) -> None:
    """Put a chord sheet's words in the search index (a tab has none, so its entry is emptied)."""
    conn.execute(
        "UPDATE songs_fts SET lyrics = ? WHERE song_id = ?",
        (
            chordpro_text.lyrics(chordpro).replace(SNIPPET_START, "").replace(SNIPPET_END, "") if chordpro else "",
            song_id,
        ),
    )
    conn.execute("UPDATE songs SET lyrics_indexed = 1 WHERE id = ?", (song_id,))


def _lyric_snippets(conn: sqlite3.Connection, match: str, song_ids: list[str]) -> dict[str, str]:
    """The matching lyric line of each song that the search found only through its lyrics.

    A song whose title, artist or tags match the whole search gets none, and neither does one whose lyrics hold
    none of the words. Matched words sit between ``SNIPPET_START`` and ``SNIPPET_END``; lines are joined by " / ".
    """
    if not song_ids:
        return {}
    marks = ", ".join("?" for _ in song_ids)
    rows = conn.execute(
        f"""
        SELECT song_id, snippet(songs_fts, 3, ?, ?, '…', 12) AS snippet FROM songs_fts
        WHERE songs_fts MATCH ? AND song_id IN ({marks})
          AND song_id NOT IN (SELECT song_id FROM songs_fts WHERE songs_fts MATCH ?)
        """,
        (SNIPPET_START, SNIPPET_END, match, *song_ids, f"{{title artist tags}} : ({match})"),
    ).fetchall()
    return {
        row["song_id"]: " / ".join(line.strip() for line in row["snippet"].splitlines() if line.strip())
        for row in rows
        if SNIPPET_START in row["snippet"]
    }


def _insert_tags(conn: sqlite3.Connection, song_id: str, tags: list[str]) -> None:
    conn.executemany(
        "INSERT INTO song_tags (song_id, tag, tag_key) VALUES (?, ?, ?)", [(song_id, tag, tag_key(tag)) for tag in tags]
    )


def _stored_tags(conn: sqlite3.Connection, song_id: str) -> list[str]:
    rows = conn.execute("SELECT tag FROM song_tags WHERE song_id = ? ORDER BY tag_key, tag", (song_id,))
    return [row["tag"] for row in rows]


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
        "favourite": bool(row["favourite"]),
        "difficulty": row["difficulty"],
        "tags": json.loads(row["tags_json"] or "[]"),
        "key": row["musical_key"] or row["detected_key"],
        "key_detected": not row["musical_key"] and row["detected_key"] is not None,
        "genre": row["genre"],
        "album": row["album"],
        "year": row["year"],
        "cover_url": f"api/songs/{row['id']}/cover?v={row['cover_id']}" if row["cover_id"] else None,
        "lyrics_snippet": None,
    }


def _detail(row: sqlite3.Row) -> dict[str, Any]:
    payload = _summary(row)
    payload["source_ref"] = json.loads(row["source_ref"] or "{}")
    payload["document"] = json.loads(row["document"]) if row["document"] else None
    payload["chordpro"] = row["chordpro"]
    payload["created_at"] = row["created_at"]
    payload["audio_url"] = _audio_url(row)
    payload["preferred_track_id"] = row["preferred_track_id"]
    payload["notes"] = row["notes"]
    payload["difficulty_tracks"] = json.loads(row["difficulty_detail"] or "[]")
    payload["library_id"] = row["owner_id"]
    payload["library_role"] = row["library_role"]
    return payload
