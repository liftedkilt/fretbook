#!/usr/bin/env python3
"""Check a pull request title is a Conventional Commit, since release-please builds the changelog from it.

Usage: ``PR_TITLE='feat: add x' python scripts/check_pr_title.py``. Without ``PR_TITLE`` (a push, not a
pull request; CI sets it empty) it passes.
"""

from __future__ import annotations

import os
import re
import sys

TYPES = ("feat", "fix", "perf", "refactor", "docs", "test", "build", "ci", "chore", "style", "revert")
PATTERN = re.compile(rf"^(?:{'|'.join(TYPES)})(?:\([a-z0-9][a-z0-9._/-]*\))?!?: \S.*$")


def check(title: str) -> str | None:
    """Return an error message, or ``None`` when the title is valid."""
    if "\n" not in title.strip() and PATTERN.match(title.strip()):
        return None
    return (
        f"PR title {title!r} is not a Conventional Commit. Use '<type>[(scope)][!]: <description>' "
        f"with type one of: {', '.join(TYPES)}. Example: 'feat: add tab export'."
    )


def main() -> int:
    title = os.environ.get("PR_TITLE")
    if not title:
        print("no PR_TITLE; not a pull request, nothing to check")
        return 0
    error = check(title)
    if error:
        print(error, file=sys.stderr)
        return 1
    print(f"ok: {title}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
