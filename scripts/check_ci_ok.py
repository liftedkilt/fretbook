#!/usr/bin/env python3
"""Fail the aggregate ``ci-ok`` check unless every required job succeeded.

GitHub Actions passes ``needs`` as JSON in ``NEEDS``. ``pr-title`` must
succeed. Exactly one of ``dagger`` (same-repository, self-hosted) and
``dagger-fork`` (fork pull request, GitHub-hosted) must succeed and the
other must be skipped. A failure, cancellation, or a skipped job that
never ran the checks fails the gate, so skipped work cannot turn the
aggregate green.
"""

from __future__ import annotations

import json
import os
import sys

ALWAYS = ("pr-title",)
EXCLUSIVE = ("dagger", "dagger-fork")


def result_of(needs: dict[str, object], name: str) -> str:
    info = needs.get(name)
    if not isinstance(info, dict):
        return "missing"
    result = info.get("result")
    if not isinstance(result, str) or not result:
        return "missing"
    return result


def evaluate(needs: dict[str, object]) -> list[str]:
    """Return human-readable errors. An empty list means the gate passed."""
    errors: list[str] = []
    for name in ALWAYS:
        result = result_of(needs, name)
        if result != "success":
            errors.append(f"{name} did not succeed ({result})")

    exclusive = {name: result_of(needs, name) for name in EXCLUSIVE}
    for name, result in exclusive.items():
        if result not in {"success", "skipped"}:
            errors.append(f"{name} did not succeed ({result})")
    succeeded = [name for name, result in exclusive.items() if result == "success"]
    if len(succeeded) != 1:
        errors.append(
            "expected exactly one of dagger and dagger-fork to succeed "
            f"(dagger={exclusive['dagger']}, dagger-fork={exclusive['dagger-fork']})"
        )

    known = set(ALWAYS) | set(EXCLUSIVE)
    for name in needs:
        if name in known:
            continue
        result = result_of(needs, name)
        if result != "success":
            errors.append(f"{name} did not succeed ({result})")
    return errors


def main() -> int:
    raw = os.environ.get("NEEDS")
    if not raw:
        print("NEEDS is empty; refusing to report success", file=sys.stderr)
        return 1
    try:
        needs = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"NEEDS is not JSON: {exc}", file=sys.stderr)
        return 1
    if not isinstance(needs, dict):
        print("NEEDS must be a JSON object", file=sys.stderr)
        return 1

    for name in sorted(needs):
        print(f"{name}: {result_of(needs, name)}")
    errors = evaluate(needs)
    if errors:
        print("::error::At least one required job did not succeed (failed, cancelled or skipped).", file=sys.stderr)
        for error in errors:
            print(f"::error::{error}", file=sys.stderr)
        return 1
    print("ci-ok: every required job succeeded")
    return 0


if __name__ == "__main__":
    sys.exit(main())
