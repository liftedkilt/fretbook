import type { SongQuery } from "./types";

/** The `GET /api/songs` path for a query. Parameters that are empty, unset or false are left to the server's defaults, and a list is sent as one parameter per item. */
export function songsPath(query: SongQuery = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else if (value !== undefined && value !== "" && value !== false) {
      params.set(key, String(value));
    }
  }
  const text = params.toString();
  return `/api/songs${text ? `?${text}` : ""}`;
}
