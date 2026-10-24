# Scripts and the command line

## API tokens

Every user can make personal API tokens in **Settings → API tokens** (in single-user mode too). A token is shown once;
Fretbook keeps only a hash. It can expire, shows when it was last used, and stops working the moment you revoke it.

Send it as `Authorization: Bearer <token>` on any `/api` route, in both auth modes. A token acts as its owner, so it
reaches the owner's library and, with sign-in on, the admin routes only if the owner is an admin. It cannot create or
revoke tokens; that takes a signed-in session. The API is described by
[`openapi.json`](https://github.com/liftedkilt/fretbook/blob/main/openapi.json).

## `fretbook.cli`

`python -m fretbook.cli` (installed as `fretbook-cli` where the package is pip-installed) wraps the common calls. It
needs only Python, no extra packages, and reads `FRETBOOK_URL` (default `http://localhost:8137`) and `FRETBOOK_TOKEN`:

```sh
export FRETBOOK_URL=https://fretbook.example.com FRETBOOK_TOKEN=fb_...
python -m fretbook.cli import song.gp5 https://www.songsterr.com/a/wsa/... ~/tabs   # files, links, and folders
python -m fretbook.cli import --recursive --no-wait ~/tabs
python -m fretbook.cli list "blue"                                                  # or: list --json
python -m fretbook.cli export <song id> -f musicxml -o song.musicxml                # json (default), musicxml, midi, chordpro
```

In Docker:

```sh
docker compose exec -e FRETBOOK_TOKEN=fb_... fretbook python -m fretbook.cli --url http://localhost:8137 list
```

A folder import picks up Guitar Pro, MusicXML, MIDI, ChordPro, Fretbook JSON and `.tab` files and skips the rest.
`import` waits for each job and exits 1 if any failed.

## Example: import a folder from cron

Drop files in `~/tabs/incoming`; every night upload them and move the ones that imported:

```sh
# crontab -e
30 2 * * * FRETBOOK_URL=https://fretbook.example.com FRETBOOK_TOKEN=fb_... /opt/fretbook/import-incoming.sh
```

```sh
#!/bin/sh
# /opt/fretbook/import-incoming.sh
export PYTHONPATH=/opt/fretbook
cd ~/tabs/incoming || exit 1
for f in *.gp *.gp3 *.gp4 *.gp5 *.gpx; do
  [ -e "$f" ] || continue
  /opt/fretbook/.venv/bin/python -m fretbook.cli import "$f" && mv "$f" ../imported/
done
```

If the files land on a share the server can see, a [watched inbox folder](inbox.md) needs no script at all.
