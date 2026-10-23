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
- Errors are `{"detail": {"key", "message", "params"}}`. The web app shows `errors.<key>` from its catalog and falls back to the English message, so server errors can be translated. Job progress uses keys too.
- Schema changes are numbered SQL files in `fretbook/db/migrations/`, each applied in one transaction.

## Background jobs

Imports run on a single job thread in the web process, reading the `jobs` table. Slow, GPU-bound work (such as recognising tabs in video frames, `fretbook/importers/youtube_frames.py`) should run as a separate worker that claims only its own job kind from the same table, and land its result as a draft for review in the editor. The design is in [design/youtube-tab-import.md](design/youtube-tab-import.md).
