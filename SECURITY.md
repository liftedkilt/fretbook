# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately, not in a public issue or pull request.

Use GitHub's private reporting: **Security → Report a vulnerability** on
<https://github.com/liftedkilt/fretbook/security/advisories/new>. Include the version
(shown in the app, or the image tag), how you run Fretbook (single-user or with sign-in),
and steps or a proof of concept that reproduce the problem.

You can expect an acknowledgement within a week. We will agree a fix and disclosure
date with you, and credit you in the release notes unless you prefer not to be named.
Fretbook is maintained by volunteers, so there is no bounty.

## Supported versions

Only the latest release and `main` receive fixes.

## In scope

- **Authentication and sessions**: OIDC sign-in, session cookies, CSRF / `Origin` checks.
- **Multi-user isolation**: one user reading, changing, or deleting another user's songs, media, jobs, or settings.
- **File upload parsing**: MusicXML, ChordPro, Fretbook JSON and audio uploads, including oversize bodies, XML entity expansion, decompression bombs, and path traversal in file names.
- **SSRF in URL imports**: YouTube and other URL imports reaching internal addresses, or the server fetching URLs the user should not control.
- Path traversal or arbitrary file read/write on the server's data directory.

## Out of scope

- Single-user mode without sign-in: anyone who can reach the port has full access by design. Run it on a trusted network or behind an authenticating proxy.
- Vulnerabilities in third-party dependencies with no demonstrated impact on Fretbook (report those upstream; Dependabot, `pip-audit`, and `npm audit` track them here).
- Denial of service by an authenticated user with legitimate quota, and attacks that need physical access or a compromised host.
- Missing security headers or best-practice hardening without a concrete exploit.

## How we check

CI runs CodeQL (Python and JavaScript/TypeScript), `pip-audit` on `requirements.txt`, and
`npm audit --omit=dev --audit-level=high` on every pull request, and Dependabot proposes dependency updates.
