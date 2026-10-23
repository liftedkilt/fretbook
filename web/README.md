# Fretbook web

Svelte 5 + TypeScript UI. It talks to the FastAPI server only through `/api`, as described by the committed contract at the repository root, [`openapi.json`](../openapi.json).

## Contract

A UI change does not modify the backend. Leave `fretbook/`, `tests/`, database migrations, `Dockerfile`, and `openapi.json` alone. If a screen needs a new field or route, that is an API change: update the server, regenerate the contract and the types, and commit both files.

```sh
python -m fretbook.openapi
npm run api-types --prefix web
```

`python` is the project environment (`.venv/bin/python` locally, after `./run.sh` or `pip install -r requirements.txt`). The same OpenAPI file is written by `make openapi` and `python scripts/export_openapi.py`. `make api-types` runs the npm script.

CI regenerates both and fails when the committed files are stale:

- `API changed: run python -m fretbook.openapi and commit openapi.json`
- `API types are stale: run npm run api-types --prefix web and commit web/src/lib/api-types.ts`

`src/lib/api-types.ts` is generated. Do not edit it. `src/lib/api.ts` is the client that calls `/api`.

## Run the API for UI work

From the repository root:

```sh
.venv/bin/python -m fretbook
```

In another shell:

```sh
cd web
npm ci
npm run dev
```

Vite serves the UI at `http://127.0.0.1:5173` and proxies `/api` to `http://127.0.0.1:8137` (see `vite.config.ts`). The client uses paths under `/api`, so the same calls work through that proxy and when FastAPI serves the built app.

## Strings

Every user-visible string goes through `t()` in `src/lib/i18n.svelte.ts`. Do not hard-code copy in components. Each key must exist in every catalog under `src/locales/` (today `en.json`). Adding a language means a new JSON file, registered in `catalogs`, with the same keys as English.

`npm test` runs `src/lib/catalog.test.ts`, which fails if a `t("...")` key is missing from the English catalog. Server error and progress keys are checked by `tests/test_api.py` (`test_english_catalog_covers_server_keys`).

## Component tests

Component tests live alongside components in `src/components/*.test.ts` and use `@testing-library/svelte` and `jsdom`. The Vitest config (`vite.config.ts`) separates component tests from pure `src/lib` tests so the latter continue to run quickly in Node. API calls should be mocked with `vi.mock("../lib/api", ...)`. Jest-DOM matchers (`toBeInTheDocument`, etc.) are configured globally via `src/setupTests.ts`.

## End-to-end tests

`e2e/` holds a [Playwright](https://playwright.dev) project (Chromium only). A test gets two fixtures from `e2e/support/fixtures.ts`:

- `server`: `python -m fretbook` on a free port, with an empty temporary `FRETBOOK_DATA_DIR`, serving `web/dist`. It is stopped and its data deleted after the test, so tests never share a library and can run in parallel. `page` is already pointed at it (`page.goto("/")`).
- `seed`: creates songs through the HTTP API from the small CC0 files in [`tests/fixtures/e2e/`](../tests/fixtures/e2e/README.md): `musicXmlTab()`, `chordSheet()`, `syncedSongWithAudio()` (a Fretbook JSON with sync points plus a short WAV), and `create()` for a blank tab or chord sheet.

```sh
npm run e2e:install   # once: downloads Chromium
npm run e2e           # npm run build, then every spec
npm run e2e:run       # specs only, against the existing web/dist
npx playwright test e2e/player.spec.ts --headed
```

`web/dist` must be current, because the server serves the built app, not the Vite dev server. The server runs with `.venv/bin/python` when it exists, otherwise `python3`; set `FRETBOOK_E2E_PYTHON` to use another interpreter. `npm run check:e2e` type-checks the project.

Select elements with `getByTestId(...)`, never by visible text, so tests survive translation. The ids are `data-testid` attributes on the components (`library-search`, `player-play`, `editor-save`, ...). When a flow needs an element that has none, add one rather than matching on a label or a CSS class; alphaTab's own cursor (`.at-cursor-beat`) is the one exception, because the library draws it. The player's `player-status` element also carries `data-measure` (the bar being played, `-1` before playback starts).

`e2e/oidc.spec.ts` runs the server in OIDC mode against a stub provider (`e2e/support/oidc-stub.ts`) that signs the browser in as whoever the test names, and checks that two people see separate libraries. On a failure, Playwright keeps a trace, video, and screenshot under `web/test-results/` (`npx playwright show-trace <trace.zip>`); CI uploads them as the `playwright-failures` artifact.

## The `ui-only` label

Add the GitHub label `ui-only` to a pull request that only changes the frontend. CI then fails if the diff touches anything outside `web/`. That includes `fretbook/`, `tests/`, `openapi.json`, database migrations, and the Dockerfile. Remove the label when the pull request is meant to change the API.
