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
6. **Leave share links reachable** when `FRETBOOK_SHARE_LINKS=true`. The proxy must allow unauthenticated
   `GET` of `/share/` and `/api/share/`. Those routes answer 404 until the flag is on, and a login wall in
   front of them defeats the link.
7. **Pass API tokens through to `/api`** if you put an external auth proxy in front of Fretbook. Forward-auth proxies
   (oauth2-proxy, Authelia, Authentik) intercept bearer tokens and break scripts and the CLI. See
   [Forward-auth proxies and API tokens](#forward-auth-proxies-and-api-tokens).

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

## Forward-auth proxies and API tokens

If you place a forward-auth proxy (such as oauth2-proxy, Authelia or Authentik forward auth, or Zoraxy with SSO) in front
of Fretbook, the proxy inspects every incoming request before Fretbook sees it.

When using personal API tokens (`Authorization: Bearer fb_...`) with [the CLI or scripts](../guides/cli.md), the forward-auth
proxy fails to recognize the token and responds with a `302` redirect to the identity provider's login page or `401 Unauthorized`.
Fretbook never sees the request.

### Prefer Fretbook's native OIDC

If you run an identity provider (such as Pocket ID, Authelia, Authentik, or Keycloak), the cleanest and most robust setup
is to use Fretbook's built-in [Sign-in with OIDC](oidc.md) instead of an external auth proxy.

With native OIDC:

- Reverse proxies (Caddy, Traefik, nginx) act as standard reverse proxies with no auth proxy layer.
- Fretbook manages web browser authentication and redirects unauthenticated browser requests to your provider.
- Requests with `Authorization: Bearer fb_...` bypass the OIDC flow and are validated directly by Fretbook.
- Personal API tokens work with no extra proxy configuration.

### Keeping a forward-auth proxy

If you keep a forward-auth proxy in front of Fretbook (for example, to enforce centralized SSO policies across all
services), you have two options for allowing API tokens through.

#### Option 1: Bypass `/api/` at the proxy

Configure the forward-auth proxy to skip authentication on `/api/` and forward those requests directly to Fretbook. Fretbook's
own authentication backend then guards the API.

- **oauth2-proxy**:
  Pass `--skip-auth-route="^/api/"` (or `--skip-auth-regex="^/api/"`, or in the configuration file `skip_auth_routes = ["^/api/"]`).
  If share links are enabled (`FRETBOOK_SHARE_LINKS=true`), also include `/share/`:
  ```ini
  skip_auth_routes = [
      "^/api/",
      "^/share/"
  ]
  ```
- **Authelia**:
  Add an access control bypass rule in `configuration.yml` under `access_control.rules`:
  ```yaml
  access_control:
    rules:
      - domain: fretbook.example.com
        resources:
          - "^/api/.*$"
        policy: bypass
  ```
- **Authentik**:
  In the Authentik Proxy Provider under **Advanced protocol settings**, add `^/api/.*` to **Unauthenticated paths**.
- **nginx with `auth_request`**:
  Omit `auth_request` in the `/api/` location block (or set `auth_request off;`):
  ```nginx
  location /api/ {
      auth_request off;
      proxy_pass http://127.0.0.1:8137;
      # ... proxy headers ...
  }
  ```

**Security trade-offs:**

- **With Fretbook OIDC enabled (`FRETBOOK_OIDC_ISSUER` set):** This arrangement is safe. Fretbook inspects every `/api`
  request: calls without a valid `fb_` bearer token or active Fretbook session cookie return `401 Unauthorized`. Admin routes
  still require an admin token or admin session.
- **In single-user mode (no `FRETBOOK_OIDC_ISSUER`):** ⚠️ **High risk.** In single-user mode, Fretbook has no built-in login
  and treats unauthenticated requests as the owner of the library. If you bypass `/api/` at the proxy in single-user mode,
  **anyone who can reach your server can read, modify, or delete songs without authenticating**. Only bypass `/api/` in single-user
  mode if access to the server is restricted to a private network, VPN, or client certificate.
- **Token brute-force defense:** Bypassing the proxy means API authentication requests reach Fretbook directly. If your proxy
  provides rate limiting or abuse prevention, ensure rate limits still apply to `/api/`.

#### Option 2: Serve a dedicated API hostname

Expose a secondary hostname (such as `api.fretbook.example.com`) that routes directly to Fretbook without the forward-auth
proxy, while keeping `fretbook.example.com` behind the auth proxy for browser access.

**Security trade-offs:**

- Keeps browser SSO strictly enforced on the primary web hostname.
- Allows separate firewall, VPN, IP allowlisting, or rate-limiting rules on the API hostname.
- As with Option 1, Fretbook OIDC should be enabled so requests to the API hostname without an API token cannot access the library anonymously.
- Requires configuring an additional DNS record and TLS certificate.

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
