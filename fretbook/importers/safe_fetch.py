"""Fetch a URL the user typed without letting it reach the server's own network.

Pasting a link makes the server request it, so a link to ``http://127.0.0.1``,
the cloud metadata address, or a router page must not work. Every hop of a
fetch is checked:

* only ``http`` and ``https``;
* the host is resolved and **every** address must be a public one (loopback,
  private, link-local, carrier-grade NAT, multicast and reserved ranges are
  refused; an IPv4-mapped IPv6 address is judged as the IPv4 address it wraps);
* the connection goes to the address that was checked, with the original
  ``Host`` header and TLS server name, so a second DNS answer cannot swap it;
* redirects are followed by hand, at most :data:`MAX_REDIRECTS`, each one checked again;
* the body is capped by ``Content-Length`` and by the bytes actually read, and
  the whole fetch has a deadline (an HTTP read timeout alone restarts on every chunk).

``FRETBOOK_ALLOW_PRIVATE_URLS=true`` skips the address check, for a self-hosted
tab server on the LAN.
"""

from __future__ import annotations

import ipaddress
import socket
import time
from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import unquote, urljoin, urlsplit

import httpx

from fretbook.importers.base import ImportError

MAX_REDIRECTS = 5
USER_AGENT = "Mozilla/5.0 (compatible; Fretbook)"
Resolver = Callable[[str, int], list[str]]


class UrlBlocked(ImportError):
    """The URL points somewhere the server must not fetch from."""

    def __init__(self, message: str, reason: str) -> None:
        super().__init__(message, "import.urlBlocked", reason=reason)


@dataclass
class Fetched:
    url: str
    """The final URL, after redirects."""
    content: bytes
    content_type: str
    filename: str
    """The name the server gave (``Content-Disposition``) or the last path segment."""


def system_resolver(host: str, port: int) -> list[str]:
    try:
        return sorted({str(info[4][0]) for info in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)})
    except socket.gaierror as exc:
        raise ImportError(f"could not resolve {host}", "import.fetchFailed", host=host) from exc


def is_public(address: str) -> bool:
    ip = ipaddress.ip_address(address.split("%", 1)[0])
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def _filename(url: str, disposition: str) -> str:
    for part in disposition.split(";")[1:]:
        key, _, value = part.strip().partition("=")
        if key.lower() == "filename" and value:
            return unquote(value.strip('"')).rsplit("/", 1)[-1]
    return unquote(urlsplit(url).path.rsplit("/", 1)[-1])


class SafeFetcher:
    def __init__(
        self,
        *,
        allow_private: bool = False,
        max_bytes: int = 25 * 1024 * 1024,
        timeout: float = 30,
        resolver: Resolver = system_resolver,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.allow_private = allow_private
        self.max_bytes = max_bytes
        self.timeout = timeout
        self._resolver = resolver
        self._transport = transport

    def _target(self, url: str) -> tuple[httpx.URL, str]:
        """Check ``url``; return the URL to connect to (host replaced by the checked address) and the original host."""
        parts = urlsplit(url)
        if parts.scheme not in {"http", "https"}:
            raise UrlBlocked("only http and https links can be imported", "scheme")
        host = parts.hostname
        if not host:
            raise UrlBlocked("the link has no host", "host")
        try:
            port = parts.port or (443 if parts.scheme == "https" else 80)
        except ValueError as exc:
            raise UrlBlocked("the link has an invalid port", "port") from exc
        addresses = self._resolver(host, port)
        if not addresses:
            raise ImportError(f"could not resolve {host}", "import.fetchFailed", host=host)
        if not self.allow_private and not all(is_public(address) for address in addresses):
            raise UrlBlocked("this link points at a private or local address", "private")
        return httpx.URL(url).copy_with(host=addresses[0].split("%", 1)[0]), host

    def _too_large(self) -> ImportError:
        return ImportError("the download is too large", "import.fetchTooLarge", limit=self.max_bytes)

    def fetch(self, url: str, headers: dict[str, str] | None = None) -> Fetched:
        """Download ``url``. ``headers`` are sent on every hop, over the defaults."""
        deadline = time.monotonic() + self.timeout
        current = url
        with httpx.Client(transport=self._transport, timeout=self.timeout, follow_redirects=False) as client:
            for _hop in range(MAX_REDIRECTS + 1):
                if time.monotonic() > deadline:
                    raise ImportError("the download took too long", "import.fetchTimeout")
                pinned, host = self._target(current)
                headers = {
                    "User-Agent": USER_AGENT,
                    "Accept": "*/*",
                    "Host": urlsplit(current).netloc.rsplit("@", 1)[-1],
                    **(headers or {}),
                }
                extensions = {"sni_hostname": host} if pinned.scheme == "https" else {}
                try:
                    with client.stream("GET", pinned, headers=headers, extensions=extensions) as response:
                        if response.is_redirect:
                            location = response.headers.get("location")
                            if not location:
                                raise ImportError("redirect without a location", "import.fetchFailed", host=host)
                            current = urljoin(current, location)
                            continue
                        if response.status_code >= 400:
                            raise ImportError(
                                f"the server answered {response.status_code}",
                                "import.fetchFailed",
                                host=host,
                                status=response.status_code,
                            )
                        declared = response.headers.get("content-length", "")
                        if declared.isdigit() and int(declared) > self.max_bytes:
                            raise self._too_large()
                        chunks: list[bytes] = []
                        size = 0
                        for chunk in response.iter_bytes():
                            size += len(chunk)
                            if size > self.max_bytes:
                                raise ImportError(
                                    "the download is too large", "import.fetchTooLarge", limit=self.max_bytes
                                )
                            if time.monotonic() > deadline:
                                raise ImportError("the download took too long", "import.fetchTimeout")
                            chunks.append(chunk)
                        return Fetched(
                            url=current,
                            content=b"".join(chunks),
                            content_type=response.headers.get("content-type", "").split(";")[0].strip().lower(),
                            filename=_filename(current, response.headers.get("content-disposition", "")),
                        )
                except httpx.TimeoutException as exc:
                    raise ImportError("the download took too long", "import.fetchTimeout") from exc
                except httpx.HTTPError as exc:
                    raise ImportError("the download failed", "import.fetchFailed", host=host) from exc
        raise ImportError("too many redirects", "import.tooManyRedirects", limit=MAX_REDIRECTS)
