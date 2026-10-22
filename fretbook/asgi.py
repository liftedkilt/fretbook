"""ASGI entrypoint. Uvicorn loads this module, which reads the environment."""

from __future__ import annotations

from fretbook.app import create_app
from fretbook.config import Settings

app = create_app(Settings.from_env())
