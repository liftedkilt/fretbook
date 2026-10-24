# Song details and cover art

Every song can carry a few details beside its title and artist. Open a song and press **Edit details**.

| Detail | What it is |
| --- | --- |
| **Key** | One of the 24 major and minor keys. Left on *automatic*, it is detected from the score. |
| **Genre**, **Album**, **Year** | Free text (a four-digit year). |
| **Notes** | Your own notes in Markdown: `**bold**`, `*italic*`, `` `code` ``, headings, lists and `http(s)` links. Raw HTML is shown as text. |
| **Cover art** | A PNG, JPEG or WebP image up to 5 MB. Without one, the app draws a cover from the song. |

The details show on the song page and, for key and genre, on the library cards. The library has **Key** and **Genre** menus that filter through the server, next to the difficulty and tag filters. They only appear once a song has a key or a genre. A song's [difficulty](playing.md) is estimated automatically; nothing here changes it.

Saving details does not change the song's revision, so it never conflicts with an edit made in the tab editor. Details are part of the [library backup](../self-hosting/backups.md): the cover art, genre, album, year, notes and a key you chose come back on restore.

## How the key is found

For a tab, Fretbook counts how long each of the twelve pitch classes sounds in the preferred track (dead notes skipped, capo included) and compares that with the Krumhansl-Schmuckler major and minor key profiles. The best of the 24 wins. A score with fewer than eight sounding notes has no key. For a chord sheet, the key is the one its `{key: ...}` directive names. Without the directive it is estimated from the chords: each of the 24 keys scores a point for every chord whose notes are all in its scale and another for every tonic chord, and the first and last chords count extra when they are the tonic (which separates a major key from its relative minor). A sheet with fewer than three chords, or a tie, has no key, and a `{capo}` is added to the result. A key you pick always wins over the detected one, and picking *automatic* again brings the detected key back. Songs saved before this feature get their key the first time the server starts.

## Looking details up online

Set `FRETBOOK_METADATA_LOOKUP=true` to show a **Look up online** button in the details sheet. It sends the song's artist and title to [MusicBrainz](https://musicbrainz.org) and then asks the [Cover Art Archive](https://coverartarchive.org) for the front cover of the release it found. It fills in an empty album, an empty year and a missing cover, and never replaces what you set. It is off by default because it sends your song names to those services. The requests go through the same SSRF-safe fetcher as pasted links, at most one a second, and downloaded images are accepted only when they are really PNG, JPEG or WebP.
