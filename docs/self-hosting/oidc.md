# Sign-in with OIDC

Without sign-in, Fretbook is a single-user server with one shared library. Setting `FRETBOOK_OIDC_ISSUER` turns on
sign-in through any OpenID Connect provider: each person gets a private library, and admins also get a **Users**
page.

!!! note "Tested provider"
    Pocket ID is the provider Fretbook is developed against. The Authelia, Authentik and Keycloak sections below
    follow those products' documentation and the claims Fretbook reads, but have **not been tested end to end**.
    If a step is wrong for your version, please open an issue.

## How Fretbook uses the provider

- It signs people in with the authorization-code flow and PKCE, and checks the ID token's signature, issuer,
  audience, expiry and nonce.
- Roles come from a **groups claim**. Members of `FRETBOOK_OIDC_ADMIN_GROUP` (default `fretbook_admins`) are admins.
  Members of `FRETBOOK_OIDC_USER_GROUP` (default `fretbook_users`) are users. Anyone in neither is refused at the
  callback. Set the user group to an empty string to admit everyone the provider signs in.
- The claim is named by `FRETBOOK_OIDC_GROUPS_CLAIM` (default `groups`), read from the ID token or, if it is
  missing there, from the userinfo endpoint. It may be a JSON list of names or a single comma- or
  space-separated string. Group **names must match exactly**, so a provider that sends `/fretbook_users` (a path)
  does not match `fretbook_users`.
- Roles are read at each sign-in. A group change applies at the person's next sign-in; an admin can end that
  person's sessions on the Users page to apply it now.
- The callback URL always comes from `FRETBOOK_OIDC_REDIRECT_URI`, never from request headers. It must be
  `https://<your host>[/prefix]/auth/callback`, and registered with the provider exactly.

## Settings

```yaml
environment:
  FRETBOOK_OIDC_ISSUER: "https://id.example.com"
  FRETBOOK_OIDC_CLIENT_ID: "<client id>"
  FRETBOOK_OIDC_CLIENT_SECRET: "<secret, or leave out for a public client>"
  FRETBOOK_OIDC_REDIRECT_URI: "https://fretbook.example.com/auth/callback"
  FRETBOOK_SESSION_SECRET: "<openssl rand -hex 32>"
  FRETBOOK_FORWARDED_ALLOW_IPS: "<your reverse proxy's address>"
```

Behind a proxy, also follow [Reverse proxy and HTTPS](reverse-proxy.md). Every page, asset and API route except
`/api/health` then needs a session; a browser without one is sent to the provider and returns to the page it asked
for. Optional: `FRETBOOK_OIDC_POST_LOGOUT_REDIRECT_URI` (must be registered with the provider),
`FRETBOOK_OIDC_SCOPES` (default `openid profile email groups`) and `FRETBOOK_SESSION_MAX_AGE`.

The same two groups work for every provider: create `fretbook_users` and `fretbook_admins`, put people in them, and
make the provider send the group names in the claim.

## Pocket ID

1. **Administration → User Groups**: create `fretbook_users` and `fretbook_admins`, and add people. Admins do not
   also need to be in `fretbook_users`.
2. **Administration → OIDC Clients → Add OIDC Client**: name it Fretbook and set the callback URL to
   `https://fretbook.example.com/auth/callback`. Turn on **Public client** for PKCE without a secret, or keep the
   generated secret. Optionally restrict the client to the two groups.
3. Optionally add a logout callback URL such as `https://fretbook.example.com/` and set the same value in
   `FRETBOOK_OIDC_POST_LOGOUT_REDIRECT_URI`.
4. Set the environment variables above. The issuer is your Pocket ID URL. Pocket ID puts `groups` in the ID token and
   supports the `groups` scope, so the defaults work.

## Authelia

1. Define groups `fretbook_users` and `fretbook_admins` in your Authelia users file or LDAP backend.
2. Add a client under `identity_providers.oidc.clients` (Authelia 4.38 syntax):

    ```yaml
    - client_id: fretbook
      client_name: Fretbook
      public: true                    # PKCE only; or set client_secret and public: false
      authorization_policy: two_factor # or one_factor
      redirect_uris:
        - https://fretbook.example.com/auth/callback
      scopes: [openid, profile, email, groups]
      require_pkce: true
      pkce_challenge_method: S256
    ```

3. The issuer is your Authelia URL (for example `https://auth.example.com`). Authelia returns group names in the
   `groups` claim. Newer releases keep some claims out of the ID token unless a claims policy asks for them; Fretbook
   then reads `groups` from the userinfo endpoint, so either arrangement works.

## Authentik

1. **Directory → Groups**: create `fretbook_users` and `fretbook_admins` and add users.
2. **Applications → Providers → Create → OAuth2/OpenID Provider**: client type _Public_ (or _Confidential_ with a
   secret), redirect URI (strict) `https://fretbook.example.com/auth/callback`, and the default signing key.
   Create an application that uses the provider. To restrict access, bind the two groups to the application.
3. The issuer is the provider's **OpenID Configuration Issuer**, which includes the application slug, for example
   `https://authentik.example.com/application/o/fretbook/`. Use it exactly, trailing slash included.
4. Authentik's built-in `profile` scope mapping includes a `groups` claim with the group names, and it has no scope
   called `groups`. Ask only for the scopes that exist:

    ```yaml
    FRETBOOK_OIDC_SCOPES: "openid profile email"
    ```

## Keycloak

1. Create the groups `fretbook_users` and `fretbook_admins` and add users.
2. **Clients → Create client**: OpenID Connect, client authentication off (public, PKCE) or on (secret). Set
   _Valid redirect URIs_ to `https://fretbook.example.com/auth/callback`. For PKCE, under _Advanced_ set _Proof Key
   for Code Exchange Code Challenge Method_ to `S256`.
3. Keycloak does not send groups by default. Open the client's dedicated scope (**Client scopes →
   fretbook-dedicated → Add mapper → By configuration → Group Membership**), name the claim `groups`, turn **Full
   group path** **off** (otherwise the names arrive as `/fretbook_users` and never match), and keep _Add to ID token_
   on.
4. The issuer includes the realm: `https://keycloak.example.com/realms/<realm>`. There is no `groups` scope in a
   default realm, so request:

    ```yaml
    FRETBOOK_OIDC_SCOPES: "openid profile email"
    ```

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Refused at the callback after a successful provider login | The person is in neither group, or the claim carries different names (paths, another case) or sits under another claim name (`FRETBOOK_OIDC_GROUPS_CLAIM`). |
| Provider says the redirect URI is invalid | The URI registered there differs from `FRETBOOK_OIDC_REDIRECT_URI`, including a prefix from `FRETBOOK_ROOT_PATH`, `http` versus `https`, or a trailing slash. |
| Provider rejects the request for an unknown scope | Remove `groups` with `FRETBOOK_OIDC_SCOPES`. |
| Login loops or cookies are dropped | The proxy is not sending `X-Forwarded-Proto: https`, or `FRETBOOK_FORWARDED_ALLOW_IPS` does not include the proxy. |
| Signs in, but saving gives 403 | The proxy rewrites `Host`. See [Reverse proxy](reverse-proxy.md). |

## Good to know

- Each user's library is private. Songs from single-user mode (and bass-tab-sync imports) belong to no signed-in user;
  an admin can move them into their own library from the Users page.
- Each person makes their own API tokens under **Settings → API tokens**; see
  [Scripts and the command line](../guides/cli.md). A token keeps working after its owner is signed out. Fretbook
  only learns about group membership when someone signs in: when a person removed from the provider group tries to
  sign in and is refused, Fretbook ends their sessions and refuses their tokens until they sign in successfully again
  (the tokens are kept, not deleted). Until that attempt a removed person's token still works, so the Users page shows
  each person's token count and an admin can revoke all of them
  (**Revoke API tokens**; API: `GET`/`DELETE /api/admin/users/{id}/tokens`, `DELETE .../tokens/{token_id}`). Signing
  someone out everywhere ends sessions only.
- Sessions are stored on the server (the cookie holds a random token and the database only its hash). Cookies are
  `HttpOnly`, `SameSite=Lax`, and `Secure` when the redirect URI is https.
- Report vulnerabilities as described in the
  [security policy](https://github.com/liftedkilt/fretbook/blob/main/SECURITY.md).
