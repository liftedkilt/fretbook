from __future__ import annotations

import logging

import uvicorn

from fretbook.config import Settings


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    settings = Settings.from_env()
    uvicorn.run(
        "fretbook.asgi:app",
        host=settings.host,
        port=settings.port,
        proxy_headers=True,
        forwarded_allow_ips=settings.forwarded_allow_ips,
        root_path=settings.root_path or "",
    )


if __name__ == "__main__":
    main()
