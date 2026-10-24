# Getting started

## With Docker

```sh
git clone https://github.com/liftedkilt/fretbook && cd fretbook
docker compose up --build
```

Open `http://localhost:8137`. The database and audio live in the `fretbook-data` volume. A `./songs` folder is
mounted read-only for bass-tab-sync imports; leave it empty if you have none.

Prebuilt images for amd64 and arm64 are on GHCR. Each release `vX.Y.Z` gets the tags `X.Y.Z` and `X.Y`; every
push to `main` gets `latest`, `main` and `sha-<commit>`. Pin a release for a server you care about:

```sh
docker pull ghcr.io/liftedkilt/fretbook:0.1.3
```

See [Docker Compose](self-hosting/docker-compose.md) for a compose file that uses the published image.

## Without Docker

You need Python 3.12, Node 22, and ffmpeg (only for downloading YouTube audio).

```sh
./run.sh            # creates .venv, builds the web app, starts on http://127.0.0.1:8137
```

For development, see [CONTRIBUTING.md](https://github.com/liftedkilt/fretbook/blob/main/CONTRIBUTING.md).

## First steps

An empty library opens on a welcome with the ways to start, including **Add the demo songs**: three original songs
(a bass tab with audio and sync, a guitar tab and a chord sheet) to try the player first. See
[Demo library and demo mode](guides/demo.md).

1. Press **Add** and drop a Guitar Pro, MusicXML or MIDI file, paste a Songsterr or Ultimate Guitar link, or paste
   ASCII tab. See [Importing songs](guides/importing.md).
2. Open the song and press Space to play. See [Playing and syncing](guides/playing.md).
3. Put the server on your network behind HTTPS if you want to practise from a phone or tablet with the
   microphone: [Reverse proxy and HTTPS](self-hosting/reverse-proxy.md).

!!! warning "No login by default"
    Without `FRETBOOK_OIDC_ISSUER` there is no sign-in: anyone who can reach the port can use and change the
    library. Keep it on a trusted network, behind an authenticating proxy, or turn on
    [OIDC sign-in](self-hosting/oidc.md).
