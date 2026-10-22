# Fretbook

Self-hosted tabs and sheet music for bass and guitar.

Fretbook started from [Mr-P4p3r/bass-tab-sync](https://github.com/Mr-P4p3r/bass-tab-sync), a local player that synced Songsterr bass tabs to audio. The score model, importers, and player are now instrument-agnostic: any string count, any tuning, more than one track, and the same tap-to-sync timing as the original player.

## Architecture

```
browser (Svelte + TypeScript)
    alphaTab renders notation and moves the cursor
    |
    FastAPI  (fretbook/)
    SQLite   data/fretbook.sqlite
    files    data/media/<owner>/<song>/
```

The browser is a Vite single-page app. `npm run build` writes `web/dist`, and FastAPI serves those files. Docker builds the UI in a Node stage and copies it into one Python image, so the running container does not need Node.

The score stored in SQLite is a Fretbook JSON document (`fretbook/score/model.py`). alphaTab is the viewer and player, not the source of truth. Importers and the editor write the document; the song page turns the selected track into alphaTex and hands it to alphaTab.

String index 0 is the highest string, matching Songsterr. alphaTab numbers strings the other way (1 is the lowest). `web/src/lib/alphatex.ts` and `web/src/lib/alphatab/importScore.ts` convert.

### Why this stack

- **FastAPI and SQLite.** One process, a file database, and an `owner_id` on every song. That is enough for the single-user default and for private libraries later. Schema changes are numbered SQL files in `fretbook/db/migrations/`.
- **Svelte with Vite, not SvelteKit.** The UI is a client-side app with no server routes of its own. SvelteKit's adapter would add a second server. Vite builds static files, FastAPI serves them, and `<base href>` is rewritten from `FRETBOOK_ROOT_PATH` so a reverse proxy prefix still loads the assets.
- **alphaTab (`@coderline/alphatab` 1.8).** It fits. The library is MPL-2.0: using the unmodified package inside Fretbook does not relicense the app. File-level copyleft would apply only if an alphaTab source file itself were changed. It already draws standard notation and tab for any tuning and string count, follows an external audio file with sync points, imports Guitar Pro 3–8, and opens a print view with `api.print()`. Bravura (the music font) is SIL OFL. The bundled SONiVOX soundfont is Apache-2.0. See those license files under `web/node_modules/@coderline/alphatab` after install; the Vite plugin copies the font and soundfont into the build.
- Playback sync stays the original piecewise-linear map (`fretbook/score/sync.py`, `web/src/lib/sync.ts`). Measure starts are sent to alphaTab as flat sync points. With an audio file, alphaTab runs in external-media mode and the `<audio>` element is the clock. Without audio, alphaTab's synthesizer plays the tab.

Songsterr import still downloads the bass part by default, the same behavior as bass-tab-sync. Every fretted part is listed on the song for a later picker.

## Run locally

Python 3.12, Node 22, and ffmpeg (only needed when downloading YouTube audio).

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd web && npm ci && npm run build && cd ..
.venv/bin/python -m fretbook
```

`./run.sh` does the same. The app listens on `http://127.0.0.1:8137`.

During UI work, `cd web && npm run dev` proxies `/api` to that server.

Checks:

```sh
.venv/bin/ruff check fretbook tests
.venv/bin/python -m pytest
cd web && npm run check && npm test && npm run build
```

## Docker

```sh
docker compose up --build
```

The service and image are named `fretbook`. Published port is 8137. The SQLite file and uploaded audio live in the `fretbook-data` volume. A `./songs` directory is mounted read-only for legacy imports.

Behind a reverse proxy, forward `X-Forwarded-Proto` and `Host`. If the proxy strips a prefix, set `FRETBOOK_ROOT_PATH` to that prefix (`/fretbook`). Leave it empty when the proxy keeps the path and Uvicorn's `root_path` is enough.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `FRETBOOK_HOST` | `127.0.0.1` | Bind address. The image sets `0.0.0.0`. |
| `FRETBOOK_PORT` | `8137` | Listen port. |
| `FRETBOOK_DATA_DIR` | `data` | SQLite, media, and import inbox. |
| `FRETBOOK_DATABASE` | `$DATA_DIR/fretbook.sqlite` | Database file. |
| `FRETBOOK_LEGACY_SONGS_DIR` | `songs` | Old `tab-data.js` folders. Empty disables import. |
| `FRETBOOK_AUTH_MODE` | `single` | `single` (no login) or `oidc` (issue #5). |
| `FRETBOOK_ROOT_PATH` | empty | Prefix used in the HTML `<base href>`. |
| `FRETBOOK_FORWARDED_ALLOW_IPS` | `*` | Which proxies may set forwarded headers. |
| `FRETBOOK_DOWNLOAD_AUDIO` | `true` | Download the Songsterr video's audio with yt-dlp. |
| `FRETBOOK_MAX_UPLOAD_BYTES` | 80MB | Upload limit. |
| `FRETBOOK_STATIC_DIR` | built-in | Override the UI directory. |
| `FRETBOOK_OIDC_ISSUER` | empty | Issue #5. |
| `FRETBOOK_OIDC_CLIENT_ID` | empty | Issue #5. |
| `FRETBOOK_OIDC_CLIENT_SECRET` | empty | Issue #5, optional for public clients. |
| `FRETBOOK_OIDC_REDIRECT_URI` | empty | Issue #5. |
| `FRETBOOK_SESSION_SECRET` | empty | Issue #5. |

With no OIDC settings the app is one shared library owned by the user id `local`.

## Legacy songs

On startup, each `songs/<slug>/` directory that contains `tab-data.js` is imported once for the local user, including `audio.mp3` and `sync-preset.js` when those files exist. A folder that was already imported is left alone.

## Using it

- Paste a Songsterr URL (`https://www.songsterr.com/a/wsa/…-s123`). The import runs as a background job. The bass part is saved, and audio is downloaded when Songsterr published sync points for a video. If the download fails (YouTube often refuses a datacenter address), the tab is still saved and an audio file can be uploaded on the song page.
- MusicXML and a Fretbook JSON export upload to the server. Guitar Pro files are read in the browser by alphaTab and then saved as a normal document.
- Create a blank tab from a preset (4- and 5-string bass, 6- and 7-string guitar, drop D, acoustic).
- On the song page, space plays, arrows move a measure, and T taps the next measure onto the audio. Marks are stored on the song. Without an audio file, alphaTab synthesizes the part.

## Where the follow-up issues plug in

These are not implemented in this rewrite. The contracts below are the ones a follow-up should fill in.

### #2 English translations and language switching

Strings already go through `t()` in `web/src/lib/i18n.svelte.ts`. The English catalog is `web/src/locales/en.json`. `setLocale` remembers `fretbook.locale` and falls back to English when the browser language has no catalog. Add a locale by dropping in another JSON file and registering it in `catalogs`. Job progress uses `progress_key` (for example `import.fetchingTab`) so status text can be translated without parsing English sentences. A missing-key check in CI belongs with this issue.

### #3 PDF export

`fretbook/export/pdf.py` defines `PdfExporter` and `available_exporters()`. The list is `["json"]` until PDF is real, and the song page shows Export PDF only when `pdf` is included (`GET /api/meta`). `GET /api/songs/{id}/export.pdf` returns 501. `web/src/lib/export/pdf.ts` calls alphaTab `api.print()` for a client print view. A paginated PDF still has to put the title, artist, tuning, and track name in the header and must not split a staff across a page. Cover at least 4- and 5-string bass and 6-string guitar.

### #4 Guitar alongside bass

The document already stores any string count, tuning, capo, and several tracks (`fretbook/score/model.py`, presets in `fretbook/score/instruments.py`). Songsterr import lists every fretted part on `source_ref["available_tracks"]` and, by default, still downloads only the bass. `POST /api/imports` accepts `part_ids`; `choose_tracks` in `fretbook/importers/songsterr.py` is the picker hook. Library filters are not built. The song page already shows the instrument and tuning.

### #5 Pocket ID / OIDC

`fretbook/auth/oidc.py` documents the authorization-code + PKCE flow and currently returns HTTP 501. `build_auth` in `fretbook/auth/__init__.py` selects it when `FRETBOOK_AUTH_MODE=oidc`. `Principal` is in `fretbook/auth/base.py`. Every repository query filters on `owner_id`. `users.external_subject` is the OIDC `sub`. Wire login, logout, secure cookies, and `X-Forwarded-Proto` / `Host` there. No OIDC configuration must keep the single-user behavior.

### #6 YouTube frame importer

`fretbook/importers/youtube_frames.py` is the design: `download_video`, `extract_frames`, `recognize_tab`, and `stitch`. `can_handle` stays false so a YouTube URL is not mistaken for Songsterr. The job kind `import.youtube_frames` is registered in `fretbook/jobs/handlers.py` and ends in the not-implemented error. The saved result should be a normal document the existing editor can review before it is trusted.
