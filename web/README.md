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

## The `ui-only` label

Add the GitHub label `ui-only` to a pull request that only changes the frontend. CI then fails if the diff touches anything outside `web/`. That includes `fretbook/`, `tests/`, `openapi.json`, database migrations, and the Dockerfile. Remove the label when the pull request is meant to change the API.
