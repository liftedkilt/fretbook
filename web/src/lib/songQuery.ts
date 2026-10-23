import type { SongQuery } from "./types";

/** The `GET /api/songs` path for a query. Parameters that are empty or unset are left to the server's defaults. */
export function songsPath(query: SongQuery = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const text = params.toString();
  return `/api/songs${text ? `?${text}` : ""}`;
}
