from __future__ import annotations

import gzip
from dataclasses import replace
from pathlib import Path

from fastapi.testclient import TestClient

from fretbook.app import create_app
from fretbook.config import Settings
from fretbook.static_files import IMMUTABLE, REVALIDATE

SCRIPT = "console.log('fretbook');\n" * 200


def _client(tmp_path: Path) -> TestClient:
    static = tmp_path / "static"
    (static / "assets").mkdir(parents=True)
    (static / "index.html").write_text('<html><head><base href="/" /></head></html>\n', encoding="utf-8")
    (static / "assets" / "index-abc123.js").write_text(SCRIPT, encoding="utf-8")
    (static / "assets" / "tiny-abc123.js").write_text("1;\n", encoding="utf-8")
    (static / "assets" / "inter-abc123.woff2").write_bytes(b"\x00" * 4096)
    (static / "sw.js").write_text(SCRIPT, encoding="utf-8")
    return TestClient(create_app(replace(Settings.for_tests(tmp_path), static_dir=static)))


def test_hashed_assets_are_gzipped_and_cached_for_good(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        response = client.get("/assets/index-abc123.js", headers={"Accept-Encoding": "gzip"})
        assert response.status_code == 200
        assert response.headers["content-encoding"] == "gzip"
        assert response.headers["vary"] == "Accept-Encoding"
        assert response.headers["cache-control"] == IMMUTABLE
        assert response.headers["content-type"].startswith("text/javascript")
        assert response.text == SCRIPT
        assert int(response.headers["content-length"]) < len(SCRIPT) / 5


def test_gzip_is_only_sent_to_clients_that_accept_it(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        for accept in ("identity", "br", "gzip;q=0"):
            response = client.get("/assets/index-abc123.js", headers={"Accept-Encoding": accept})
            assert "content-encoding" not in response.headers, accept
            assert response.headers["vary"] == "Accept-Encoding"
            assert response.text == SCRIPT
        raw = client.get("/assets/index-abc123.js", headers={"Accept-Encoding": "gzip, br;q=0.5"})
        assert raw.headers["content-encoding"] == "gzip"


def test_small_and_already_compressed_files_are_sent_as_they_are(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        for name in ("tiny-abc123.js", "inter-abc123.woff2"):
            response = client.get(f"/assets/{name}", headers={"Accept-Encoding": "gzip"})
            assert response.status_code == 200
            assert "content-encoding" not in response.headers, name
            assert response.headers["cache-control"] == IMMUTABLE


def test_a_range_request_gets_bytes_of_the_file_itself(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        response = client.get("/assets/index-abc123.js", headers={"Accept-Encoding": "gzip", "Range": "bytes=0-9"})
        assert "content-encoding" not in response.headers
        assert response.content == SCRIPT.encode()[:10]


def test_files_with_stable_names_are_revalidated(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        first = client.get("/sw.js", headers={"Accept-Encoding": "gzip"})
        assert first.headers["cache-control"] == REVALIDATE
        assert first.headers["content-encoding"] == "gzip"
        etag = first.headers["etag"]

        again = client.get("/sw.js", headers={"Accept-Encoding": "gzip", "If-None-Match": etag})
        assert again.status_code == 304
        assert again.content == b""
        assert again.headers["cache-control"] == REVALIDATE

        stale = client.get("/sw.js", headers={"Accept-Encoding": "gzip", "If-None-Match": '"something-else"'})
        assert stale.status_code == 200


def test_a_rebuilt_file_is_compressed_again(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        before = client.get("/sw.js", headers={"Accept-Encoding": "gzip"})
        (tmp_path / "static" / "sw.js").write_text(SCRIPT + "// rebuilt\n", encoding="utf-8")
        after = client.get("/sw.js", headers={"Accept-Encoding": "gzip", "If-None-Match": before.headers["etag"]})
        assert after.status_code == 200
        assert after.text.endswith("// rebuilt\n")


def test_the_compressed_body_is_valid_gzip(tmp_path: Path) -> None:
    with (
        _client(tmp_path) as client,
        client.stream("GET", "/assets/index-abc123.js", headers={"Accept-Encoding": "gzip"}) as response,
    ):
        body = b"".join(response.iter_raw())
    assert gzip.decompress(body).decode() == SCRIPT


def test_every_response_says_not_to_sniff_the_type(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        for path in ("/", "/songs/abc", "/assets/index-abc123.js", "/api/health", "/api/songs/missing"):
            assert client.get(path).headers["x-content-type-options"] == "nosniff", path
        # A route that already sets the header does not end up with it twice.
        assert client.get("/api/health").headers.get_list("x-content-type-options") == ["nosniff"]
