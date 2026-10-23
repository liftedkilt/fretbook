# Contributing

Coding agents: read [AGENTS.md](AGENTS.md) ([CLAUDE.md](CLAUDE.md), [GEMINI.md](GEMINI.md)) first. It explains how to pick, claim, and finish an issue alongside other agents.

## Working on an issue

- Open or pick an issue before starting larger work, using the [bug report](.github/ISSUE_TEMPLATE/bug_report.yml) or [feature request](.github/ISSUE_TEMPLATE/feature_request.yml) form. Check [ROADMAP.md](ROADMAP.md) and the epic ([#84](https://github.com/liftedkilt/fretbook/issues/84)) first so work is not duplicated.
- Keep each pull request to one issue (`Closes #<N>` in the body), use Conventional Commits (`feat: …`, `fix: …`, `test: …`, `ci: …`, `docs: …`) for commit messages and PR titles, and fill in the [pull request template](.github/pull_request_template.md).
- When several people or agents work in parallel, avoid conflicts on shared files (`openapi.json`, `web/src/lib/api-types.ts`, `web/src/locales/*.json`, `fretbook/db/migrations/`, `web/src/App.svelte`, `fretbook/api/routes.py`) by following the [Hotspots](AGENTS.md#hotspots) table in [AGENTS.md](AGENTS.md).

## Development setup

Python 3.12, Node 22, and ffmpeg (only for downloading YouTube audio).

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
cd web && npm ci
```

For UI work, run the API with `.venv/bin/python -m fretbook` and `cd web && npm run dev` (Vite proxies `/api`).

## Checks

CI runs the same commands:

```sh
.venv/bin/ruff check fretbook tests
.venv/bin/python -m pytest
.venv/bin/python -m fretbook.openapi --check
cd web && npm run api-types:check && npm run check && npm test && npm run build
```

The `repo-checks` CI job also runs two cheap guards you can run locally:

```sh
python scripts/check_migrations.py   # no duplicate or skipped numbers in fretbook/db/migrations/
python scripts/check_locales.py      # locale files are valid JSON, LF, one trailing newline, same top-level key order
```

If another pull request took your migration number, `check_migrations.py` fails with the duplicate; rebase on `main` and rename your file to the next free number.

### End-to-end tests

Playwright drives Chromium against a real `python -m fretbook` that serves the built web app. Each test starts its own server on a free port with an empty temporary data directory and seeds it through the API. The suite is in `web/e2e/` and takes about 15 seconds locally; CI runs it as the `e2e` job and uploads traces and videos when it fails.

```sh
cd web
npm run e2e:install   # once: downloads Chromium
npm run e2e           # builds the web app, then runs the suite
```

`npm run e2e:run` skips the build, and `npx playwright test --ui` opens the trace viewer. See [web/README.md](web/README.md#end-to-end-tests) for how to add a test.

The Python tests fail on an unclosed database connection, and check that the English catalog has every error and progress key the server sends. A Vitest test checks that every locale has every key the UI passes to `t()`, and that the locale files share the same keys.

## CI and branch protection

`.github/workflows/ci.yml` runs `backend` (Python 3.12 and 3.13), `frontend`, `openapi`, `repo-checks`, `ui-only` and `e2e`, each with a timeout. A final `ci-ok` job `needs:` all of them and fails if any did not succeed, so it is the one check to require; add new CI jobs to its `needs:` list. A new push to a pull request cancels the superseded run (pushes to branches are never cancelled).

Suggested branch-protection settings for `main`:

- Require status checks to pass before merging: **`ci-ok`** and **`Docker / image`** (the `Docker` workflow's `image` job; it has no `ci-ok` equivalent because it is a separate workflow). Require branches to be up to date before merging.
- Require linear history, and allow only squash merging (or rebase merging).
- Do not require the individual `backend (3.12)` style checks: matrix names change, which is what `ci-ok` avoids.

## API contract

The HTTP contract is the committed `openapi.json`. Regenerate it with `python -m fretbook.openapi` (or `make openapi`) and the TypeScript types with `npm run api-types --prefix web` (or `make api-types`). CI fails if either is stale. A pull request labeled `ui-only` may only touch `web/`; the rules are in [web/README.md](web/README.md).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit together and [ROADMAP.md](ROADMAP.md) for what is planned.

## Dependency updates

Dependabot (`.github/dependabot.yml`) checks for updates across Docker base images, GitHub Actions, npm dependencies (`web/`), and Python packages (`requirements.txt`). Updates are grouped weekly to limit PR noise, except `yt-dlp` which checks daily because YouTube frequently breaks older extractors.

`fastapi` and `pydantic` are deliberately pinned to exact versions in `requirements.txt` to keep `openapi.json` stable. When updating either dependency, regenerate the OpenAPI contract and TypeScript types (`make openapi api-types`) and commit the updated `openapi.json` and `web/src/lib/api-types.ts`.


## Adding a locale

English (`en`) and Brazilian Portuguese (`pt-BR`) live in `web/src/locales/`. The UI reads them through `t()` in `web/src/lib/i18n.svelte.ts`. `<html lang>` follows the active locale.

1. Copy `web/src/locales/en.json` to `web/src/locales/<tag>.json`. Use a BCP 47 tag, such as `fr` or `es-MX`.
2. Translate every string. Keep `{placeholder}` names unchanged. A plural value is an object: include `other` and the categories `Intl.PluralRules` returns for that locale (English uses `one` and `other`).
3. Import the file in `web/src/lib/i18n.svelte.ts`, add it to `catalogs`, and add a `locales` entry (`id` is the tag, `labelKey` is the language's own name, the same text in every catalog, such as `language.fr`).
4. From `web/`, run `npm test`. The catalog test fails if any locale is missing a key the UI passes to `t()`, or if the locale files do not share the same keys and placeholders. It also fails if a new JSON file is not registered on the switcher.

An exact browser tag wins (`pt-BR`). A tag that only shares the language (`pt`, `pt-PT`) uses the first catalog of that language. The choice is stored in `localStorage` under `fretbook.locale`. Server errors and import progress use the same catalogs (`errors.*` and `import.*`).
