#!/usr/bin/env python3
"""Local server for bass-tab-sync: serves the player and adds songs from a Songsterr URL.

Usage: python3 server.py   (then open http://127.0.0.1:8137/)

Static files are served from this folder. GET /api/songs lists the downloaded songs. POST /api/add with {"url": "..."} runs
fetch_song.fetch() and streams newline-delimited JSON back: {"status": ...} lines,
then {"done": "<slug>"} or {"error": "..."}. Bound to localhost only, checks the Host
and Origin headers, accepts only Songsterr URLs and runs one job at a time.
"""
import json
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import fetch_song  # noqa: E402

HOST, PORT = "127.0.0.1", 8137
ALLOWED_HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
ALLOWED_ORIGINS = {f"http://{h}" for h in ALLOWED_HOSTS}
HIDDEN = ("/.venv", "/__pycache__", "/.git")
job_lock = threading.Lock()


def js_value(path):
    """Parse the JSON after '= ' in a generated 'const X = {...};' file."""
    text = path.read_text()
    return json.loads(text.split("= ", 1)[1].rstrip().rstrip(";"))


def library():
    """Describe every song folder under songs/ (title, size, sync and audio status)."""
    index_path = ROOT / "songs" / "index.json"
    instruments = {e["slug"]: e.get("instrument") for e in json.loads(index_path.read_text())} if index_path.exists() else {}
    songs = []
    for d in sorted((ROOT / "songs").iterdir()):
        if not (d / "tab-data.js").is_file():
            continue
        try:
            tab = js_value(d / "tab-data.js")
            preset = js_value(d / "sync-preset.js") if (d / "sync-preset.js").is_file() else {"points": []}
        except (ValueError, IndexError, OSError):
            continue
        points = preset.get("points") or []
        songs.append({"slug": d.name, "title": tab.get("title") or d.name, "artist": tab.get("artist") or "",
                      "instrument": instruments.get(d.name) or "Bass", "measures": len(tab["measures"]),
                      "bpm": tab.get("bpm"), "duration": points[-1] if points else None,
                      "hasSync": bool(points), "hasAudio": (d / "audio.mp3").is_file()})
    return songs


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def deny(self, code, message):
        body = json.dumps({"error": message}).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.headers.get("Host") not in ALLOWED_HOSTS:
            return self.deny(403, "bad host")
        if self.path.startswith(HIDDEN):
            return self.deny(404, "not found")
        if self.path.split("?")[0] == "/api/songs":
            body = json.dumps(library(), ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self):
        if self.path != "/api/add":
            return self.deny(404, "not found")
        origin = self.headers.get("Origin")
        if self.headers.get("Host") not in ALLOWED_HOSTS or (origin and origin not in ALLOWED_ORIGINS):
            return self.deny(403, "forbidden")
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            return self.deny(415, "expected application/json")
        try:
            size = int(self.headers.get("Content-Length", "0"))
            url = json.loads(self.rfile.read(min(size, 4096)))["url"]
            if not isinstance(url, str):
                raise ValueError
        except (ValueError, KeyError, TypeError):
            return self.deny(400, "expected {\"url\": \"...\"}")
        if not job_lock.acquire(blocking=False):
            return self.deny(409, "another song is being downloaded")

        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()

        def emit(obj):
            try:
                self.wfile.write((json.dumps(obj, ensure_ascii=False) + "\n").encode())
                self.wfile.flush()
            except OSError:
                pass  # browser went away; keep going so the files still get written

        try:
            slug = fetch_song.fetch(url.strip(), log=lambda m: emit({"status": m}), note=lambda m: None)
            emit({"done": slug})
        except fetch_song.FetchError as e:
            emit({"error": str(e)})
        except Exception as e:  # noqa: BLE001 - report anything unexpected to the page
            emit({"error": f"unexpected error: {e}"})
        finally:
            job_lock.release()


if __name__ == "__main__":
    print(f"bass-tab-sync on http://{HOST}:{PORT}/")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
