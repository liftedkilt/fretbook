"""Translatable API errors.

Errors raised here have ``detail = {"key", "message", "params"}``. The browser
looks ``key`` up under ``errors`` in its catalog and falls back to the English
``message``, so server errors can be shown in the reader's language.
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException


def api_error(status: int, key: str, message: str, **params: Any) -> HTTPException:
    return HTTPException(status_code=status, detail={"key": key, "message": message, "params": params})
