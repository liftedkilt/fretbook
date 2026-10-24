# Upgrading

Fretbook is versioned with [semver](https://semver.org). While it is `0.x`, a minor version may include breaking
changes, so read the [changelog](https://github.com/liftedkilt/fretbook/blob/main/CHANGELOG.md) before you upgrade.

## Steps

1. Read the changelog entries between your version and the new one. **Settings** and `GET /api/meta` show the
   running version; images built from `main` also show the commit.
2. [Back up](backups.md): a snapshot of the data volume, or at least a library archive.
3. Pull and restart:

    ```sh
    docker compose pull && docker compose up -d
    ```

    With the repository's own `docker-compose.yml` (which builds locally), use `git pull` and
    `docker compose up -d --build` instead. To use a published image, replace `build: .` with
    `image: ghcr.io/liftedkilt/fretbook:<version>`.
4. Check `GET /api/health` and the version in Settings.

## Image tags

| Tag | Moves when |
| --- | --- |
| `X.Y.Z` | never (one release) |
| `X.Y` | each patch release |
| `latest`, `main` | every push to `main` |
| `sha-<commit>` | never |

Pin `X.Y.Z` (or `X.Y`) on a server you care about; `latest` is the development head.

## Database migrations

Migrations run when the server starts and are **not reversible**. Before applying any, Fretbook copies the database to
`data/backups/pre-migrate-<from>-<to>-<timestamp>.sqlite` (the last 5 are kept). If the database is from a newer
version than the running code, startup is refused rather than risk damage.

## Rolling back

Stop Fretbook, restore the backup you took before the upgrade (see [Backups](backups.md#restoring-a-snapshot); for an
automatic pre-migration copy, put it back as `fretbook.sqlite` and delete the `-wal`/`-shm` files), and run the older
image tag.

## Keeping yt-dlp current

An old yt-dlp stops downloading audio. A new image brings a new one; see
[Keeping yt-dlp working](../guides/ytdlp.md) for the alternative of updating it in place.
