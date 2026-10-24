# Configuration

Fretbook is configured with environment variables. Every one starts with `FRETBOOK_`, and every
one is optional: the defaults give a single-user server on `127.0.0.1:8137`.

!!! note "Generated page"
    This table is generated from `fretbook/config.py` by `scripts/gen_config_docs.py`. Do not edit it
    by hand: change the registry in `config.py` and run `python scripts/gen_config_docs.py`. CI fails when
    the page is out of date, and a test fails when the code reads a variable the registry does not list.

## Server

| Variable | Default | Purpose |
| --- | --- | --- |
| `FRETBOOK_HOST` | `127.0.0.1` | Bind address. The Docker image sets `0.0.0.0`. |
| `FRETBOOK_PORT` | `8137` | Listen port. |
| `FRETBOOK_ROOT_PATH` | empty | URL prefix when a reverse proxy strips one, for example `/fretbook`. |
| `FRETBOOK_FORWARDED_ALLOW_IPS` | `127.0.0.1` | Proxies allowed to send `X-Forwarded-*`. Set it to your proxy's address, never `*` on a port clients can reach. |
| `FRETBOOK_STATIC_DIR` | built-in | Serve the web app from another directory. |
| `FRETBOOK_MAX_UPLOAD_BYTES` | 80 MB | Largest upload and request body. |
| `FRETBOOK_DEMO_MODE` | `false` | Run a public, read-only demo: no uploads, imports, edits or deletes, and the library is reset to the demo songs at start and every night at 03:00 UTC. For single-user mode. See [Demo library and demo mode](../guides/demo.md). |

## Storage

| Variable | Default | Purpose |
| --- | --- | --- |
| `FRETBOOK_DATA_DIR` | `data` | SQLite database, media, backups and the upload inbox. |
| `FRETBOOK_DATABASE` | `$FRETBOOK_DATA_DIR/fretbook.sqlite` | Database file. |
| `FRETBOOK_MIGRATION_BACKUPS_KEEP` | `5` | Number of automatic pre-migration backups to keep in `$FRETBOOK_DATA_DIR/backups`. |
| `FRETBOOK_FAILED_UPLOAD_RETENTION_DAYS` | `7` | Days to keep uploaded files from failed imports before cleaning them up. |
| `FRETBOOK_USER_QUOTA_MB` | `0` (no limit) | Most media (audio, stems, covers, kept uploads) one user may store, in MB. Uploads over it are refused. |
| `FRETBOOK_MAX_RESTORE_BYTES` | 4 GiB | Largest library archive accepted by Settings → Backup and restore. |
| `FRETBOOK_MAX_RESTORE_UNPACKED_BYTES` | 16 GiB | Largest total size a library archive may unpack to. |
| `FRETBOOK_LESSONS_DIR` | `$FRETBOOK_DATA_DIR/lessons` | Folder of your own courses and lessons (`<course>/<lesson>.md`), added to the built-in ones. See [Writing lessons](../lessons.md). |
| `FRETBOOK_SECRET_KEY` | generated | Encrypts the LLM API keys stored in the database. Empty: a random key is created once in `$FRETBOOK_DATA_DIR/secret.key`. Keep it out of backups that sit next to the database. |

## Importing

| Variable | Default | Purpose |
| --- | --- | --- |
| `FRETBOOK_LEGACY_SONGS_DIR` | `songs` | bass-tab-sync `songs/<slug>/` folders to import on start. Empty disables it. |
| `FRETBOOK_INBOX_DIR` | empty | Watched folder: files dropped here are imported. See [Watched inbox folder](../guides/inbox.md). |
| `FRETBOOK_INBOX_MODE` | `move` | `move` (imported files go to `processed/`, failures to `failed/`) or `library` (the folder is read-only; changed files are imported again). |
| `FRETBOOK_INBOX_INTERVAL` | `10` | Seconds between looks at the inbox folder. |
| `FRETBOOK_ALLOW_PRIVATE_URLS` | `false` | Let pasted links point at private, loopback and link-local addresses (for example a tab server on your LAN). Off by default so a link cannot reach services on the server's own network. |
| `FRETBOOK_METADATA_LOOKUP` | `false` | Let a song's metadata lookup ask [MusicBrainz](https://musicbrainz.org) for its album and year, and the [Cover Art Archive](https://coverartarchive.org) for its cover, by artist and title. Off by default: the lookup sends the song's artist and title to those services. |
| `FRETBOOK_FETCH_MAX_BYTES` | 25 MB | Largest download when importing from a pasted link. |
| `FRETBOOK_FETCH_TIMEOUT` | `30` | Seconds a pasted link may take to download. |
| `FRETBOOK_GP_CONVERTER` | _(auto)_ | Path to `gp-to-document.mjs`, the Node script that reads Guitar Pro files on the server. The Docker image has it; a checkout needs `npm run build:gp-cli` in `web/`. Without it, Guitar Pro still imports from the browser. |
| `FRETBOOK_NODE` | `node` | The Node 22 binary used for Guitar Pro files. |

## Audio downloads

| Variable | Default | Purpose |
| --- | --- | --- |
| `FRETBOOK_DOWNLOAD_AUDIO` | `true` | Download the audio of the video a Songsterr tab is synced to, with yt-dlp. |
| `FRETBOOK_AUDIO_TIMEOUT` | `600` | Seconds before a yt-dlp download is abandoned. |
| `FRETBOOK_YTDLP_AUTO_UPDATE` | `false` | Install the newest yt-dlp into `$FRETBOOK_DATA_DIR/ytdlp` at start and once a day, and use it. See [Keeping yt-dlp working](../guides/ytdlp.md). |
| `FRETBOOK_YTDLP_COOKIES` | empty | Path to a Netscape-format cookies file for yt-dlp. See the warning in [Keeping yt-dlp working](../guides/ytdlp.md#cookies-optional). |

## Job worker

| Variable | Default | Purpose |
| --- | --- | --- |
| `FRETBOOK_WORKER_KINDS` | empty | Comma-separated job kinds the web process leaves for a separate `python -m fretbook.worker` process. Worker-only kinds are always left to the worker. See [The job worker](../self-hosting/worker.md). |
| `FRETBOOK_AUDIVERIS` | empty (looks for `audiveris` on the `PATH`) | Path to the Audiveris launcher the job worker uses to read sheet music (PDF and images). Without it, a worker that cannot find Audiveris does not claim `import.omr`. See [Sheet music recognition](../self-hosting/worker.md#sheet-music-recognition). |

## Sign-in (OIDC)

| Variable | Default | Purpose |
| --- | --- | --- |
| `FRETBOOK_AUTH_MODE` | `single`, or `oidc` when `FRETBOOK_OIDC_ISSUER` is set | `single` (no login, one library) or `oidc` (sign-in, one library per user). |
| `FRETBOOK_OIDC_ISSUER` | empty | Provider URL, for example `https://id.example.com`. Setting it turns on sign-in. |
| `FRETBOOK_OIDC_CLIENT_ID` | empty | Client id from the provider. |
| `FRETBOOK_OIDC_CLIENT_SECRET` | empty | Optional. Leave empty for a public (PKCE-only) client. |
| `FRETBOOK_OIDC_REDIRECT_URI` | empty | The public callback URL, `https://<your host>[/prefix]/auth/callback`. |
| `FRETBOOK_SESSION_SECRET` | empty | At least 32 characters, for example `openssl rand -hex 32`. Signs the short-lived sign-in cookie. |
| `FRETBOOK_OIDC_USER_GROUP` | `fretbook_users` | Members get their own library. Empty admits everyone the provider signs in. |
| `FRETBOOK_OIDC_ADMIN_GROUP` | `fretbook_admins` | Members are users who also manage the Users page. |
| `FRETBOOK_OIDC_GROUPS_CLAIM` | `groups` | Claim that lists the groups, read from the ID token or else from userinfo. |
| `FRETBOOK_OIDC_SCOPES` | `openid profile email groups` | Requested scopes. |
| `FRETBOOK_OIDC_POST_LOGOUT_REDIRECT_URI` | empty | Where the provider sends the browser after sign-out. It must be registered with the provider. |
| `FRETBOOK_SESSION_MAX_AGE` | `604800` | Session length in seconds (7 days). |
