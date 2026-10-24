# Docker Compose

The repository's `docker-compose.yml` builds the image locally. For a server, use the published image and a named
volume, so an upgrade is a pull and a restart:

```yaml
services:
  fretbook:
    image: ghcr.io/liftedkilt/fretbook:0.1.3 # pin a release; see the changelog before changing it
    ports:
      - "8137:8137" # drop this line when only a reverse proxy should reach it
    volumes:
      - fretbook-data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8137/api/health')"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 15s

volumes:
  fretbook-data:
```

Everything Fretbook stores is under `/data` (the `FRETBOOK_DATA_DIR` the image sets): one SQLite database, a
`media/` folder with audio and kept uploads, `backups/` with the automatic pre-migration copies, and a short-lived
upload `inbox/`. Back that volume up ([Backups and restore](backups.md)).

## Bind mounts

If you prefer a folder on the host, the container runs as uid/gid `1000`, so make it writable for that user:

```sh
mkdir -p /srv/fretbook/data && chown 1000:1000 /srv/fretbook/data
```

```yaml
    volumes:
      - /srv/fretbook/data:/data
```

SQLite needs a local filesystem with working file locks; do not put the data directory on NFS or SMB. Use a
network share only for the [watched inbox folder](../guides/inbox.md), which polls instead of relying on
file-system events. Run one server process per database.

## Settings

The image already binds `0.0.0.0`. Add `FRETBOOK_*` variables under `environment:`. The [configuration reference](../reference/configuration.md) lists
all of them. The ones most servers set are `FRETBOOK_FORWARDED_ALLOW_IPS` and `FRETBOOK_ROOT_PATH`
([Reverse proxy](reverse-proxy.md)), the `FRETBOOK_OIDC_*` group ([Sign-in](oidc.md)), and
`FRETBOOK_INBOX_DIR` ([Watched inbox](../guides/inbox.md)).

## Health check

`GET /api/health` answers without signing in, which is what the compose health check and most proxies use.
`GET /api/meta` (needs a session when sign-in is on) reports the version, the yt-dlp version and which job kinds have a live worker.
