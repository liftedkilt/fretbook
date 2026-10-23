# Fretbook

Self-hosted tabs, chord sheets, and sheet music for bass and guitar.

- **Tabs**: import from Songsterr, Guitar Pro (3–8), MusicXML, plain ASCII tab (`e|---3---|`), or start blank. Any string count and tuning, several tracks per song, standard notation and tab rendered by [alphaTab](https://alphatab.net).
- **Play along**: with an audio file (uploaded, or downloaded from the YouTube video Songsterr syncs to), the score follows the recording. Tap `T` on each bar to line it up. Without audio, alphaTab's synth plays the tab.
- **Fretboard**: in the player's Sync & audio panel, switch on **Show the fretboard under the score**. An SVG neck for the track's own strings, tuning and capo lights the notes sounding now and fades the next three. Label the dots with note names, intervals (from a root you pick) or fret numbers, and mirror it for left-handed players. It follows the synth and a recording alike.
- **Wait mode**: on a tab without a recording, open the player's Sync & audio panel and press **Wait for me**. The cursor stops on each note of the chosen track until the microphone hears you play it (the right note in any octave counts by default). The other tracks play as backing, or turn the synth off. It needs microphone access, which browsers only give on HTTPS pages or `localhost`, so serve Fretbook over HTTPS (behind a reverse proxy with a certificate). Single notes only for now.
- **Chord sheets**: lyrics with chords over them, stored as ChordPro. Paste an Ultimate Guitar style "chords over lyrics" sheet and it is converted. Transpose and print.
- **Export**: MusicXML (opens in MuseScore, Guitar Pro, and other tab apps), ChordPro, Fretbook JSON, and PDF. The PDF is engraved in the browser by alphaTab, then paged so a staff is never split, with the title, artist, tuning, and track name on every page. Chord sheets export to PDF too.
- **Languages**: English and Brazilian Portuguese.

Fretbook grew out of [Mr-P4p3r/bass-tab-sync](https://github.com/Mr-P4p3r/bass-tab-sync) and still imports its `songs/` folders.

## Run it

### Docker

```sh
docker compose up --build
```

Open `http://localhost:8137`. The database and audio live in the `fretbook-data` volume. A `./songs` folder is mounted read-only for bass-tab-sync imports.

Prebuilt images for amd64 and arm64 are published to GHCR. Each release (`vX.Y.Z`, listed in [CHANGELOG.md](CHANGELOG.md) and on the [releases page](https://github.com/liftedkilt/fretbook/releases)) gets the tags `X.Y.Z` and `X.Y`; every push to `main` gets `latest`, `main` and `sha-<commit>`.

```sh
docker pull ghcr.io/liftedkilt/fretbook:latest   # newest main
docker pull ghcr.io/liftedkilt/fretbook:0.2.0    # a release; pin this one
```

**Upgrading.** Fretbook is versioned with [semver](https://semver.org); while it is `0.x`, a minor version may include breaking changes, so read the [changelog](CHANGELOG.md) first. Everything lives in the `/data` volume, so back it up before you upgrade (see [Backup and restore](#backup-and-restore)). Then pull and restart; database migrations run on start and are not reversible, so to roll back, restore the backup and run the older image. Before applying database migrations on upgrade, Fretbook also automatically takes a consistent SQLite backup to `data/backups/pre-migrate-<from>-<to>-<timestamp>.sqlite` (keeping the last 5 by default). If the database is from a newer version than the running code, startup is refused.

```sh
docker compose pull && docker compose up -d
```

(`docker-compose.yml` builds the image locally. To use a published image, replace `build: .` with `image: ghcr.io/liftedkilt/fretbook:<version>`.) **Settings** and `GET /api/meta` show the running version; images built from `main` also show the commit.

### Locally

Python 3.12, Node 22, and ffmpeg (only for downloading YouTube audio).

```sh
./run.sh            # creates .venv, builds the web app, starts on http://127.0.0.1:8137
```

For development, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Backup and restore

Everything is one SQLite file plus a `media/` folder under `FRETBOOK_DATA_DIR`. Two ways to keep a copy:

**Library archive (Settings → Backup and restore).** *Download library* gives one `.zip` with every song (tabs as Fretbook JSON, chord sheets as ChordPro), its audio and kept uploads, and a `manifest.json` (app and schema version, song metadata, tags and favourites). It is written to disk song by song, so a large library does not load into memory (it needs free space in `$DATA_DIR/inbox` for the temporary file). To restore, choose the zip and decide what happens to songs already in the library (same id, or same title, artist and source): *Skip it* or *Keep both*. The restore runs as a background job, always into the signed-in user's own library. With sign-in on, everyone exports and restores their own library, and admins also get *Download everyone's library* (restoring that file puts all its songs in the restoring user's library; to recover a whole server use a snapshot). Archives are checked before anything is stored: entry count, unpacked size, compression ratio, and file names (no absolute paths or `..`).

**Snapshot for cron or a sidecar.** `python -m fretbook backup <dest> [--keep N]` copies the database with SQLite's online backup API (consistent while the server runs) and the `media/` folder into `<dest>/fretbook-backup-<UTC timestamp>/`. `--keep 7` then deletes the oldest `fretbook-backup-*` folders in `<dest>`, leaving anything else alone. It reads the same `FRETBOOK_DATA_DIR` / `FRETBOOK_DATABASE` as the server and prints the folder it wrote; it exits 1 on failure.

```sh
# crontab: nightly at 03:15, keep a week
15 3 * * * cd /opt/fretbook && FRETBOOK_DATA_DIR=/srv/fretbook/data .venv/bin/python -m fretbook backup /srv/backups --keep 7
# Docker
docker compose exec fretbook python -m fretbook backup /data/snapshots --keep 7
```

To restore a snapshot, stop Fretbook and copy `fretbook.sqlite` and `media/` from the snapshot folder back into the data directory (delete any `fretbook.sqlite-wal` and `-shm` files next to the old database first).

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `FRETBOOK_HOST` | `127.0.0.1` | Bind address. The image sets `0.0.0.0`. |
| `FRETBOOK_PORT` | `8137` | Listen port. |
| `FRETBOOK_DATA_DIR` | `data` | SQLite database, media, and upload inbox. |
| `FRETBOOK_DATABASE` | `$DATA_DIR/fretbook.sqlite` | Database file. |
| `FRETBOOK_MIGRATION_BACKUPS_KEEP` | `5` | Number of automatic pre-migration backups to keep in `$DATA_DIR/backups`. |
| `FRETBOOK_FAILED_UPLOAD_RETENTION_DAYS` | `7` | Days to keep uploaded files from failed imports before cleaning them up. |
| `FRETBOOK_LEGACY_SONGS_DIR` | `songs` | bass-tab-sync `songs/<slug>/` folders to import on start. Empty disables it. |
| `FRETBOOK_AUTH_MODE` | `single`, or `oidc` when `FRETBOOK_OIDC_ISSUER` is set | `single` (no login, one library) or `oidc` (sign-in, one library per user). |
| `FRETBOOK_ROOT_PATH` | empty | URL prefix when a reverse proxy strips one, for example `/fretbook`. |
| `FRETBOOK_FORWARDED_ALLOW_IPS` | `127.0.0.1` | Proxies allowed to send `X-Forwarded-*`. Set it to your proxy's address. |
| `FRETBOOK_DOWNLOAD_AUDIO` | `true` | Download the audio of the video a Songsterr tab is synced to, with yt-dlp. |
| `FRETBOOK_AUDIO_TIMEOUT` | `600` | Seconds before a yt-dlp download is abandoned. |
| `FRETBOOK_YTDLP_AUTO_UPDATE` | `false` | Install the newest yt-dlp into `$DATA_DIR/ytdlp` at start and once a day, and use it. See [Keeping yt-dlp working](#keeping-yt-dlp-working). |
| `FRETBOOK_YTDLP_COOKIES` | empty | Path to a Netscape-format cookies file for yt-dlp. See the warning below. |
| `FRETBOOK_MAX_UPLOAD_BYTES` | 80 MB | Largest upload and request body. |
| `FRETBOOK_ALLOW_PRIVATE_URLS` | `false` | Let pasted links point at private, loopback and link-local addresses (for example a tab server on your LAN). Off by default so a link cannot reach services on the server's own network. |
| `FRETBOOK_FETCH_MAX_BYTES` | 25 MB | Largest download when importing from a pasted link. |
| `FRETBOOK_FETCH_TIMEOUT` | `30` | Seconds a pasted link may take to download. |
| `FRETBOOK_GP_CONVERTER` | _(auto)_ | Path to `gp-to-document.mjs`, the Node script that reads Guitar Pro files on the server. The Docker image has it; a checkout needs `npm run build:gp-cli` in `web/`. Without it, Guitar Pro still imports from the browser. |
| `FRETBOOK_NODE` | `node` | The Node 22 binary used for Guitar Pro files. |
| `FRETBOOK_MAX_RESTORE_BYTES` | 4 GiB | Largest library archive accepted by Settings → Backup and restore. |
| `FRETBOOK_MAX_RESTORE_UNPACKED_BYTES` | 16 GiB | Largest total size an archive may unpack to. |
| `FRETBOOK_STATIC_DIR` | built-in | Serve the web app from another directory. |
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

### Keeping yt-dlp working

YouTube changes often, and an old yt-dlp stops downloading audio. Fretbook helps in three ways:

- **Version.** `GET /api/meta` reports the yt-dlp version, its release date, its age in days, and whether it is stale (older than 30 days). **Settings** shows the same and warns when it is stale.
- **Explained failures.** When a download fails, the import result says why: YouTube asked for a sign-in or bot check, the video is unavailable, it is blocked in the server's country, or yt-dlp is out of date. A timeout is reported as before. Each message suggests uploading an mp3 on the song page instead. The tab is always saved.
- **Updating.** Rebuild or pull the image for a new yt-dlp, or set `FRETBOOK_YTDLP_AUTO_UPDATE=true`. Then the server runs `pip install -U yt-dlp` into `$DATA_DIR/ytdlp` when it starts and once a day, and downloads use that copy whenever it is newer than the one in the image. It is off by default because it fetches and runs code from PyPI; the container needs outbound access to it. A failed update keeps the previous copy. Delete `$DATA_DIR/ytdlp` to go back to the image's version.

**Cookies (optional).** If YouTube keeps asking for a sign-in, set `FRETBOOK_YTDLP_COOKIES` to a Netscape-format cookies file, for example exported from a browser, and mount it into the container (read-only is fine; Fretbook gives yt-dlp a private copy for each download). Warning: the file holds your logged-in session. Anyone who can read it can act as that account, and Google may restrict an account that downloads automatically. Use a throwaway account, never your main one, and keep the file out of version control.

### Sign-in with Pocket ID

1. In Pocket ID, open **Administration → User Groups** and create `fretbook_users` and `fretbook_admins`. Add people to one of them; admins do not also need to be in `fretbook_users`.
2. Open **Administration → OIDC Clients → Add OIDC Client**. Name it Fretbook and set the callback URL to `https://fretbook.example.com/auth/callback` (with your prefix, if you set `FRETBOOK_ROOT_PATH`, before `/auth`). Turn on **Public client** to use PKCE without a secret, or keep the generated secret. Optionally restrict the client to the two groups as well.
3. Optionally add a logout callback URL such as `https://fretbook.example.com/` and set the same value in `FRETBOOK_OIDC_POST_LOGOUT_REDIRECT_URI`.
4. Configure Fretbook:

   ```yaml
   environment:
     FRETBOOK_OIDC_ISSUER: "https://id.example.com"
     FRETBOOK_OIDC_CLIENT_ID: "<client id>"
     FRETBOOK_OIDC_CLIENT_SECRET: "<secret, or leave out for a public client>"
     FRETBOOK_OIDC_REDIRECT_URI: "https://fretbook.example.com/auth/callback"
     FRETBOOK_SESSION_SECRET: "<openssl rand -hex 32>"
     FRETBOOK_FORWARDED_ALLOW_IPS: "<your reverse proxy's address>"
   ```

Fretbook requests the scopes `openid profile email groups`. Every page, asset, and API route except `/api/health` needs a session; a browser without one is sent to Pocket ID and comes back to the page it asked for. Members of neither group are refused at the callback.

Roles are read from the groups claim at each sign-in, so a group change in Pocket ID applies at the user's next sign-in. To apply it at once, an admin can end that user's sessions on the **Users** page. Each user's library is private. Songs from single-user mode (and bass-tab-sync imports) belong to no signed-in user; an admin can move them into their own library from the Users page.

**Security.** To report a vulnerability, see [SECURITY.md](SECURITY.md). In single-user mode there is no login: anyone who can reach the port can use the library, so keep it on a trusted network or behind an authenticating proxy. Writes from other websites are refused (the `Origin` must match the `Host`), and request bodies are capped. With sign-in, sessions are stored server-side (the cookie holds a random token and the database only its hash); cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` when the redirect URI is https. The ID token's signature, issuer, audience, expiry, and nonce are checked, and the callback URL always comes from `FRETBOOK_OIDC_REDIRECT_URI`, never from request headers. Behind a reverse proxy, forward `Host` and `X-Forwarded-Proto` and set `FRETBOOK_FORWARDED_ALLOW_IPS`. Run one server process per database.

### Microphone features need HTTPS

Features that listen to your instrument (the pitch-detection engine in `web/src/lib/listen/`, which the tuner and the play-along modes use) read the microphone in the browser. Browsers only allow microphone access on **HTTPS pages or on `localhost`**. If you run Fretbook on another machine over plain `http://`, the browser blocks the microphone and Fretbook says so. Put it behind a reverse proxy with a certificate (see the proxy notes under Security) or open it through an SSH tunnel to `http://localhost`. Audio never leaves the browser, and echo cancellation, noise suppression and auto gain are turned off because they damage instrument sound.

## Using it

- **Default instrument** (top of the library) is a per-user setting. It is the preset for new tabs and added tracks, and decides which Songsterr parts start checked: bass parts for a bass preset, guitar parts (acoustic and electric) otherwise.
- **Songsterr**: paste a link (`https://www.songsterr.com/a/wsa/…-s123`). If the song has several fretted tracks, you pick which ones to import. The import runs in the background.
  - If YouTube refuses the audio download (common from datacenter addresses), the tab is still saved and you can upload an mp3 on the song page.
  - Importing the same song again refreshes it and keeps your sync marks. If you edited the tab, the new import is saved as a separate song instead.
- **Library**: filter by bass, electric guitar, or acoustic guitar. The song page shows the instrument, tuning, and capo.
- **Tags and favourites**: each song has free-form tags (per user, up to 30 of 40 characters, matched ignoring case) and a favourite star. Edit them on the song page; in the library, pick several tag chips to show only songs that have all of them, turn on *Favourites*, or use *Select* to add a tag to many songs at once. Starred songs are also listed in the sidebar. A new import starts with tags the file gives away, such as the instrument, an alternate tuning like Drop D, the capo, and the key of a chord sheet; remove any you do not want. Tags and stars do not change a song's revision, so they never conflict with an open editor. They are part of the library archive. The API is `GET /api/songs?tag=…&tag=…&favourite=true`, `GET /api/tags`, `PUT /api/songs/{id}/tags`, `PUT /api/songs/{id}/favourite` and `POST /api/tags/add` (see `openapi.json`).
- **Files**: MusicXML, ChordPro (`.cho`, `.chordpro`, `.crd`, `.txt`), ASCII tab (`.tab`, or a `.txt` that contains a tab), and Fretbook JSON upload to the server. Guitar Pro files (3–8) are read in the browser by alphaTab and, for uploads, watched folders and bulk imports, on the server by the same alphaTab under Node (`FRETBOOK_GP_CONVERTER`). A `.txt` file is read as tab when it holds a tab system and as a chord sheet otherwise.
- **Add anything**: the first mode in the Add sheet takes a dropped file, pasted text, or a pasted link, and works out what it is from the content, not the name: Guitar Pro (3–8), MusicXML and compressed `.mxl`, ChordPro, chords over lyrics, ASCII tab, Fretbook JSON, and audio (an audio file becomes a song with a blank tab and the audio attached, ready for tapping sync or typing the tab by hand). MIDI, PDF and images are recognised but not importable yet, and the message says so. Links are routed by site: Songsterr (as above), YouTube (a blank tab with the video's audio, when audio downloads are on), a direct link to any supported file, or any other page, which is searched for a linked tab file (`.gp5`, `.musicxml`, `.cho`…) and then for a `<pre>` block holding a tab. Fetching a link is SSRF-safe: only `http` and `https`, every address the host resolves to must be public (set `FRETBOOK_ALLOW_PRIVATE_URLS=true` to allow your LAN), the connection goes to the address that was checked, redirects are re-checked at every hop (at most 5), and the download is capped by size and time. A Guitar Pro file behind a link is downloaded and read on the server.
- **Paste tab**: in the Add sheet, paste ASCII tab (or a chords-over-lyrics sheet, which goes to the chord sheet converter instead) and see it drawn before you save. The importer reads string labels and tunings in either order (`e B G D A E`, `E A D G`, `B E A D G`), multi-digit frets, `h p / \ b r ~ x ( ) < >`, bar lines and repeat signs, `x4` markers, `[Verse]` headers, `PM` rows, and skips chord names and lyrics between systems. ASCII tab has no rhythm, so note lengths are **estimated** from the spacing in each bar on a grid you choose (eighth notes by default; tempo and time signature are optional), and the song is marked "Rhythm estimated". Check the timing before you play along.
- **Song page**: Space plays, arrows move a bar, `T` marks the start of the next bar against the audio. Loop A/B, speed, and nudge buttons help line up a recording.
- **Practice controls** (Sync & audio panel on the song page): a metronome that follows the song's tempo and time-signature changes (and its sync marks, when a recording plays), a one- or two-bar count-in (optionally before each loop pass), volume for the recording or the synth, and mute, solo and volume for each track while the synth plays. Slowing a recording keeps its pitch. Settings are remembered per song, in this browser. Press `?` on the song page for every shortcut (`M` metronome, `C` count-in, `X`/`S` mute/solo the shown track, `-`/`+` volume, `[`/`]` speed). Manual browser checks are in [docs/practice-controls.md](docs/practice-controls.md).
- **Editor**: bars are shared by every track, so time signatures, tempo changes, sections, and inserting or deleting a bar apply to the whole song, and sync marks move with their bars. If the song changed elsewhere since you opened it (for example sync marks tapped in another tab), saving merges your edits on top; real conflicts ask you to reload.
- **Language**: English and Brazilian Portuguese. The header switcher remembers the choice. With no choice saved, the browser language is used (`pt` and `pt-PT` select `pt-BR`).

## More

- [ROADMAP.md](ROADMAP.md): what is planned, and what is already being built.
- [CONTRIBUTING.md](CONTRIBUTING.md): development setup, checks, working on an issue, dependency updates, and adding a locale.
- [AGENTS.md](AGENTS.md) ([CLAUDE.md](CLAUDE.md)): how coding agents pick up, claim, and finish issues, plus the [PR template](.github/pull_request_template.md) and [issue templates](.github/ISSUE_TEMPLATE/).
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the app is built, the stored score format, and API conventions.

## License

MIT. See [LICENSE](LICENSE).
