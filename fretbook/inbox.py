"""Watched inbox folder: files dropped in ``FRETBOOK_INBOX_DIR`` are imported.

For a NAS share, Syncthing or Nextcloud. The folder is polled every ``FRETBOOK_INBOX_INTERVAL``
seconds (no inotify, so network mounts work). A file is imported once its size and modification
time have not changed between two polls, through the same path as ``POST /api/imports/auto``
(content sniffing, then the importer), and files already in the library are skipped.

* **move** (default): the file is moved to ``processed/`` after a good import, or to ``failed/``
  with ``<name>.error.txt`` beside it. Subfolders keep their layout under those folders.
* **library** (``FRETBOOK_INBOX_MODE=library``): the folder is a read-only source of truth. Nothing
  is moved or written there. The hash of each import is kept in ``inbox_files`` and a changed file
  replaces the song it made before.

Single-user mode reads the folder itself (owner ``local``). With sign-in, each user has a
subfolder named after their e-mail address, the part of it before the ``@``, their display name or
their OIDC subject; files outside such a folder are left alone.
"""

from __future__ import annotations

import hashlib
import logging
import shutil
import threading
import uuid
from collections.abc import Iterator
from pathlib import Path

from fretbook.config import Settings
from fretbook.db.connection import session
from fretbook.db.migrate import utcnow
from fretbook.importers.base import ImportError
from fretbook.jobs.handlers import import_local_file
from fretbook.score.instruments import family, get_preset
from fretbook.storage.media import MediaStore
from fretbook.storage.repository import SongRepository

logger = logging.getLogger("fretbook.inbox")

PROCESSED = "processed"
FAILED = "failed"
_RESERVED = {PROCESSED, FAILED}
_TEMP_SUFFIXES = (".part", ".partial", ".tmp", ".temp", ".crdownload", ".download", ".swp", ".lock", "~")
_Stamp = tuple[int, int]


def is_temporary(name: str) -> bool:
    """Editors, sync clients and downloads write these first; they are never songs."""
    lowered = name.lower()
    return name.startswith((".", "~$")) or lowered.endswith(_TEMP_SUFFIXES)


class InboxWatcher:
    def __init__(self, settings: Settings, songs: SongRepository, media: MediaStore) -> None:
        assert settings.inbox_watch_dir is not None
        self.settings = settings
        self.songs = songs
        self.media = media
        self.root = settings.inbox_watch_dir
        self.library = settings.inbox_mode == "library"
        self._seen: dict[Path, _Stamp] = {}
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    # --- thread -----------------------------------------------------------------------------------

    def start(self) -> None:
        self._thread = threading.Thread(target=self._loop, name="fretbook-inbox", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)

    def _loop(self) -> None:
        logger.info("watching %s (%s mode)", self.root, self.settings.inbox_mode)
        while not self._stop.is_set():
            try:
                self.poll()
            except Exception:
                logger.exception("inbox poll failed")
            self._stop.wait(self.settings.inbox_interval_seconds)

    # --- one poll ---------------------------------------------------------------------------------

    def poll(self) -> int:
        """Look at the folder once and import every file that is ready. Returns how many were handled."""
        if not self.root.is_dir():
            return 0
        current: dict[Path, _Stamp] = {}
        handled = 0
        for owner_id, folder in self._owner_folders():
            for path in self._candidates(folder):
                try:
                    stat = path.stat()
                except OSError:
                    continue
                stamp = (stat.st_size, stat.st_mtime_ns)
                current[path] = stamp
                # Ready when it looked the same on the previous poll too: nothing is still writing it.
                if self._seen.get(path) == stamp and stat.st_size > 0:
                    handled += self._handle(owner_id, folder, path)
                    current.pop(path, None)
        self._seen = current
        return handled

    def _owner_folders(self) -> Iterator[tuple[str, Path]]:
        if not self.settings.oidc_enabled:
            yield "local", self.root
            return
        try:
            subfolders = sorted(p for p in self.root.iterdir() if p.is_dir() and not is_temporary(p.name))
        except OSError:
            return
        for folder in subfolders:
            owner_id = self._owner_for(folder.name)
            if owner_id is not None:
                yield owner_id, folder

    def _owner_for(self, name: str) -> str | None:
        wanted = name.strip().lower()
        with session(self.settings.database_path) as conn:
            rows = conn.execute(
                "SELECT id, display_name, email, external_subject FROM users WHERE external_subject IS NOT NULL"
            ).fetchall()
        found = {
            row["id"]
            for row in rows
            if wanted
            in {
                (row["email"] or "").lower(),
                (row["email"] or "").split("@")[0].lower(),
                (row["display_name"] or "").lower(),
                (row["external_subject"] or "").lower(),
            }
        }
        if len(found) > 1:
            logger.warning("inbox folder %s matches more than one user; skipping it", name)
            return None
        return next(iter(found), None)

    def _candidates(self, folder: Path) -> Iterator[Path]:
        stack = [folder]
        while stack:
            current = stack.pop()
            try:
                entries = sorted(current.iterdir())
            except OSError:
                continue
            for entry in entries:
                if is_temporary(entry.name) or entry.is_symlink():
                    continue
                if entry.is_dir():
                    if not (current == folder and entry.name in _RESERVED):
                        stack.append(entry)
                elif entry.is_file():
                    yield entry

    # --- one file ---------------------------------------------------------------------------------

    def _handle(self, owner_id: str, folder: Path, path: Path) -> int:
        rel = path.relative_to(folder).as_posix()
        try:
            digest = _sha256(path)
            if self.library:
                return self._import_library(owner_id, rel, path, digest)
            return self._import_and_move(owner_id, folder, path, rel)
        except OSError as exc:
            logger.warning("inbox: could not read %s: %s", path, exc)
            return 0

    def _prefer(self, owner_id: str) -> str:
        return family(get_preset(self.songs.get_settings(owner_id)["default_instrument"]).instrument)

    def _run_import(self, owner_id: str, path: Path, *, on_duplicate: str, replace_song_id: str | None = None) -> dict:
        """Import a copy of ``path`` (the import deletes its input) and return the job result."""
        spool = self.settings.inbox_dir
        spool.mkdir(parents=True, exist_ok=True)
        copy = spool / f"{uuid.uuid4().hex}-{path.name}"
        shutil.copyfile(path, copy)
        try:
            return import_local_file(
                owner_id,
                copy,
                self.songs,
                self.media,
                prefer=self._prefer(owner_id),
                on_duplicate=on_duplicate,
                replace_song_id=replace_song_id,
            )
        finally:
            copy.unlink(missing_ok=True)

    def _import_and_move(self, owner_id: str, folder: Path, path: Path, rel: str) -> int:
        try:
            self._run_import(owner_id, path, on_duplicate="skip")
        except Exception as exc:
            if not isinstance(exc, ImportError):
                logger.exception("inbox: importing %s failed", path)
            target = _free_name(folder / FAILED / rel)
            _move(path, target)
            target.with_name(target.name + ".error.txt").write_text(_describe(exc) + "\n", encoding="utf-8")
            return 1
        _move(path, _free_name(folder / PROCESSED / rel))
        return 1

    def _import_library(self, owner_id: str, rel: str, path: Path, digest: str) -> int:
        with session(self.settings.database_path) as conn:
            row = conn.execute(
                "SELECT content_hash, song_id FROM inbox_files WHERE owner_id = ? AND rel_path = ?", (owner_id, rel)
            ).fetchone()
        if row is not None and row["content_hash"] == digest:
            return 0
        song_id: str | None = row["song_id"] if row else None
        error = ""
        try:
            song_id = self._run_import(
                owner_id, path, on_duplicate="replace", replace_song_id=row["song_id"] if row else None
            ).get("song_id")
        except Exception as exc:
            if not isinstance(exc, ImportError):
                logger.exception("inbox: importing %s failed", path)
            error = _describe(exc)
            logger.warning("inbox: %s: %s", rel, error)
        # A file that failed is remembered by hash too, so it is retried only after it changes.
        with session(self.settings.database_path, immediate=True) as conn:
            conn.execute(
                """
                INSERT INTO inbox_files (owner_id, rel_path, content_hash, song_id, error, imported_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (owner_id, rel_path) DO UPDATE SET
                    content_hash = excluded.content_hash, song_id = excluded.song_id,
                    error = excluded.error, imported_at = excluded.imported_at
                """,
                (owner_id, rel, digest, song_id, error, utcnow()),
            )
        return 1


def _describe(exc: Exception) -> str:
    return str(exc) or exc.__class__.__name__


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _free_name(target: Path) -> Path:
    """``target``, or ``name-2.ext``, ``name-3.ext`` when something is already there."""
    if not target.exists() and not target.with_name(target.name + ".error.txt").exists():
        return target
    counter = 2
    while True:
        candidate = target.with_name(f"{target.stem}-{counter}{target.suffix}")
        if not candidate.exists() and not candidate.with_name(candidate.name + ".error.txt").exists():
            return candidate
        counter += 1


def _move(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(source), str(target))
