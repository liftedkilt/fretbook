# Contributing

Coding agents: read [AGENTS.md](AGENTS.md) first. It explains how to pick, claim, and finish an issue alongside other agents.

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

The Python tests fail on an unclosed database connection, and check that the English catalog has every error and progress key the server sends. A Vitest test checks that every locale has every key the UI passes to `t()`, and that the locale files share the same keys.

## API contract

The HTTP contract is the committed `openapi.json`. Regenerate it with `python -m fretbook.openapi` (or `make openapi`) and the TypeScript types with `npm run api-types --prefix web` (or `make api-types`). CI fails if either is stale. A pull request labeled `ui-only` may only touch `web/`; the rules are in [web/README.md](web/README.md).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit together and [ROADMAP.md](ROADMAP.md) for what is planned.

## Adding a locale

English (`en`) and Brazilian Portuguese (`pt-BR`) live in `web/src/locales/`. The UI reads them through `t()` in `web/src/lib/i18n.svelte.ts`. `<html lang>` follows the active locale.

1. Copy `web/src/locales/en.json` to `web/src/locales/<tag>.json`. Use a BCP 47 tag, such as `fr` or `es-MX`.
2. Translate every string. Keep `{placeholder}` names unchanged. A plural value is an object: include `other` and the categories `Intl.PluralRules` returns for that locale (English uses `one` and `other`).
3. Import the file in `web/src/lib/i18n.svelte.ts`, add it to `catalogs`, and add a `locales` entry (`id` is the tag, `labelKey` is the language's own name, the same text in every catalog, such as `language.fr`).
4. From `web/`, run `npm test`. The catalog test fails if any locale is missing a key the UI passes to `t()`, or if the locale files do not share the same keys and placeholders. It also fails if a new JSON file is not registered on the switcher.

An exact browser tag wins (`pt-BR`). A tag that only shares the language (`pt`, `pt-PT`) uses the first catalog of that language. The choice is stored in `localStorage` under `fretbook.locale`. Server errors and import progress use the same catalogs (`errors.*` and `import.*`).
