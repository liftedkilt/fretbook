#!/usr/bin/env python3
"""Fail when fretbook/db/migrations/ has duplicate, skipped or malformed numbers.

Parallel pull requests that both add the next migration collide here. Usage:
``python scripts/check_migrations.py [migrations_dir]``.
"""

from __future__ import annotations

import re
import sys
from collections import defaultdict
from pathlib import Path

DEFAULT_DIR = Path(__file__).resolve().parent.parent / "fretbook" / "db" / "migrations"
NAME = re.compile(r"^(\d{3})_[a-z0-9_]+\.sql$")


def check(directory: Path) -> list[str]:
    errors: list[str] = []
    by_number: dict[int, list[str]] = defaultdict(list)
    for path in sorted(directory.iterdir()):
        if path.is_dir() or path.name.startswith("."):
            continue
        match = NAME.match(path.name)
        if not match:
            errors.append(
                f"{path.name}: migration files must be named NNN_description.sql "
                "(three digits, lowercase letters, digits and underscores)"
            )
            continue
        by_number[int(match.group(1))].append(path.name)

    for number, names in sorted(by_number.items()):
        if len(names) > 1:
            errors.append(
                f"duplicate migration number {number:03d}: {', '.join(names)}. "
                "Rebase on main and rename your file to the next free number."
            )

    if by_number:
        expected = set(range(1, max(by_number) + 1))
        for number in sorted(expected - set(by_number)):
            errors.append(
                f"missing migration number {number:03d}: numbers must run 001..{max(by_number):03d} with no gaps."
            )
    return errors


def main(argv: list[str]) -> int:
    directory = Path(argv[1]) if len(argv) > 1 else DEFAULT_DIR
    errors = check(directory)
    for error in errors:
        print(f"error: {error}", file=sys.stderr)
    if not errors:
        print(f"migrations OK ({directory})")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
