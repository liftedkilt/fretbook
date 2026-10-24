"""Write docs/reference/configuration.md from fretbook.config.ENV_VARS.

python scripts/gen_config_docs.py            # rewrite the page
python scripts/gen_config_docs.py --check    # exit 1 if the committed page is stale (CI)
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fretbook.config import ENV_VARS  # noqa: E402

TARGET = ROOT / "docs" / "reference" / "configuration.md"

HEADER = """# Configuration

Fretbook is configured with environment variables. Every one starts with `FRETBOOK_`, and every
one is optional: the defaults give a single-user server on `127.0.0.1:8137`.

!!! note "Generated page"
    This table is generated from `fretbook/config.py` by `scripts/gen_config_docs.py`. Do not edit it
    by hand: change the registry in `config.py` and run `python scripts/gen_config_docs.py`. CI fails when
    the page is out of date, and a test fails when the code reads a variable the registry does not list.

"""


def render() -> str:
    out = [HEADER]
    groups: list[str] = []
    for var in ENV_VARS:
        if var.group not in groups:
            groups.append(var.group)
    for group in groups:
        out.append(f"## {group}\n\n| Variable | Default | Purpose |\n| --- | --- | --- |\n")
        for var in ENV_VARS:
            if var.group == group:
                purpose = var.purpose.replace("|", "\\|")
                out.append(f"| `{var.name}` | {var.default} | {purpose} |\n")
        out.append("\n")
    return "".join(out).rstrip("\n") + "\n"


def main(argv: list[str]) -> int:
    text = render()
    if "--check" in argv:
        if not TARGET.exists() or TARGET.read_text(encoding="utf-8") != text:
            print(f"{TARGET.relative_to(ROOT)} is stale: run python scripts/gen_config_docs.py and commit it")
            return 1
        return 0
    TARGET.write_text(text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
