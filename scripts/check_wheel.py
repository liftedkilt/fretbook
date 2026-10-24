#!/usr/bin/env python3
"""Fail when a built wheel lacks the ``fretbook-cli`` entry point or the data files the server reads at run time.

Usage: ``python scripts/check_wheel.py dist/fretbook-*.whl``. CI builds the wheel first (``python -m build --wheel``).
"""

from __future__ import annotations

import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def check(wheel: Path) -> list[str]:
    errors: list[str] = []
    with zipfile.ZipFile(wheel) as zf:
        names = set(zf.namelist())
        entry_points = [n for n in names if n.endswith(".dist-info/entry_points.txt")]
        if not entry_points or "fretbook-cli = fretbook.cli:main" not in zf.read(entry_points[0]).decode():
            errors.append("entry_points.txt does not declare `fretbook-cli = fretbook.cli:main`")
    expected = {f"fretbook/db/migrations/{p.name}" for p in (ROOT / "fretbook" / "db" / "migrations").glob("*.sql")}
    expected |= {
        "fretbook/cli.py",
        "fretbook/demo/porch-light.cho",
        "fretbook/lessons/builtin/guitar-first-steps/course.md",
    }
    errors += [f"{name} is missing from the wheel" for name in sorted(expected - names)]
    stray = sorted(n for n in names if n.split("/")[0] in {"web", "tests", "songs", "scripts", "docs"})
    errors += [f"{name} should not be in the wheel" for name in stray]
    return errors


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    errors = check(Path(sys.argv[1]))
    for error in errors:
        print(f"error: {error}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
