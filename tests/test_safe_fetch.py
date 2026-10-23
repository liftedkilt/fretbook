import httpx
import pytest

from fretbook.importers.base import ImportError
from fretbook.importers.safe_fetch import SafeFetcher, UrlBlocked, is_public

PUBLIC = "93.184.216.34"


def _resolver(mapping: dict[str, list[str]]):
    def resolve(host: str, _port: int) -> list[str]:
        return mapping.get(host, [PUBLIC])

    return resolve


def _fetcher(handler, **kwargs) -> SafeFetcher:
    kwargs.setdefault("resolver", _resolver({}))
    return SafeFetcher(transport=httpx.MockTransport(handler), **kwargs)


def _ok(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, content=b"hello", headers={"content-type": "text/plain; charset=utf-8"})


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.1.2.3",
        "192.168.0.5",
        "172.16.0.1",
        "169.254.169.254",
        "100.64.0.1",
        "0.0.0.0",
        "::1",
        "fe80::1",
        "fc00::1",
        "::ffff:127.0.0.1",
        "224.0.0.1",
    ],
)
def test_non_public_addresses_are_refused(address: str) -> None:
    assert not is_public(address)


def test_public_addresses_are_allowed() -> None:
    assert is_public("93.184.216.34")
    assert is_public("2606:2800:220:1:248:1893:25c8:1946")


@pytest.mark.parametrize("address", ["127.0.0.1", "10.0.0.8", "169.254.169.254", "::1", "::ffff:127.0.0.1"])
def test_private_hosts_are_blocked_before_any_request(address: str) -> None:
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return _ok(request)

    fetcher = _fetcher(handler, resolver=_resolver({"internal.example": [address]}))
    with pytest.raises(UrlBlocked) as caught:
        fetcher.fetch("http://internal.example/tab.txt")
    assert caught.value.key == "import.urlBlocked"
    assert calls == []


def test_one_private_answer_among_public_ones_blocks_the_host() -> None:
    fetcher = _fetcher(_ok, resolver=_resolver({"mixed.example": [PUBLIC, "10.0.0.1"]}))
    with pytest.raises(UrlBlocked):
        fetcher.fetch("http://mixed.example/")


def test_ip_literal_urls_are_checked() -> None:
    fetcher = _fetcher(_ok, resolver=lambda host, _port: [host.strip("[]")])
    with pytest.raises(UrlBlocked):
        fetcher.fetch("http://127.0.0.1:8137/api/health")
    with pytest.raises(UrlBlocked):
        fetcher.fetch("http://[::1]/")


@pytest.mark.parametrize(
    "url", ["file:///etc/passwd", "ftp://example.com/a", "gopher://example.com/", "javascript:alert(1)"]
)
def test_only_http_and_https(url: str) -> None:
    with pytest.raises(UrlBlocked) as caught:
        _fetcher(_ok).fetch(url)
    assert caught.value.params["reason"] == "scheme"


def test_redirect_to_a_private_address_is_blocked() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.headers["host"] == "start.example":
            return httpx.Response(302, headers={"location": "http://metadata.example/latest"})
        return _ok(request)

    fetcher = _fetcher(handler, resolver=_resolver({"metadata.example": ["169.254.169.254"]}))
    with pytest.raises(UrlBlocked):
        fetcher.fetch("http://start.example/")


def test_relative_redirects_are_followed_and_the_final_url_is_reported() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/old":
            return httpx.Response(301, headers={"location": "/files/new.gp5"})
        return httpx.Response(200, content=b"data", headers={"content-type": "application/octet-stream"})

    fetched = _fetcher(handler).fetch("https://example.com/old")
    assert fetched.url == "https://example.com/files/new.gp5"
    assert fetched.filename == "new.gp5"
    assert fetched.content == b"data"


def test_too_many_redirects() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "/again"})

    with pytest.raises(ImportError) as caught:
        _fetcher(handler).fetch("http://example.com/")
    assert caught.value.key == "import.tooManyRedirects"


def test_connection_is_pinned_to_the_checked_address() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return _ok(request)

    _fetcher(handler).fetch("https://example.com/tab.txt?x=1")
    request = seen[0]
    assert request.url.host == PUBLIC
    assert request.headers["host"] == "example.com"
    assert request.extensions["sni_hostname"] == "example.com"
    assert str(request.url).endswith("/tab.txt?x=1")


def test_size_limit_by_content_length() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"x" * 50, headers={"content-length": "50"})

    with pytest.raises(ImportError) as caught:
        _fetcher(handler, max_bytes=10).fetch("http://example.com/")
    assert caught.value.key == "import.fetchTooLarge"


def test_size_limit_while_streaming() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=iter([b"x" * 8, b"x" * 8, b"x" * 8]))

    with pytest.raises(ImportError) as caught:
        _fetcher(handler, max_bytes=20).fetch("http://example.com/")
    assert caught.value.key == "import.fetchTooLarge"


def test_deadline_applies_to_the_whole_download(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = iter([0.0, 0.0, 1.0, 100.0, 100.0, 100.0])
    monkeypatch.setattr("fretbook.importers.safe_fetch.time.monotonic", lambda: next(clock))

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=iter([b"a", b"b", b"c"]))

    with pytest.raises(ImportError) as caught:
        _fetcher(handler, timeout=5).fetch("http://example.com/")
    assert caught.value.key == "import.fetchTimeout"


def test_transport_timeout_is_reported() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    with pytest.raises(ImportError) as caught:
        _fetcher(handler).fetch("http://example.com/")
    assert caught.value.key == "import.fetchTimeout"


def test_http_errors_and_connection_failures() -> None:
    with pytest.raises(ImportError) as caught:
        _fetcher(lambda request: httpx.Response(404)).fetch("http://example.com/")
    assert caught.value.key == "import.fetchFailed"

    def broken(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    with pytest.raises(ImportError) as caught:
        _fetcher(broken).fetch("http://example.com/")
    assert caught.value.key == "import.fetchFailed"


def test_allow_private_urls_skips_the_address_check() -> None:
    fetcher = _fetcher(_ok, allow_private=True, resolver=_resolver({"nas.local": ["192.168.1.20"]}))
    assert fetcher.fetch("http://nas.local/tab.txt").content == b"hello"


def test_filename_from_content_disposition() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, content=b"x", headers={"content-disposition": 'attachment; filename="My%20Song.gp5"'}
        )

    assert _fetcher(handler).fetch("http://example.com/download?id=3").filename == "My Song.gp5"
