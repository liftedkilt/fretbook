# Backups and restore

Everything is one SQLite file plus a `media/` folder under `FRETBOOK_DATA_DIR` (`/data` in Docker). Two ways to keep
a copy, and you probably want both.

## Library archive (in the app)

**Settings → Backup and restore → Download library** gives one `.zip` with every song (tabs as Fretbook JSON, chord
sheets as ChordPro), its audio and kept uploads, the practice log and daily goal, setlists, tags and favourites, and a
`manifest.json` with the app and schema version.

- It is written to disk song by song, so a large library does not load into memory. It needs free space in
  `$FRETBOOK_DATA_DIR/inbox` for the temporary file.
- To restore, choose the zip and decide what happens to songs already in the library (same id, or same title, artist
  and source): **Skip it** or **Keep both**. Setlist entries follow the songs they name, even for a song kept as a
  copy.
- The restore runs as a background job, always into the signed-in user's own library. Archives are checked before
  anything is stored: entry count, unpacked size, compression ratio and file names (no absolute paths or `..`).
- With sign-in on, everyone exports and restores their own library. Admins also get **Download everyone's library**
  (restoring that file puts all its songs in the restoring user's library; to recover a whole server use a snapshot).
- Limits: `FRETBOOK_MAX_RESTORE_BYTES` (4 GiB) and `FRETBOOK_MAX_RESTORE_UNPACKED_BYTES` (16 GiB), and your
  [proxy's body limit](reverse-proxy.md).

## Snapshot for cron or a sidecar

```sh
python -m fretbook backup <dest> [--keep N]
```

copies the database with SQLite's online backup API (consistent while the server runs) and the `media/` folder into
`<dest>/fretbook-backup-<UTC timestamp>/`. `--keep 7` then deletes the oldest `fretbook-backup-*` folders in `<dest>`
and leaves anything else alone. It reads the same `FRETBOOK_DATA_DIR` / `FRETBOOK_DATABASE` as the server, prints the
folder it wrote, and exits 1 on failure.

```sh
# crontab: nightly at 03:15, keep a week
15 3 * * * cd /opt/fretbook && FRETBOOK_DATA_DIR=/srv/fretbook/data .venv/bin/python -m fretbook backup /srv/backups --keep 7
# Docker (snapshots land in the same volume; copy them off the host too)
docker compose exec fretbook python -m fretbook backup /data/snapshots --keep 7
```

A snapshot inside the same volume protects against mistakes, not against losing the disk. Copy
`/data/snapshots` somewhere else (restic, rclone, rsync).

## Restoring a snapshot

1. Stop Fretbook.
2. Delete `fretbook.sqlite-wal` and `fretbook.sqlite-shm` next to the old database, if they exist.
3. Copy `fretbook.sqlite` and `media/` from the snapshot folder into the data directory.
4. Start Fretbook.

## Automatic pre-migration copies

Before applying database migrations on an upgrade, Fretbook takes a consistent copy to
`$FRETBOOK_DATA_DIR/backups/pre-migrate-<from>-<to>-<timestamp>.sqlite` and keeps the newest
`FRETBOOK_MIGRATION_BACKUPS_KEEP` (default 5). They contain the database only, not `media/`. See
[Upgrading](upgrading.md).
