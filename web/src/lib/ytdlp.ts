import type { YtDlpStatus } from "./types";

/** Days after which a yt-dlp release is likely to have been broken by a YouTube change. The server decides; this only names the states. */
export type YtDlpHealth = "unknown" | "fresh" | "stale";

export function ytdlpHealth(status: YtDlpStatus | null | undefined): YtDlpHealth {
  if (!status || status.age_days === null) return "unknown";
  return status.stale ? "stale" : "fresh";
}
