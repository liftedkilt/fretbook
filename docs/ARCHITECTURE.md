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
- Tags and the favourite star are per song and so per user (`song_tags`, with a case-folded `tag_key`, and `songs.favourite`). `GET /api/songs` takes repeated `tag` parameters (a song needs all of them) and `favourite=true`; `counts` ignores both, and adds `favourites`. `PUT /api/songs/{id}/tags`, `PUT /api/songs/{id}/favourite`, `POST /api/tags/add` and `GET /api/tags` change and list them. Like `opened`, they never touch `revision` or `updated_at`. `fretbook/tags.py` holds the tag rules and `suggest_tags`, which imports apply to a new song. The library archive lists each song's `tags` and `favourite` in its manifest entry.
- Errors are `{"detail": {"key", "message", "params"}}`. The web app shows `errors.<key>` from its catalog and falls back to the English message, so server errors can be translated. Job progress uses keys too.
- Schema changes are numbered SQL files in `fretbook/db/migrations/`, each applied in one transaction. Before applying pending migrations on start, a consistent SQLite snapshot is backed up to `data/backups/pre-migrate-<from>-<to>-<timestamp>.sqlite` (keeping the last N). The server refuses to start if the database schema is newer than the code.
- Backups: `fretbook/backup/` writes and restores the library zip (`manifest.json` plus `songs/<id>/…`; restore is the `library.import` job and never extracts by archive name), and `python -m fretbook backup` takes the cron snapshot (`snapshot.py`).

## ASCII tab

`fretbook/importers/ascii_tab.py` turns `e|---3---|` text into a score document. Rhythm is estimated, not read: a bar's notes are placed by their position between the bar lines, snapped to a grid (eighth notes by default), and each note lasts until the next one, rounded down to a length the notation can draw, with rests for the rest of the gap. The song is stored with `source_ref.rhythm_estimated = true`, which the song page shows as a badge. `looks_like_ascii_tab` is the one test that tells a tab from a chords-over-lyrics sheet; the importer registry uses it for `.txt` files and `POST /api/imports/ascii-tab[/preview]` for pasted text.

## Universal import

`POST /api/imports/auto` (`fretbook/api/universal_routes.py`) takes one of a file, pasted text or a link and queues a job; the old per-format endpoints stay. `fretbook/importers/sniff.py` identifies formats by content (magic bytes, ZIP member names, then text heuristics; the extension is only a fallback), and `resolve_importer` uses it for every uploaded file, so a mislabelled file still reaches the right importer. Prose that matches no format is refused rather than turned into a chord sheet. Guitar Pro is parsed by alphaTab, in the browser (the web app checks for it first, `web/src/lib/sniff.ts`) and on the server: `fretbook/importers/guitarpro.py` runs `web/scripts/gp-to-document.ts`, bundled with alphaTab into one `gp-to-document.mjs` (`npm run build:gp-cli`), under Node. Browser and server share `web/src/lib/alphatab/convert.ts`, so a file becomes the same document either way (`tests/test_guitarpro.py` compares them against `tests/fixtures/corpus/golden-web`). The alternative, PyGuitarPro for GP3-5 plus a hand-written GP6/GP7/GP8 reader, would be a second parser that could disagree with the browser and would need its own GPX (BCFZ) and GPIF code; it was rejected for that reason. The cost is Node in the image (about 120 MB unpacked, 43 MB compressed, plus a 2.4 MB script).

Links go through the provider registry in `fretbook/importers/remote.py`: Songsterr, YouTube (blank tab plus `AudioFetch`), and everything else, which `SafeFetcher` (`safe_fetch.py`) downloads and the sniffer classifies; an HTML page is searched by `pages.py` for linked score files, then `<pre>` tab blocks. `SafeFetcher` is the only way the server fetches a user-supplied URL: public addresses only (unless `FRETBOOK_ALLOW_PRIVATE_URLS`), connect to the checked address with the original `Host` and SNI, manual redirects re-checked per hop, size and deadline limits. A new site (Ultimate Guitar) is a new `Provider` plus a branch in `_import_link`.

## Background jobs

Imports run on a single job thread in the web process, reading the `jobs` table. Slow, GPU-bound work (such as recognising tabs in video frames, `fretbook/importers/youtube_frames.py`) should run as a separate worker that claims only its own job kind from the same table, and land its result as a draft for review in the editor. The design is in [design/youtube-tab-import.md](design/youtube-tab-import.md).

## Listening to the microphone

`web/src/lib/listen/` is the pitch-detection engine for tuner, wait mode and scored play. `engine.ts` (`PitchEngine`) is pure DSP with no browser APIs: it takes audio blocks and returns `{time, frequency, clarity, midi, cents, onset, onsetTime}` events. It combines an MPM pitch detector (`mpm.ts`, FFT autocorrelation, a window of about 85 ms at 48 kHz so B0 at 31 Hz fits) and a spectral-flux onset detector (`onset.ts`) that also confirms a steady pitch change for legato. An expected note can be supplied to resolve octave errors. `processor.ts` runs the engine in an `AudioWorklet` (bundled as its own module through `?worker&url`) and `input.ts` is the main-thread side: device list, `getUserMedia` with echo cancellation, noise suppression and auto gain off, channel selection, level meter and the "not HTTPS / not allowed" problems. `harness/` holds the plucked-string synthesizer, WAV reader and the accuracy test (`accuracy.test.ts`, which prints a report); committed fixtures are in `fixtures/`.

## Tuner

`TunerSheet.svelte` is a sheet opened from the song page (preloaded with the track's `tuning_midi` and capo through `ui.tunerRequest`) or from the top bar (chromatic plus the presets in `web/src/lib/tuner.ts`). It reads pitch events from `startListening`, but recomputes note and cents itself from the event's frequency so the A4 slider (432 to 446 Hz) needs no restart. `lib/tuner.ts` holds the pure logic (nearest string, needle position, `PitchSmoother`: median filter with a dropout hold, a ±1.5 cent dead zone, `TuneTracker`: a string within ±3 cents for 1 s counts as tuned and the sheet shows All strings in tune, the success chime, the sine reference tone). The sheet lays the strings out as a headstock (low strings left, high right) with an Auto toggle that, when off, locks to the tapped string. Nothing leaves the browser.

## Wait mode

`web/src/lib/listen/wait.ts` is the pure part. `buildWaitSteps` walks the chosen track in played order (repeats and jumps expanded, as in `playback.ts`) and returns one step per beat the player has to play: expected pitch is `tuning_midi[string] + capo + fret`, tied notes, rests and grace notes are skipped, dead notes accept any attack, voices on the same beat are merged, and a chord accepts any one of its notes (chords get their own issue). `WaitMatcher` consumes `PitchEvent`s: an attack after the cursor stopped (with 80 ms of grace for latency) arms it, and a reading within 40 cents of the expected note within 300 ms of that attack is a hit, in any octave unless the option says otherwise. Needing a fresh attack keeps a ringing previous note, or the same note twice, from counting twice. `waitRun.ts` owns the microphone session, tells the engine the expected note, and runs the hint timer.

`TabPlayer.svelte` wires it to alphaTab's synth: on `playedBeatChanged` it looks the beat up by played bar and `displayStart` (ticks match the score document) and, if it is a step, pauses; a hit calls `play()`. The chosen track is muted in the synth at runtime (not saved with the mix). Wait mode is for the synth only, never a recording, because stopping a recording at every miss does not work. The synth also loops A to B now, which only audio playback did before. Wait options are saved per song with the practice settings; whether it is on is not, since it needs a click to open the microphone. The end-to-end test plays a rendered WAV through Chromium's fake microphone (`--use-file-for-fake-audio-capture`); the file loops, and wait mode waits, so it passes from any point in the loop.

## Fretboard

`web/src/components/Fretboard.svelte` only draws: it takes the tuning (4 to 8 strings), capo, fret count, the notes lit now and the faded upcoming ones, a label mode and a handedness flag, so the tuner, wait mode and trainers can reuse it. `web/src/lib/fretboard.ts` holds the pure parts: `buildFretEvents` (beats of a track in played order), `focusAt` (current and next notes at a bar and tick), `positionInBar` (a recording's clock to ticks), fret spacing and the dot labels. Frets count from the capo, so the capo is the nut. The options live in the per-song practice settings (`fretboard`).
