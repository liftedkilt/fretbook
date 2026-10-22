# Fretbook

Self-hosted tabs, chord sheets, and sheet music for bass and guitar.

- **Tabs**: import from Songsterr, Guitar Pro (3–8), MusicXML, or start blank. Any string count and tuning, several tracks per song, standard notation and tab rendered by [alphaTab](https://alphatab.net).
- **Play along**: with an audio file (uploaded, or downloaded from the YouTube video Songsterr syncs to), the score follows the recording. Tap `T` on each bar to line it up. Without audio, alphaTab's synth plays the tab.
- **Chord sheets**: lyrics with chords over them, stored as ChordPro. Paste an Ultimate Guitar style "chords over lyrics" sheet and it is converted. Transpose and print.
- **Export**: MusicXML (opens in MuseScore, Guitar Pro, and other tab apps), ChordPro, Fretbook JSON, and print/PDF.

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

For UI work, run the API with `.venv/bin/python -m fretbook` and `cd web && npm run dev` (Vite proxies `/api`).

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `FRETBOOK_HOST` | `127.0.0.1` | Bind address. The image sets `0.0.0.0`. |
| `FRETBOOK_PORT` | `8137` | Listen port. |
| `FRETBOOK_DATA_DIR` | `data` | SQLite database, media, and upload inbox. |
| `FRETBOOK_DATABASE` | `$DATA_DIR/fretbook.sqlite` | Database file. |
| `FRETBOOK_LEGACY_SONGS_DIR` | `songs` | bass-tab-sync `songs/<slug>/` folders to import on start. Empty disables it. |
| `FRETBOOK_AUTH_MODE` | `single` | `single` (no login, one library) or `oidc` (not implemented yet, see #5). |
| `FRETBOOK_ROOT_PATH` | empty | URL prefix when a reverse proxy strips one, for example `/fretbook`. |
| `FRETBOOK_FORWARDED_ALLOW_IPS` | `127.0.0.1` | Proxies allowed to send `X-Forwarded-*`. Set it to your proxy's address. |
| `FRETBOOK_DOWNLOAD_AUDIO` | `true` | Download the audio of the video a Songsterr tab is synced to, with yt-dlp. |
| `FRETBOOK_AUDIO_TIMEOUT` | `600` | Seconds before a yt-dlp download is abandoned. |
| `FRETBOOK_MAX_UPLOAD_BYTES` | 80 MB | Largest upload and request body. |
| `FRETBOOK_STATIC_DIR` | built-in | Serve the web app from another directory. |
| `FRETBOOK_OIDC_*`, `FRETBOOK_SESSION_SECRET` | empty | Reserved for #5. |

**Security.** In single-user mode there is no login: anyone who can reach the port can use the library, so keep it on a trusted network or behind an authenticating proxy. Writes from other websites are refused (the `Origin` must match the `Host`), and request bodies are capped. Behind a reverse proxy, forward `Host` and `X-Forwarded-Proto` and set `FRETBOOK_FORWARDED_ALLOW_IPS`. Run one server process per database.

## Using it

- **Default instrument** (top of the library) is a per-user setting. It is the preset for new tabs and added tracks, and decides which Songsterr parts start checked: bass parts for a bass preset, guitar parts (acoustic and electric) otherwise.
- **Songsterr**: paste a link (`https://www.songsterr.com/a/wsa/…-s123`). If the song has several fretted tracks, you pick which ones to import. The import runs in the background. If YouTube refuses the download (common from datacenter addresses), the tab is still saved and you can upload an mp3 on the song page. Importing the same song again refreshes it and keeps your sync marks, unless you edited the tab, in which case the new import is saved as a separate song. The song page shows the instrument, tuning, and capo. The library can be filtered by bass, electric guitar, or acoustic guitar.
- **Files**: MusicXML, ChordPro (`.cho`, `.chordpro`, `.crd`, `.txt`), and Fretbook JSON upload to the server. Guitar Pro files are read in the browser by alphaTab.
- **Song page**: Space plays, arrows move a bar, `T` marks the start of the next bar against the audio. Loop A/B, speed, and nudge buttons help line up a recording.
- **Editor**: bars are shared by every track, so time signatures, tempo changes, sections, and inserting or deleting a bar apply to the whole song, and sync marks move with their bars. If the song changed elsewhere since you opened it (for example sync marks tapped in another tab), saving merges your edits on top; real conflicts ask you to reload.

## How it is built

```
browser   Svelte 5 + TypeScript (Vite)    alphaTab renders and plays tabs; ChordSheet.svelte renders chord sheets
server    FastAPI (fretbook/)             one process, background job thread for imports
storage   SQLite data/fretbook.sqlite     songs, users, jobs; audio files under data/media/<owner>/<song>/
```

FastAPI serves the built web app, so the container needs no Node at runtime. `<base href>` is rewritten from `FRETBOOK_ROOT_PATH`.

### Stored formats

A song is either a **tab** or a **chord sheet**.

- **Tabs** are stored as a Fretbook JSON score document (`fretbook/score/model.py`). It is not alphaTex and not tied to alphaTab: the browser turns it into alphaTex only to render. MusicXML would be the other candidate, but it is far harder to validate, edit in place, and attach sync data to, and every import would round-trip through it. Portability comes from the MusicXML export instead, which the importer reads back (tested), so a library is never locked in.
- **Chord sheets** are stored as ChordPro text and rendered by a small component of our own. alphaTab is built around bars of notation, which suits tabs but makes a chord chart look stiff.

The score document, in short:

- `bars` are song-level (time signature, tempo changes, repeats, section names), like alphaTab's master bars. Each track has exactly one entry per bar with only its notes, in one or more voices.
- Time is integer ticks, 960 per quarter note (alphaTab's resolution), so triplets and other tuplets are exact.
- String index 0 is the highest string, as in Songsterr and MusicXML `<string>`. `tuning_midi` lists the strings highest first. alphaTab numbers strings from the lowest; `web/src/lib/alphatex.ts` and `web/src/lib/alphatab/importScore.ts` convert.
- Techniques (hammer-on/pull-off, slides, bends, vibrato, harmonics, ghost/dead notes, palm mute, let ring, staccato, grace notes) are typed fields.
- `sync.points` (published per-bar times) and `sync.anchors` (your taps) are keyed by bar index. Bar timing between marks is piecewise linear and follows each bar's real length (`fretbook/score/sync.py` and `web/src/lib/sync.ts` implement the same algorithm and share test vectors). Repeats are stored but not rendered yet, so the bar index is also the playback order.

Every write bumps a song's `revision`; `PUT /api/songs/{id}` must send the revision it loaded and gets `409` if the song changed. Schema changes are numbered SQL files in `fretbook/db/migrations/`, each applied in one transaction.

API errors are `{"detail": {"key", "message", "params"}}`. The web app shows `errors.<key>` from its catalog and falls back to the English message, so server errors can be translated; job progress uses keys too.

## Development

```sh
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/ruff check fretbook tests
.venv/bin/python -m pytest
cd web && npm ci && npm run check && npm test && npm run build
```

The Python tests fail on an unclosed database connection, and check that the English catalog has every error and progress key the server sends; a Vitest test does the same for keys the UI uses.

## Follow-up issues

- **#2 Languages.** Strings go through `t()` (`web/src/lib/i18n.svelte.ts`) with plural forms; add a locale by adding a JSON catalog next to `web/src/locales/en.json` and registering it. The missing-key checks above already run in CI.
- **#3 PDF.** "Print or save PDF" uses the browser's print dialog (alphaTab's print view for tabs). A designed PDF (title, artist, tuning, and track in the header; no staff split across pages) belongs in the browser too, where the renderer is.
- **#4 Guitar.** Songsterr imports acoustic and electric guitar (and 7-string) as well as bass. A song with several fretted tracks asks which to import (`POST /api/imports/preview`, then `part_ids` on `POST /api/imports`). The library filters by instrument.
- **#5 Pocket ID / OIDC.** `fretbook/auth/oidc.py` lists what to build. Keep `users.id` an internal id (it names media folders) and store the OIDC `sub` in `users.external_subject`.
- **#6 YouTube frames.** `fretbook/importers/youtube_frames.py` has the pipeline stubs and the job kind is registered. Frame recognition is slow, GPU-bound work: run it as a separate worker that claims only its job kind from the same `jobs` table, rather than in the web process's single job thread. The result should land as a draft that the editor reviews.
