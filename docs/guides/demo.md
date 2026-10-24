# Demo library and demo mode

## The demo songs

A new library shows a welcome with the ways to get started. One of them adds three songs that ship with Fretbook, so
you can try the player before you import anything:

| Song | What it is |
| --- | --- |
| Walking Home | A four-bar bass tab with audio and sync points, so the backing track follows the score. |
| Open String Riff | A four-bar guitar tab around the open strings. |
| Porch Light | A chord sheet with a verse and a chorus. |

All three were written for Fretbook and are released under CC0. Adding them twice does nothing. **Settings → Demo
songs** removes them again; songs you made or imported are never touched. The same is available on the API:
`GET`, `POST` and `DELETE /api/demo`.

## A public demo instance

Set `FRETBOOK_DEMO_MODE=true` to run a read-only demo, for example behind a link on a project page.

- The library is reset to the demo songs when the server starts and every night at 03:00 UTC. Anything else in it is
  deleted, so never point demo mode at a real library.
- Every write to `/api` is refused with `403 demo.readOnly`: imports, uploads, edits, deletes, tags, setlists, API
  tokens and backups. Visitors can still open songs, play, change their default instrument, and record practice and
  lesson progress; the reset clears those too (practice log, lesson progress, setlists and the default instrument).
- The web app shows a notice and hides the **New** buttons. Other controls that change the library (delete, star,
  tags, the editor, setlists, restore) still show and answer with the read-only message.

Demo mode is meant for single-user mode (no sign-in). Run it with its own `FRETBOOK_DATA_DIR`.
