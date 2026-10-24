import { DATA_CACHE } from "./swCore";
import type { SetlistDetail, SongDetail } from "../types";

/*
 * The page's side of the offline cache: it puts documents and audio into the cache the service worker reads from.
 * The worker keeps what is here fresh, and answers from it when the network is gone.
 */

function url(path: string): string {
  return new URL(path, document.baseURI).href;
}

export const songUrl = (id: string) => url(`api/songs/${id}`);
export const audioUrl = (id: string) => url(`api/songs/${id}/audio`);
export const setlistUrl = (id: string) => url(`api/setlists/${id}`);

export function offlineSupported(): boolean {
  return typeof caches !== "undefined";
}

async function open(): Promise<Cache> {
  if (!offlineSupported()) throw new Error("offline storage is not available in this browser");
  return caches.open(DATA_CACHE);
}

/** Fetch `href` and keep it. A failure is thrown, so a half-saved song is never reported as saved. */
async function keep(cache: Cache, href: string): Promise<Response> {
  const response = await fetch(href);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${href}`);
  await cache.put(href, response.clone());
  return response;
}

/** Save the song's document and, unless `refreshOnly` and it is already saved, its audio. */
export async function saveSong(id: string, refreshOnly = false): Promise<SongDetail> {
  const cache = await open();
  const song = (await (await keep(cache, songUrl(id))).json()) as SongDetail;
  if (song.has_audio && !(refreshOnly && (await cache.match(audioUrl(id))))) {
    await keep(cache, audioUrl(id));
  }
  return song;
}

/** What every page asks for before it shows a song, so a saved song also opens on a first visit that was online. */
export async function warmEssentials(): Promise<void> {
  const cache = await open();
  await Promise.all([keep(cache, url("api/meta")), keep(cache, url("api/me"))]);
}

export async function saveSetlistDocument(id: string): Promise<SetlistDetail> {
  const cache = await open();
  return (await (await keep(cache, setlistUrl(id))).json()) as SetlistDetail;
}

export async function forgetSong(id: string): Promise<void> {
  if (!offlineSupported()) return;
  const cache = await open();
  await cache.delete(songUrl(id));
  await cache.delete(audioUrl(id));
}

export async function forgetSetlist(id: string): Promise<void> {
  if (!offlineSupported()) return;
  await (await open()).delete(setlistUrl(id));
}

/** Replace a saved song's document, for example after an edit. Songs that were not saved are left alone. */
export async function refreshSavedSong(song: SongDetail): Promise<void> {
  if (!offlineSupported()) return;
  const cache = await open();
  const href = songUrl(song.id);
  if (!(await cache.match(href))) return;
  await cache.put(
    href,
    new Response(JSON.stringify(song), { headers: { "Content-Type": "application/json" } }),
  );
}

/** Everything the worker saved, library lists included. Signing out leaves nothing of the library on the device. */
export async function clearAllData(): Promise<void> {
  if (offlineSupported()) await caches.delete(DATA_CACHE);
}
