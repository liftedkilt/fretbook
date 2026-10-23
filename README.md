# Fretbook

Self-hosted tabs, chord sheets, and sheet music for bass and guitar.

- **Tabs**: import from Songsterr, Guitar Pro (3–8), MusicXML, or start blank. Any string count and tuning, several tracks per song, standard notation and tab rendered by [alphaTab](https://alphatab.net).
- **Play along**: with an audio file (uploaded, or downloaded from the YouTube video Songsterr syncs to), the score follows the recording. Tap `T` on each bar to line it up. Without audio, alphaTab's synth plays the tab.
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

**Upgrading.** Fretbook is versioned with [semver](https://semver.org); while it is `0.x`, a minor version may include breaking changes, so read the [changelog](CHANGELOG.md) first. Everything lives in the `/data` volume, so back it up before you upgrade (stop the container and copy the volume, or copy `fretbook.sqlite` and the media folder). Then pull and restart; database migrations run on start and are not reversible, so to roll back, restore the backup and run the older image.

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

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `FRETBOOK_HOST` | `127.0.0.1` | Bind address. The image sets `0.0.0.0`. |
| `FRETBOOK_PORT` | `8137` | Listen port. |
| `FRETBOOK_DATA_DIR` | `data` | SQLite database, media, and upload inbox. |
| `FRETBOOK_DATABASE` | `$DATA_DIR/fretbook.sqlite` | Database file. |
| `FRETBOOK_LEGACY_SONGS_DIR` | `songs` | bass-tab-sync `songs/<slug>/` folders to import on start. Empty disables it. |
| `FRETBOOK_AUTH_MODE` | `single`, or `oidc` when `FRETBOOK_OIDC_ISSUER` is set | `single` (no login, one library) or `oidc` (sign-in, one library per user). |
| `FRETBOOK_ROOT_PATH` | empty | URL prefix when a reverse proxy strips one, for example `/fretbook`. |
| `FRETBOOK_FORWARDED_ALLOW_IPS` | `127.0.0.1` | Proxies allowed to send `X-Forwarded-*`. Set it to your proxy's address. |
| `FRETBOOK_DOWNLOAD_AUDIO` | `true` | Download the audio of the video a Songsterr tab is synced to, with yt-dlp. |
| `FRETBOOK_AUDIO_TIMEOUT` | `600` | Seconds before a yt-dlp download is abandoned. |
| `FRETBOOK_YTDLP_AUTO_UPDATE` | `false` | Install the newest yt-dlp into `$DATA_DIR/ytdlp` at start and once a day, and use it. See [Keeping yt-dlp working](#keeping-yt-dlp-working). |
| `FRETBOOK_YTDLP_COOKIES` | empty | Path to a Netscape-format cookies file for yt-dlp. See the warning below. |
| `FRETBOOK_MAX_UPLOAD_BYTES` | 80 MB | Largest upload and request body. |
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

**Security.** In single-user mode there is no login: anyone who can reach the port can use the library, so keep it on a trusted network or behind an authenticating proxy. Writes from other websites are refused (the `Origin` must match the `Host`), and request bodies are capped. With sign-in, sessions are stored server-side (the cookie holds a random token and the database only its hash); cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` when the redirect URI is https. The ID token's signature, issuer, audience, expiry, and nonce are checked, and the callback URL always comes from `FRETBOOK_OIDC_REDIRECT_URI`, never from request headers. Behind a reverse proxy, forward `Host` and `X-Forwarded-Proto` and set `FRETBOOK_FORWARDED_ALLOW_IPS`. Run one server process per database.

## Using it

- **Default instrument** (top of the library) is a per-user setting. It is the preset for new tabs and added tracks, and decides which Songsterr parts start checked: bass parts for a bass preset, guitar parts (acoustic and electric) otherwise.
- **Songsterr**: paste a link (`https://www.songsterr.com/a/wsa/…-s123`). If the song has several fretted tracks, you pick which ones to import. The import runs in the background.
  - If YouTube refuses the audio download (common from datacenter addresses), the tab is still saved and you can upload an mp3 on the song page.
  - Importing the same song again refreshes it and keeps your sync marks. If you edited the tab, the new import is saved as a separate song instead.
- **Library**: filter by bass, electric guitar, or acoustic guitar. The song page shows the instrument, tuning, and capo.
- **Files**: MusicXML, ChordPro (`.cho`, `.chordpro`, `.crd`, `.txt`), and Fretbook JSON upload to the server. Guitar Pro files are read in the browser by alphaTab.
- **Song page**: Space plays, arrows move a bar, `T` marks the start of the next bar against the audio. Loop A/B, speed, and nudge buttons help line up a recording.
- **Editor**: bars are shared by every track, so time signatures, tempo changes, sections, and inserting or deleting a bar apply to the whole song, and sync marks move with their bars. If the song changed elsewhere since you opened it (for example sync marks tapped in another tab), saving merges your edits on top; real conflicts ask you to reload.
- **Language**: English and Brazilian Portuguese. The header switcher remembers the choice. With no choice saved, the browser language is used (`pt` and `pt-PT` select `pt-BR`).

## More

- [ROADMAP.md](ROADMAP.md): what is planned, and what is already being built.
- [CONTRIBUTING.md](CONTRIBUTING.md): development setup, checks, working on an issue, dependency updates, and adding a locale.
- [AGENTS.md](AGENTS.md) ([CLAUDE.md](CLAUDE.md)): how coding agents pick up, claim, and finish issues, plus the [PR template](.github/pull_request_template.md) and [issue templates](.github/ISSUE_TEMPLATE/).
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the app is built, the stored score format, and API conventions.
