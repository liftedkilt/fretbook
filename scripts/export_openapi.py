#!/usr/bin/env python3
"""Write ``openapi.json``. Same as ``python -m fretbook.openapi``."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fretbook.openapi import main

if __name__ == "__main__":
    raise SystemExit(main())
