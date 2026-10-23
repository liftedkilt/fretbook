# How Fretbook is built

```
browser   Svelte 5 + TypeScript (Vite)    alphaTab renders and plays tabs; pdf-lib writes the PDF; ChordSheet.svelte renders chord sheets
server    FastAPI (fretbook/)             one process, background job thread for imports
storage   SQLite data/fretbook.sqlite     songs, users, sessions, jobs; audio files under data/media/<owner>/<song>/
auth      fretbook/auth/                  single-user, or OIDC code flow + PKCE with roles from groups
```

FastAPI serves the built web app, so the container needs no Node at runtime. `<base href>` is rewritten from `FRETBOOK_ROOT_PATH`.

PDF export adds two web dependencies, [`pdf-lib`](https://pdf-lib.js.org/) and [`@pdf-lib/fontkit`](https://github.com/Hopding/fontkit) (`web/package.json`). Vite bundles them with the app. The music font is Bravura from `@coderline/alphatab`, copied into `font/` by the Vite plugin. fontkit reads its glyph outlines and the PDF draws those as vectors, so the font file itself is not embedded. The Docker image does not install anything extra for PDF.

## Stored formats

A song is either a **tab** or a **chord sheet**.

- **Tabs** are stored as a Fretbook JSON score document (`fretbook/score/model.py`). It is not alphaTex and not tied to alphaTab: the browser turns it into alphaTex only to render. MusicXML would be the other candidate, but it is far harder to validate, edit in place, and attach sync data to, and every import would round-trip through it. Portability comes from the MusicXML export instead, which the importer reads back (tested), so a library is never locked in.
- **Chord sheets** are stored as ChordPro text and rendered by a small component of our own. alphaTab is built around bars of notation, which suits tabs but makes a chord chart look stiff.

## The score document

- `bars` are song-level (time signature, tempo changes, repeats, section names), like alphaTab's master bars. Each track has exactly one entry per bar with only its notes, in one or more voices.
- Time is integer ticks, 960 per quarter note (alphaTab's resolution), so triplets and other tuplets are exact.
- String index 0 is the highest string, as in Songsterr and MusicXML `<string>`. `tuning_midi` lists the strings highest first. alphaTab numbers strings from the lowest; `web/src/lib/alphatex.ts` and `web/src/lib/alphatab/importScore.ts` convert.
- Techniques (hammer-on/pull-off, slides, bends, vibrato, harmonics, ghost/dead notes, palm mute, let ring, staccato, grace notes) are typed fields.
- `sync.points` (published per-bar times) and `sync.anchors` (your taps) are keyed by bar index. Bar timing between marks is piecewise linear and follows each bar's real length (`fretbook/score/sync.py` and `web/src/lib/sync.ts` implement the same algorithm and share test vectors). Repeats are stored but not rendered yet, so the bar index is also the playback order.

## API conventions

- The contract is the committed `openapi.json`, and `web/src/lib/api-types.ts` is generated from it. See [CONTRIBUTING.md](../CONTRIBUTING.md#api-contract).
- Every write bumps a song's `revision`. `PUT /api/songs/{id}` must send the revision it loaded and gets `409` if the song changed.
- `GET /api/songs` is paged and searched on the server: `q` (word prefixes over title and artist, matched with the `songs_fts` FTS5 table that triggers keep in step), `sort` (`title`, `artist`, `added`, `updated`, `opened`), `order`, `instrument`, `limit` (1 to 200) and an opaque `cursor`. It returns `{items, total, next_cursor, counts}`, where `counts` covers the whole library for the filter chips. The cursor is an offset, so a song added between two page requests can shift the next page by one. `POST /api/songs/{id}/opened` records `last_opened_at` without touching `revision` or `updated_at`.
- Errors are `{"detail": {"key", "message", "params"}}`. The web app shows `errors.<key>` from its catalog and falls back to the English message, so server errors can be translated. Job progress uses keys too.
- Schema changes are numbered SQL files in `fretbook/db/migrations/`, each applied in one transaction. Before applying pending migrations on start, a consistent SQLite snapshot is backed up to `data/backups/pre-migrate-<from>-<to>-<timestamp>.sqlite` (keeping the last N). The server refuses to start if the database schema is newer than the code.
- Backups: `fretbook/backup/` writes and restores the library zip (`manifest.json` plus `songs/<id>/…`; restore is the `library.import` job and never extracts by archive name), and `python -m fretbook backup` takes the cron snapshot (`snapshot.py`).

## ASCII tab

`fretbook/importers/ascii_tab.py` turns `e|---3---|` text into a score document. Rhythm is estimated, not read: a bar's notes are placed by their position between the bar lines, snapped to a grid (eighth notes by default), and each note lasts until the next one, rounded down to a length the notation can draw, with rests for the rest of the gap. The song is stored with `source_ref.rhythm_estimated = true`, which the song page shows as a badge. `looks_like_ascii_tab` is the one test that tells a tab from a chords-over-lyrics sheet; the importer registry uses it for `.txt` files and `POST /api/imports/ascii-tab[/preview]` for pasted text.

## Universal import

`POST /api/imports/auto` (`fretbook/api/universal_routes.py`) takes one of a file, pasted text or a link and queues a job; the old per-format endpoints stay. `fretbook/importers/sniff.py` identifies formats by content (magic bytes, ZIP member names, then text heuristics; the extension is only a fallback), and `resolve_importer` uses it for every uploaded file, so a mislabelled file still reaches the right importer. Prose that matches no format is refused rather than turned into a chord sheet. Guitar Pro is parsed by alphaTab in the browser, so the web app checks for it first (`web/src/lib/sniff.ts`) and the server refuses a Guitar Pro upload.

Links go through the provider registry in `fretbook/importers/remote.py`: Songsterr, YouTube (blank tab plus `AudioFetch`), and everything else, which `SafeFetcher` (`safe_fetch.py`) downloads and the sniffer classifies; an HTML page is searched by `pages.py` for linked score files, then `<pre>` tab blocks. `SafeFetcher` is the only way the server fetches a user-supplied URL: public addresses only (unless `FRETBOOK_ALLOW_PRIVATE_URLS`), connect to the checked address with the original `Host` and SNI, manual redirects re-checked per hop, size and deadline limits. A new site (Ultimate Guitar) is a new `Provider` plus a branch in `_import_link`.

## Background jobs

Imports run on a single job thread in the web process, reading the `jobs` table. Slow, GPU-bound work (such as recognising tabs in video frames, `fretbook/importers/youtube_frames.py`) should run as a separate worker that claims only its own job kind from the same table, and land its result as a draft for review in the editor. The design is in [design/youtube-tab-import.md](design/youtube-tab-import.md).
