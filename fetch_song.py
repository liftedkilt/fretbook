#!/usr/bin/env python3
"""Fetch a Songsterr bass tab plus its video sync points for the bass-tab-sync player.

Usage: fetch_song.py <songsterr-url> [--video-id YT_ID] [--slug NAME] [--no-audio] [--force-audio]

Steps: read the page's embedded state (songId, revisionId, image, tracks, videos),
download the bass part JSON from the CDN, read the per-measure sync points from the
video-points API, convert the tab, and download the video's audio with yt-dlp.
Output goes to songs/<slug>/ (tab-data.js, sync-preset.js, audio.mp3) and the
song is registered in songs/index.json. Also imported by server.py (fetch()).
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))  # keep make_data importable even with python -I
import make_data  # noqa: E402

UA = "Mozilla/5.0"
DEFAULT_CDN = "dqsljvtekg760.cloudfront.net"
URL_RE = re.compile(r"^https://www\.songsterr\.com/a/wsa/[\w-]+-s(\d+)(?:t\d+)?/?(?:[?#].*)?$")


class FetchError(Exception):
    pass


def get(url):
    # curl copes with the 103 Early Hints responses that Python's urllib rejects
    r = subprocess.run(["curl", "-sSL", "--fail", "--compressed", "-A", UA, url],
                       capture_output=True, encoding="utf-8")
    if r.returncode:
        raise FetchError(f"download failed: {url}\n{r.stderr.strip()}")
    return r.stdout


def find_ytdlp():
    local = ROOT / ".venv" / "bin" / "yt-dlp"
    return str(local) if local.exists() else shutil.which("yt-dlp")


def pick_bass(meta):
    tracks = [t for t in meta["tracks"] if t.get("isBassGuitar") and not t.get("isEmpty")]
    if not tracks:
        raise FetchError("this song has no bass track: " + ", ".join(t["instrument"] for t in meta["tracks"]))
    return tracks[0]


def pick_video(entries, video_id):
    entries = [e for e in entries if e.get("points")]
    if not entries:
        return None
    if video_id:
        found = [e for e in entries if e["videoId"] == video_id]
        if not found:
            raise FetchError(f"video {video_id} has no sync points; available: {[e['videoId'] for e in entries]}")
        return found[0]
    return next((e for e in entries if not e.get("feature")), entries[0])


def download_audio(video_id, out_dir, force, log, note):
    target = out_dir / "audio.mp3"
    if target.exists() and not force:
        note("audio exists, skipping (use --force-audio to redo)")
        return
    ytdlp = find_ytdlp()
    if not ytdlp:
        note(f"warning: yt-dlp not found; put an mp3 at {target}")
        return
    log("Baixando mp3")
    proc = subprocess.Popen([ytdlp, "-x", "--audio-format", "mp3", "--audio-quality", "0", "--no-playlist",
                             "--newline", "-o", str(out_dir / "audio.%(ext)s"),
                             f"https://www.youtube.com/watch?v={video_id}"],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, encoding="utf-8")
    last = -10
    for line in proc.stdout:
        m = re.search(r"\[download\]\s+([\d.]+)%", line)
        if m and float(m.group(1)) >= last + 10:
            last = float(m.group(1))
            log(f"Baixando mp3 {int(last)}%")
        elif "[ExtractAudio]" in line:
            log("Convertendo para mp3")
    if proc.wait():
        raise FetchError("audio download failed (try: .venv/bin/pip install -U yt-dlp); "
                         f"the tab was saved, you can also place an mp3 at {target}")


def fetch(url, video_id=None, slug=None, audio=True, force_audio=False, log=print, note=print):
    """Build songs/<slug>/ from a Songsterr URL. log() gets short status lines, note() details."""
    m = URL_RE.match(url)
    if not m:
        raise FetchError("URL must look like https://www.songsterr.com/a/wsa/<name>-s<digits>")
    song_id = int(m.group(1))
    if slug is not None and not re.fullmatch(r"[\w-]+", slug):
        raise FetchError("invalid slug")

    log("Obtendo tablatura")
    html = get(url)
    sm = re.search(r'<script[^>]*id="state"[^>]*>(.*?)</script>', html, re.S)
    if not sm:
        raise FetchError("page state not found (site layout changed?)")
    meta = json.loads(sm.group(1))["meta"]["current"]
    if meta["songId"] != song_id:
        raise FetchError(f"state songId {meta['songId']} does not match URL {song_id}")
    rev, image = meta["revisionId"], meta["image"]
    note(f"{meta['artist']} - {meta['title']} (song {song_id}, revision {rev}, image {image})")

    track = pick_bass(meta)
    cdn = (re.search(r"//([\w-]+\.cloudfront\.net)/", html) or [None, DEFAULT_CDN])[1]
    part_url = f"https://{cdn}/{song_id}/{rev}/{image}/{track['partId']}.json"
    note(f"track: {track['instrument']} -> {part_url}")
    tab = make_data.convert(json.loads(get(part_url)))
    tab["title"], tab["artist"] = meta["title"], meta["artist"]
    n = len(tab["measures"])

    log("Obtendo sincronia")
    vp = json.loads(get(f"https://www.songsterr.com/api/video-points/{song_id}/{rev}/list"))
    video = pick_video(vp, video_id)
    if video:
        if not re.fullmatch(r"[\w-]{11}", video["videoId"]):
            raise FetchError("unexpected video id")
        note(f"video: {video['videoId']} with {len(video['points'])} sync points for {n} measures")
        if len(video["points"]) != n:
            note("warning: point count differs from measure count (repeats or count-in?); sync may drift")
    else:
        note("warning: no sync points published for this song; the tab will load without sync")

    seg = url.split("?")[0].split("#")[0].rstrip("/").split("/")[-1]
    slug = slug or re.sub(r"-s\d+(?:t\d+)?$", "", seg)
    out = ROOT / "songs" / slug
    out.mkdir(parents=True, exist_ok=True)

    (out / "tab-data.js").write_text(
        "// Generated by fetch_song.py\nconst TAB = " + json.dumps(tab, separators=(",", ":"), ensure_ascii=False) + ";\n")
    preset = {"videoId": video["videoId"] if video else None, "points": video["points"] if video else []}
    (out / "sync-preset.js").write_text(
        "// Sync preset from Songsterr's public video-points API\nconst PRESET = " + json.dumps(preset, separators=(",", ":")) + ";\n")

    index_path = ROOT / "songs" / "index.json"
    index = json.loads(index_path.read_text()) if index_path.exists() else []
    index = [e for e in index if e["slug"] != slug]
    index.append({"slug": slug, "title": meta["title"], "artist": meta["artist"], "instrument": track["instrument"]})
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=1))

    if video and audio:
        download_audio(video["videoId"], out, force_audio, log, note)
    log("Pronto")
    return slug


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("url")
    ap.add_argument("--video-id", help="YouTube id whose sync points to use")
    ap.add_argument("--slug", help="output folder name")
    ap.add_argument("--no-audio", action="store_true")
    ap.add_argument("--force-audio", action="store_true")
    args = ap.parse_args()
    try:
        slug = fetch(args.url, args.video_id, args.slug, not args.no_audio, args.force_audio,
                     log=lambda m: print(f"[{m}]"))
    except FetchError as e:
        sys.exit(f"error: {e}")
    print(f"\nDone: songs/{slug}/\nOpen: http://127.0.0.1:8137/index.html?song={slug}")


if __name__ == "__main__":
    main()
