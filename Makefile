.PHONY: openapi api-types

PYTHON := $(if $(wildcard .venv/bin/python),.venv/bin/python,python)

# Regenerate the committed OpenAPI contract (openapi.json).
openapi:
	$(PYTHON) -m fretbook.openapi

# Regenerate web/src/lib/api-types.ts from openapi.json.
api-types:
	npm run api-types --prefix web
