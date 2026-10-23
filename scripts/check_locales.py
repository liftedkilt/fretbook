#!/usr/bin/env python3
"""Check web/src/locales/*.json are valid and formatted so merges stay easy.

Rules: valid JSON with no duplicate keys, LF line endings, no tabs, a single
trailing newline, a top-level object, and the same top-level key order in every
locale (so a feature's block lands in the same place in each file). Key and
placeholder parity is covered by web/src/lib/catalog.test.ts.
Usage: ``python scripts/check_locales.py [locales_dir]``.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

DEFAULT_DIR = Path(__file__).resolve().parent.parent / "web" / "src" / "locales"


def _no_duplicates(pairs: list[tuple[str, object]]) -> dict[str, object]:
    seen: set[str] = set()
    for key, _ in pairs:
        if key in seen:
            raise ValueError(f"duplicate key {key!r}")
        seen.add(key)
    return dict(pairs)


def check(directory: Path) -> list[str]:
    errors: list[str] = []
    orders: dict[str, list[str]] = {}
    files = sorted(directory.glob("*.json"))
    if not files:
        return [f"no locale files found in {directory}"]
    for path in files:
        text = path.read_text(encoding="utf-8")
        try:
            data = json.loads(text, object_pairs_hook=_no_duplicates)
        except ValueError as exc:
            errors.append(f"{path.name}: invalid JSON: {exc}")
            continue
        if not isinstance(data, dict):
            errors.append(f"{path.name}: top level must be an object")
            continue
        if "\r" in text:
            errors.append(f"{path.name}: use LF line endings, not CRLF")
        if "\t" in text:
            errors.append(f"{path.name}: indent with spaces, not tabs")
        if not text.endswith("\n") or text.endswith("\n\n"):
            errors.append(f"{path.name}: must end with exactly one newline")
        orders[path.name] = list(data)

    names = list(orders)
    if names:
        reference = names[0]
        for name in names[1:]:
            if orders[name] != orders[reference]:
                errors.append(
                    f"{name}: top-level keys must be in the same order as {reference} "
                    f"(expected {orders[reference]}, got {orders[name]})"
                )
    return errors


def main(argv: list[str]) -> int:
    directory = Path(argv[1]) if len(argv) > 1 else DEFAULT_DIR
    errors = check(directory)
    for error in errors:
        print(f"error: {error}", file=sys.stderr)
    if not errors:
        print(f"locales OK ({directory})")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
