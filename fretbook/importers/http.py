"""HTTP fetch for importers.

Songsterr answers with an HTTP/2 103 Early Hints response that the standard
library client rejects. httpx speaks HTTP/1.1 and works; curl is the fallback
the original player used.
"""

from __future__ import annotations

import shutil
import subprocess

import httpx

from fretbook.importers.base import ImportError

USER_AGENT = "Mozilla/5.0"


class HttpFetcher:
    def __init__(self, timeout: float = 45) -> None:
        self._timeout = timeout

    def get_text(self, url: str) -> str:
        try:
            response = httpx.get(
                url,
                headers={"User-Agent": USER_AGENT, "Accept": "*/*"},
                follow_redirects=True,
                timeout=self._timeout,
            )
            response.raise_for_status()
            return response.text
        except httpx.HTTPError as exc:
            curl = shutil.which("curl")
            if not curl:
                raise ImportError(f"download failed: {url}") from exc
            return self._curl(curl, url)

    def _curl(self, curl: str, url: str) -> str:
        completed = subprocess.run(
            [curl, "-sSL", "--fail", "--compressed", "-A", USER_AGENT, url],
            capture_output=True,
            text=True,
            check=False,
        )
        if completed.returncode != 0:
            detail = completed.stderr.strip() or f"curl exited {completed.returncode}"
            raise ImportError(f"download failed: {url}: {detail}")
        return completed.stdout
