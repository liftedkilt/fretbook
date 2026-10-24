"""The configuration reference is generated from ``config.ENV_VARS``; these tests keep it complete."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

from fretbook import config

ROOT = Path(__file__).resolve().parent.parent
# environ.get("FRETBOOK_X"...), environ["FRETBOOK_X"], getenv("FRETBOOK_X"), and _flag/_int("FRETBOOK_X"...)
_READ = re.compile(r"""(?:environ(?:\.get)?\s*[\[(]|getenv\(|_flag\(|_int\()\s*["'](FRETBOOK_[A-Z_]+)["']""")


def _variables_the_code_reads() -> set[str]:
    found: set[str] = set()
    for path in (ROOT / "fretbook").rglob("*.py"):
        found.update(_READ.findall(path.read_text(encoding="utf-8")))
    return found


def test_every_variable_the_code_reads_is_documented() -> None:
    documented = {var.name for var in config.ENV_VARS}
    read = _variables_the_code_reads() - config.ENV_VARS_NOT_DOCUMENTED_HERE
    assert read - documented == set(), "add these to config.ENV_VARS"
    assert documented - read == set(), "these are documented but never read"


def test_registry_has_no_duplicates_and_a_purpose_for_each() -> None:
    names = [var.name for var in config.ENV_VARS]
    assert len(names) == len(set(names))
    assert all(var.purpose.strip() and var.group for var in config.ENV_VARS)


def test_committed_configuration_page_is_current() -> None:
    result = subprocess.run(
        [sys.executable, "scripts/gen_config_docs.py", "--check"], cwd=ROOT, capture_output=True, text=True
    )
    assert result.returncode == 0, result.stdout
