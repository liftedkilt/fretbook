## Summary

Closes #

<!-- What changed and why. Keep one issue per PR. -->

## Screenshots

<!-- For UI changes, attach before/after screenshots (desktop and mobile if layout changed). Mark N/A if there are no UI changes. -->

## Checks

- [ ] `.venv/bin/ruff check fretbook tests`
- [ ] `.venv/bin/python -m pytest`
- [ ] `.venv/bin/python -m fretbook.openapi --check`
- [ ] `cd web && npm run api-types:check && npm run check && npm test && npm run build`
- [ ] Tests added or updated for the new behaviour

## Checklist

- [ ] **API contract**: if routes or schemas changed, ran `make openapi api-types` and committed `openapi.json` and `web/src/lib/api-types.ts` (or N/A)
- [ ] **i18n**: every new UI string uses `t()` and is in both `web/src/locales/en.json` and `web/src/locales/pt-BR.json` (note below if `pt-BR` is machine-translated; or N/A)
- [ ] **Migrations**: schema changes are in a new numbered file under `fretbook/db/migrations/`, rebased on `main` with no number collision (or N/A)
- [ ] **Docs & roadmap**: updated `README.md` / `docs/` when behaviour or configuration changed, and removed completed items from `ROADMAP.md` (or N/A)
- [ ] **Labels**: added `ui-only` if the PR only touches `web/`

## Out of scope / follow-ups

<!-- Link any follow-up issues opened for work left out of this PR, or note any decisions made. -->
