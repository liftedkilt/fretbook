# Bands and share links

A song lives in a library. Yours is private. A band is a library you share with other people who already have
accounts on this server. A share link is different: one song, read only, and no account required.

## Bands

Open **Bands** (in the sidebar, or **Bands** next to the library switcher). Name the band and create it. You
become an editor. Editors can rename the band, add members, and delete it once it has no songs. The last editor
cannot leave or be changed to view only.

Add a member with the email they sign in with. The address has to match one account exactly. Members are listed
by name, not by email. **View** can open the songs and log practice. **Edit** can change them, and can manage the
band. A person who is not a member cannot see that the band or its songs exist.

The switcher at the top of the library chooses which library you are looking at. New blank songs are created in
the library you have selected. Imports stay in your personal library. On a song you can edit, **Copy or move** in the song's **⋯** menu
sends it to another library you can edit. A copy is a new song. A move keeps the same song and its files.

Your personal backup is still your own library. It does not include band songs. An administrator's export of
everything does include them.

## Share links

Share links are off until the server is started with `FRETBOOK_SHARE_LINKS=true`. They are off by default because
a deployment may sit behind a proxy that is supposed to require a login for every page. When you turn them on,
that proxy has to allow unauthenticated requests to `/share/` and `/api/share/`. See
[Reverse proxy and HTTPS](../self-hosting/reverse-proxy.md).

An editor opens the song and chooses **Share** in the song's **⋯** menu. Fretbook shows the full link once. It stores only a hash of
the token, which is long and random and starts with `sh_`. You can set a lifetime in days, or leave it blank.
**Revoke** stops the link immediately. A revoked, expired, or unknown link all look the same to a visitor: the
song is not available. There is a limit of 20 active links per song.

The public page plays the song. It does not include your notes, tags, or the real song id, and it has no editor,
no sync marks, and no way to change the song. Responses are marked not to be stored or indexed.
