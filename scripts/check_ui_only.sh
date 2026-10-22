#!/usr/bin/env bash
# Fail a pull request labeled ui-only when the diff leaves web/.
# Without the label this exits 0. See web/README.md.

set -euo pipefail

case ",${LABELS:-}," in
  *,ui-only,*) ;;
  *)
    echo "ui-only label not set; path guard skipped"
    exit 0
    ;;
esac

if [[ -z "${BASE_SHA:-}" || -z "${HEAD_SHA:-}" ]]; then
  echo "ui-only path guard needs BASE_SHA and HEAD_SHA" >&2
  exit 1
fi

if ! git cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null; then
  git fetch --no-tags origin "$BASE_SHA"
fi
if ! git cat-file -e "${HEAD_SHA}^{commit}" 2>/dev/null; then
  git fetch --no-tags origin "$HEAD_SHA"
fi

if ! diff_out=$(git diff --name-only --no-renames "$BASE_SHA" "$HEAD_SHA"); then
  echo "ui-only path guard could not diff ${BASE_SHA}..${HEAD_SHA}" >&2
  exit 1
fi
files=()
if [[ -n "$diff_out" ]]; then
  mapfile -t files <<< "$diff_out"
fi

bad=()
for file in "${files[@]}"; do
  [[ -z "$file" ]] && continue
  case "$file" in
    web/*) ;;
    *) bad+=("$file") ;;
  esac
done

if ((${#bad[@]} > 0)); then
  echo "ui-only pull requests may only change files under web/."
  echo "This diff also touches:"
  printf '  %s\n' "${bad[@]}"
  echo "In particular, do not change fretbook/, tests/, openapi.json, migrations, or the Dockerfile."
  echo "Remove the ui-only label if this pull request is meant to change the API."
  exit 1
fi

echo "ui-only path guard passed (${#files[@]} file(s) under web/)"
