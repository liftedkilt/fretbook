# Scripts and the command line

## API tokens

Every user can make personal API tokens in **Settings → API tokens** (in single-user mode too). A token is shown once;
Fretbook keeps only a hash. It can expire, shows when it was last used, and stops working the moment you revoke it.

Send it as `Authorization: Bearer <token>` on any `/api` route, in both auth modes. A token acts as its owner, so it
reaches the owner's library and, with sign-in on, the admin routes only if the owner is an admin. It cannot create or
revoke tokens; that takes a signed-in session. The API is described by
[`openapi.json`](https://github.com/liftedkilt/fretbook/blob/main/openapi.json).

### Forward-auth proxies

When Fretbook sits behind a forward-auth proxy (such as oauth2-proxy, Authelia or Authentik forward auth, or Zoraxy SSO),
the proxy answers first. It will reject requests carrying `fb_` bearer tokens with a `302` redirect to the identity
provider or `401 Unauthorized`, because the proxy only accepts its own session cookie or an identity token it can verify.

To use API tokens in this setup:

- **Prefer Fretbook's native OIDC:** If you use an identity provider, configure Fretbook's own
  [Sign-in with OIDC](../self-hosting/oidc.md) instead of an external auth proxy. Fretbook validates both web sessions and
  API tokens natively, so tokens work without proxy workarounds.
- **Bypass `/api/` at the proxy:** Tell the proxy to skip authentication for `/api/` (for example, oauth2-proxy
  `--skip-auth-route=^/api/`) and let Fretbook handle API authentication. Note that this requires Fretbook's OIDC mode: in
  single-user mode, skipping auth on `/api/` leaves the API completely unprotected.
- **Dedicated API hostname:** Route a separate hostname (such as `api.fretbook.example.com`) directly to Fretbook without
  the forward-auth layer.

See [Forward-auth proxies and API tokens](../self-hosting/reverse-proxy.md#forward-auth-proxies-and-api-tokens) for
configuration examples and security trade-offs.

## `fretbook.cli`

`fretbook-cli` wraps the common calls. Run `pip install .` in a checkout to put it on your path (the Docker image
has no console script; use `python -m fretbook.cli` there, as below). It needs only Python, no extra packages, and reads `FRETBOOK_URL` (default `http://localhost:8137`) and `FRETBOOK_TOKEN`:

```sh
export FRETBOOK_URL=https://fretbook.example.com FRETBOOK_TOKEN=fb_...
fretbook-cli import song.gp5 https://www.songsterr.com/a/wsa/... ~/tabs   # files, links, and folders
fretbook-cli import --recursive --no-wait ~/tabs
fretbook-cli list "blue"                                                  # or: list --json
fretbook-cli export <song id> -f musicxml -o song.musicxml                # json (default), musicxml, midi, chordpro
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
cd ~/tabs/incoming || exit 1
for f in *.gp *.gp3 *.gp4 *.gp5 *.gpx; do
  [ -e "$f" ] || continue
  /opt/fretbook/.venv/bin/fretbook-cli import "$f" && mv "$f" ../imported/
done
```

If the files land on a share the server can see, a [watched inbox folder](inbox.md) needs no script at all.
