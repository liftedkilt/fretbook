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
.venv/bin/ruff format --check fretbook tests
.venv/bin/mypy
.venv/bin/python -m pytest
.venv/bin/python -m fretbook.openapi --check
cd web && npm run lint && npm run format:check && npm run api-types:check && npm run check && npm test && npm run build
```

The `repo-checks` CI job also runs two cheap guards you can run locally:

```sh
python scripts/check_migrations.py   # no duplicate or skipped numbers in fretbook/db/migrations/
python scripts/check_locales.py      # locale files are valid JSON, LF, one trailing newline, same top-level key order
```

If another pull request took your migration number, `check_migrations.py` fails with the duplicate; rebase on `main` and rename your file to the next free number.

### Coverage

CI measures coverage for `fretbook/` (`pytest-cov`, line and branch) and `web/src/**/*.ts` (`@vitest/coverage-v8`), writes the totals to the job summary, and uploads the HTML reports as the `coverage-server` and `coverage-web` artifacts. A drop below the floor fails the job.

```sh
.venv/bin/python -m pytest --cov --cov-report=term --cov-report=html   # htmlcov/
cd web && npm run test:coverage                                         # web/coverage/
```

The floors are the current totals rounded down: `fail_under` in `pyproject.toml` (server) and `test.coverage.thresholds` in `web/vite.config.ts`. Raise them in the PR that raises coverage; never lower them. Excluded from the web numbers: `api-types.ts` (generated), `main.ts`, and Svelte components (v8 cannot attribute coverage to them under Vitest; Playwright covers them as flows). The vision modules are included because the server imports them.

Don't import source files with `?raw` (or other `?query` suffixes) in tests: Vitest's v8 coverage strips the query when it maps coverage back to sources, so the one-line `?raw` module can replace the real file's transform and randomly drop its coverage (issue #150). Read files with `node:fs` instead.

### Accessibility

`web/e2e/a11y.spec.ts` runs [axe](https://github.com/dequelabs/axe-core) (WCAG 2 A/AA, including colour contrast) over the main pages and the sheets in the light and dark themes, and checks keyboard access, focus handling in sheets, playback announcements and reduced motion. New pages and sheets should be added to its lists; give icon-only buttons an `aria-label`, and make a button's accessible name contain its visible text.

### Formatting and pre-commit

Python is formatted with `ruff format` (run `.venv/bin/ruff format fretbook tests`), and `web/` with Prettier (`npm run format --prefix web`) and linted with ESLint (`npm run lint --prefix web`). `api-types.ts` is generated and excluded. [`.editorconfig`](.editorconfig) sets the editor defaults.

To run these on every commit, install [pre-commit](https://pre-commit.com) once (the web hooks need `npm ci` in `web/` first):

```sh
.venv/bin/pip install pre-commit && .venv/bin/pre-commit install
```

To keep `git blame` useful after the one-off reformat: `git config blame.ignoreRevsFile .git-blame-ignore-revs`.

### Component tests

Svelte components are tested with `@testing-library/svelte` in `web/src/components/*.test.ts`. Vitest uses a separate `jsdom` environment project for component tests so the library unit tests in `web/src/lib` stay fast under `node`. The listen harness (`web/src/lib/listen/harness`) is a third project: it runs after the others, in a single fork, and yields the worker between tests. That suite is synchronous DSP and was tripping Vitest's 60s worker RPC timeout when it shared the pool with the rest of the run. Mock `web/src/lib/api.ts` with `vi.mock` to test component behavior in isolation without a backend:

```ts
import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import MyComponent from "./MyComponent.svelte";

vi.mock("../lib/api", () => ({ ... }));

describe("MyComponent", () => {
  it("renders correctly", () => {
    render(MyComponent, { props: { ... } });
    expect(screen.getByTestId("...")).toBeInTheDocument();
  });
});
```

DOM matchers from `@testing-library/jest-dom` (`toBeInTheDocument()`, `toHaveValue()`, etc.) are pre-configured globally via `web/src/setupTests.ts`.

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

`.github/workflows/ci.yml` runs `backend` (Python 3.12 and 3.13), `frontend`, `openapi`, `repo-checks`, `ui-only`, `e2e` and `audit` (`pip-audit` and `npm audit --omit=dev --audit-level=high`), each with a timeout. A final `ci-ok` job `needs:` all of them and fails if any did not succeed, so it is the one check to require; add new CI jobs to its `needs:` list. `.github/workflows/codeql.yml` runs CodeQL on Python and JavaScript/TypeScript for every pull request, every push to `main`, and weekly. Report vulnerabilities as described in [SECURITY.md](SECURITY.md). A new push to a pull request cancels the superseded run (pushes to branches are never cancelled).

Suggested branch-protection settings for `main`:

- Require status checks to pass before merging: **`ci-ok`** and **`Docker / image`** (the `Docker` workflow's `image` job; it has no `ci-ok` equivalent because it is a separate workflow). Require branches to be up to date before merging.
- Require linear history, and allow only squash merging (or rebase merging).
- Do not require the individual `backend (3.12)` style checks: matrix names change, which is what `ci-ok` avoids.

## Releases

Versions follow [semver](https://semver.org) and are cut by [release-please](https://github.com/googleapis/release-please) (`.github/workflows/release.yml`). You do not edit the version or `CHANGELOG.md`.

- Use a Conventional Commit PR title (`feat: …`, `fix: …`, `feat!: …` for a breaking change). The `pr-title` CI job enforces it. Pull requests are squash-merged, so the title becomes the commit and the changelog line. `feat` bumps the minor version, `fix` and `perf` the patch; while the version is `0.x`, a breaking change bumps the minor version.
- release-please keeps one "chore(main): release X.Y.Z" PR open. Merging it bumps `fretbook/__init__.py`, `pyproject.toml`, `web/package.json` and `web/package-lock.json` (not `openapi.json`: its `info.version` is pinned, so a release never changes the API contract), updates `CHANGELOG.md`, creates the GitHub release and the `vX.Y.Z` tag, and starts the Docker workflow, which publishes the image.
- Maintainers: pushes made with the default `GITHUB_TOKEN` do not start other workflows, so the release PR gets no CI run unless the repository secret `RELEASE_PLEASE_TOKEN` (a PAT or GitHub App token with `contents` and `pull requests` write access) is set. Without it, release-please still works and the workflow starts the image publish by hand, but the release PR shows no checks until a token is set.
- Allow GitHub Actions to create pull requests (Settings → Actions → General → Workflow permissions).

## API contract

The HTTP contract is the committed `openapi.json`. Regenerate it with `python -m fretbook.openapi` (or `make openapi`) and the TypeScript types with `npm run api-types --prefix web` (or `make api-types`). CI fails if either is stale. A pull request labeled `ui-only` may only touch `web/`; the rules are in [web/README.md](web/README.md).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit together and [ROADMAP.md](ROADMAP.md) for what is planned.

## Design language

UI work follows [docs/design/design-language.md](docs/design/design-language.md): the spacing, radius and type tokens, one button hierarchy, and themed form controls. New chrome uses those tokens. Raw colours, radii and spacing belong in the doc first, then in the tokens.

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
