# Reverse proxy and HTTPS

Put Fretbook behind a reverse proxy when you reach it from other devices. **HTTPS is not optional if you want the
microphone**: browsers only allow microphone access on HTTPS pages and on `localhost`. The tuner, wait mode, the
scored play-along modes and latency calibration all need it. Over plain `http://` on another machine they are
blocked and Fretbook says so. (A quick alternative for one machine is an SSH tunnel to `http://localhost`.)

Audio never leaves the browser, and echo cancellation, noise suppression and auto gain are turned off because they
damage instrument sound.

## What every proxy must do

1. **Forward the original `Host` header.** Fretbook refuses a write (`POST`, `PUT`, `DELETE`) from a browser when
   the `Origin` host differs from the `Host` it received. A proxy that rewrites `Host` to the upstream's name
   makes every save fail with "cross-site requests are not allowed".
2. **Send `X-Forwarded-Proto: https`.** Session cookies are `Secure` and redirect URLs are built from it.
3. **Tell Fretbook which proxy to trust.** It only believes `X-Forwarded-*` from the addresses in
   `FRETBOOK_FORWARDED_ALLOW_IPS` (default `127.0.0.1`, a proxy on the same host). Set it to your proxy's address.
   Never use `*` on a port that clients can reach directly.
4. **Allow big request bodies.** The default upload limit is 80 MB (`FRETBOOK_MAX_UPLOAD_BYTES`) and a library
   restore accepts up to 4 GiB (`FRETBOOK_MAX_RESTORE_BYTES`). Many proxies stop well short of that.
5. **Not add its own login in front of `/api/health`** if your orchestrator probes it.

If the proxy and Fretbook are containers on one Docker network, give the network a fixed subnet and the proxy a
fixed address, so the value of `FRETBOOK_FORWARDED_ALLOW_IPS` does not change when containers restart:

```yaml
services:
  fretbook:
    image: ghcr.io/liftedkilt/fretbook:0.1.3
    environment:
      FRETBOOK_FORWARDED_ALLOW_IPS: "172.30.0.10" # the proxy's address below
    networks: [web]
  proxy:
    # Caddy, Traefik, nginx ... see below
    networks:
      web:
        ipv4_address: 172.30.0.10

networks:
  web:
    ipam:
      config:
        - subnet: 172.30.0.0/24
```

## Caddy

Caddy keeps `Host`, sets `X-Forwarded-Proto` and gets a certificate on its own. Its default request body limit is
unlimited, so nothing else is needed.

```caddyfile
fretbook.example.com {
    reverse_proxy fretbook:8137
}
```

## Traefik

Labels on the Fretbook service (Traefik v3, with a `websecure` entry point and a `letsencrypt` resolver defined in
its static configuration):

```yaml
  fretbook:
    image: ghcr.io/liftedkilt/fretbook:0.1.3
    labels:
      - traefik.enable=true
      - traefik.http.routers.fretbook.rule=Host(`fretbook.example.com`)
      - traefik.http.routers.fretbook.entrypoints=websecure
      - traefik.http.routers.fretbook.tls.certresolver=letsencrypt
      - traefik.http.services.fretbook.loadbalancer.server.port=8137
```

Traefik preserves `Host` and sets `X-Forwarded-Proto`. It has no request body limit unless you add a `buffering`
middleware, so do not add one with a small `maxRequestBodyBytes`.

## nginx

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name fretbook.example.com;

    ssl_certificate     /etc/letsencrypt/live/fretbook.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/fretbook.example.com/privkey.pem;

    # The default is 1 MB, which breaks every upload. Match FRETBOOK_MAX_UPLOAD_BYTES, or use 4g to allow restores.
    client_max_body_size 4g;

    location / {
        proxy_pass http://127.0.0.1:8137;
        proxy_set_header Host $http_host;          # keep the port if there is one
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;                   # large archive downloads and restores
        proxy_request_buffering off;               # stream big uploads instead of spooling them to disk first
    }
}
```

Use `$http_host` rather than `$host`: `$host` drops the port, and a browser's `Origin` includes it.

## Zoraxy

!!! note
    These notes were written from Zoraxy's documented options and have not been tested against a running
    Zoraxy. Corrections are welcome as an issue.

Create a proxy rule for `fretbook.example.com` pointing at `fretbook:8137` (or the container's address), with TLS
terminated by Zoraxy. Keep Zoraxy from rewriting the `Host` header to the target (leave "rewrite host header"
off), and make sure `X-Forwarded-Proto` is sent. Then set `FRETBOOK_FORWARDED_ALLOW_IPS` to Zoraxy's address as
seen by Fretbook.

## Serving under a sub-path

To serve Fretbook at `https://home.example.com/fretbook/`, strip the prefix in the proxy and tell Fretbook what it
is:

```yaml
    environment:
      FRETBOOK_ROOT_PATH: "/fretbook"
```

```caddyfile
home.example.com {
    handle_path /fretbook/* {
        reverse_proxy fretbook:8137
    }
}
```

The proxy must remove `/fretbook` before forwarding (Caddy's `handle_path` does); Fretbook adds it back to the
links it generates. With sign-in on, the redirect URI includes the prefix:
`https://home.example.com/fretbook/auth/callback`. A dedicated host name is simpler and avoids this.

## Checking it works

1. `https://fretbook.example.com/api/health` answers `{"ok": true, "name": "Fretbook", ...}`.
2. In the app, add a blank song and save it. A 403 "cross-site requests are not allowed" means the `Host` header
   is being rewritten.
3. Upload a file larger than 1 MB. A 413 from the proxy means its body limit is too low.
4. Open the tuner. The browser should ask for the microphone. If it says the page is not secure, you are on HTTP.
