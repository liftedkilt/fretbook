# Keeping yt-dlp working

Fretbook uses [yt-dlp](https://github.com/yt-dlp/yt-dlp) to download the audio of the video a Songsterr tab is synced to,
and of a pasted YouTube link. YouTube changes often, and an old yt-dlp stops downloading audio. To switch downloads off
entirely, set `FRETBOOK_DOWNLOAD_AUDIO=false`.

Fretbook helps in three ways:

- **Version.** `GET /api/meta` reports the yt-dlp version, its release date, its age in days, and whether it is stale
  (older than 30 days). **Settings** shows the same and warns when it is stale.
- **Explained failures.** When a download fails, the import result says why: YouTube asked for a sign-in or bot check,
  the video is unavailable, it is blocked in the server's country, or yt-dlp is out of date. Each message suggests
  uploading an mp3 on the song page instead. The tab is always saved.
- **Updating.** Rebuild or pull the image for a new yt-dlp, or set `FRETBOOK_YTDLP_AUTO_UPDATE=true`. Then the server
  runs `pip install -U yt-dlp` into `$FRETBOOK_DATA_DIR/ytdlp` when it starts and once a day, and downloads use that copy
  whenever it is newer than the one in the image. It is off by default because it fetches and runs code from PyPI; the
  container needs outbound access to it. A failed update keeps the previous copy. Delete `$FRETBOOK_DATA_DIR/ytdlp` to go
  back to the image's version.

## Cookies (optional)

If YouTube keeps asking for a sign-in, set `FRETBOOK_YTDLP_COOKIES` to a Netscape-format cookies file, for example
exported from a browser, and mount it into the container (read-only is fine; Fretbook gives yt-dlp a private copy for
each download).

!!! warning
    The file holds your logged-in session. Anyone who can read it can act as that account, and Google may restrict an
    account that downloads automatically. Use a throwaway account, never your main one, and keep the file out of version
    control.
