# Fretbook

Self-hosted tabs, chord sheets, and sheet music for bass and guitar.

- **Tabs**: import from Songsterr, Guitar Pro (3–8), MusicXML, or start blank. Any string count and tuning, several tracks per song, standard notation and tab rendered by [alphaTab](https://alphatab.net).
- **Play along**: with an audio file (uploaded, or downloaded from the YouTube video Songsterr syncs to), the score follows the recording. Tap `T` on each bar to line it up. Without audio, alphaTab's synth plays the tab.
- **Chord sheets**: lyrics with chords over them, stored as ChordPro. Paste an Ultimate Guitar style "chords over lyrics" sheet and it is converted. Transpose and print.
- **Export**: MusicXML (opens in MuseScore, Guitar Pro, and other tab apps), ChordPro, Fretbook JSON, and print/PDF.
- **Languages**: English and Brazilian Portuguese.

Fretbook grew out of [Mr-P4p3r/bass-tab-sync](https://github.com/Mr-P4p3r/bass-tab-sync) and still imports its `songs/` folders.

## Run it

### Docker

```sh
docker compose up --build
```

Open `http://localhost:8137`. The database and audio live in the `fretbook-data` volume. A `./songs` folder is mounted read-only for bass-tab-sync imports.

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
| `FRETBOOK_AUTH_MODE` | `single` | `single` (no login, one library) or `oidc` (in progress, see [#5](https://github.com/liftedkilt/fretbook/issues/5)). |
| `FRETBOOK_ROOT_PATH` | empty | URL prefix when a reverse proxy strips one, for example `/fretbook`. |
| `FRETBOOK_FORWARDED_ALLOW_IPS` | `127.0.0.1` | Proxies allowed to send `X-Forwarded-*`. Set it to your proxy's address. |
| `FRETBOOK_DOWNLOAD_AUDIO` | `true` | Download the audio of the video a Songsterr tab is synced to, with yt-dlp. |
| `FRETBOOK_AUDIO_TIMEOUT` | `600` | Seconds before a yt-dlp download is abandoned. |
| `FRETBOOK_MAX_UPLOAD_BYTES` | 80 MB | Largest upload and request body. |
| `FRETBOOK_STATIC_DIR` | built-in | Serve the web app from another directory. |
| `FRETBOOK_OIDC_*`, `FRETBOOK_SESSION_SECRET` | empty | Reserved for OIDC sign-in ([#5](https://github.com/liftedkilt/fretbook/issues/5)). |

**Security.** In single-user mode there is no login: anyone who can reach the port can use the library, so keep it on a trusted network or behind an authenticating proxy. Writes from other websites are refused (the `Origin` must match the `Host`), and request bodies are capped. Behind a reverse proxy, forward `Host` and `X-Forwarded-Proto` and set `FRETBOOK_FORWARDED_ALLOW_IPS`. Run one server process per database.

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
- [CONTRIBUTING.md](CONTRIBUTING.md): development setup, checks, and adding a locale.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the app is built, the stored score format, and API conventions.
