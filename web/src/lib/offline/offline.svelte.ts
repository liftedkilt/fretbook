import { ApiError, getSong, isOfflineError, noteRebase, putSong } from "../api";
import type { SongDetail } from "../types";
import { dropEdit, markEdit, queue, reloadQueue } from "./queueState.svelte";
import { mergeOnto } from "./merge";
import type { QueuedEdit } from "./queue";
import {
  emptyRegistry,
  readRegistry,
  withoutSetlist,
  withoutVia,
  withSetlist,
  withSong,
  writeRegistry,
  type Registry,
} from "./registry";
import {
  clearAllData,
  forgetSetlist,
  forgetSong,
  offlineSupported,
  saveSetlistDocument,
  saveSong,
  warmEssentials,
} from "./store";

export { queue } from "./queueState.svelte";

export const offline = $state<{ online: boolean; syncing: boolean; saved: Registry }>({
  online: typeof navigator === "undefined" || navigator.onLine !== false,
  syncing: false,
  saved: readRegistry(),
});

function setSaved(next: Registry): void {
  offline.saved = next;
  writeRegistry(next);
}

export const isSongSaved = (id: string) => id in offline.saved.songs;
export const isSetlistSaved = (id: string) => id in offline.saved.setlists;

/** After saving: ask the browser not to evict it (it may say no), and keep what the app needs to start. */
async function settleSaved(): Promise<void> {
  void navigator.storage?.persist?.().catch(() => undefined);
  await warmEssentials().catch(() => undefined);
}

export async function saveSongOffline(id: string, title: string): Promise<void> {
  const song = await saveSong(id);
  await settleSaved();
  setSaved(withSong(offline.saved, id, song.title || title, "song"));
}

export async function removeSongOffline(id: string): Promise<void> {
  const { registry, dropped } = withoutVia(offline.saved, id, "song");
  if (dropped) await forgetSong(id);
  setSaved(registry);
}

async function saveSetlistSongs(id: string, refreshOnly: boolean): Promise<void> {
  const setlist = await saveSetlistDocument(id);
  const songIds = [...new Set(setlist.entries.map((entry) => entry.song_id))];
  let registry = offline.saved;
  for (const songId of songIds) {
    const song = await saveSong(songId, refreshOnly);
    registry = withSong(registry, songId, song.title, `setlist:${id}`);
  }
  // Songs taken out of the setlist since it was last saved no longer need keeping for it.
  for (const songId of offline.saved.setlists[id]?.songIds ?? []) {
    if (songIds.includes(songId)) continue;
    const result = withoutVia(registry, songId, `setlist:${id}`);
    registry = result.registry;
    if (result.dropped) await forgetSong(songId);
  }
  setSaved(withSetlist(registry, id, setlist.name, songIds));
}

export async function saveSetlistOffline(id: string): Promise<void> {
  await saveSetlistSongs(id, false);
  await settleSaved();
}

export async function removeSetlistOffline(id: string): Promise<void> {
  const known = offline.saved.setlists[id];
  let registry = offline.saved;
  for (const songId of known?.songIds ?? []) {
    const result = withoutVia(registry, songId, `setlist:${id}`);
    registry = result.registry;
    if (result.dropped) await forgetSong(songId);
  }
  await forgetSetlist(id);
  setSaved(withoutSetlist(registry, id));
}

/** Bring everything saved up to date, and fetch songs added to a saved setlist since. Quiet: offline is expected. */
export async function refreshSaved(): Promise<void> {
  if (!offline.online || !offlineSupported()) return;
  try {
    for (const id of Object.keys(offline.saved.setlists)) await saveSetlistSongs(id, true);
    for (const [id, song] of Object.entries(offline.saved.songs))
      if (song.via.includes("song")) await saveSong(id, true);
  } catch {
    /* still offline, or the session ended; try again next time */
  }
}

// --- edits made offline -----------------------------------------------------------------------------------------

/**
 * True when the server already holds what the edit says. That happens when a send reached the server but its answer
 * was lost (the connection dropped as it came back): the retry is then refused as a conflict with itself.
 */
function alreadySaved(latest: SongDetail, body: QueuedEdit["body"]): boolean {
  return (
    latest.title === body.title &&
    latest.artist === body.artist &&
    (body.chordpro === undefined || latest.chordpro === body.chordpro) &&
    (body.document === undefined ||
      JSON.stringify(latest.document) === JSON.stringify(body.document))
  );
}

/** Send queued edits in the order they were made. Stops at the first sign of no network. */
export async function flushQueue(): Promise<void> {
  if (offline.syncing) return;
  offline.syncing = true;
  try {
    for (const edit of [...queue.edits]) {
      if (edit.state !== "pending") continue;
      try {
        const saved = await putSong(edit.songId, edit.body);
        noteRebase(edit.songId, edit.body.revision, saved.revision);
        dropEdit(edit.songId);
      } catch (error) {
        if (isOfflineError(error)) break;
        if (!(error instanceof ApiError)) break;
        if (error.status === 409) {
          try {
            const latest = await getSong(edit.songId);
            if (alreadySaved(latest, edit.body)) {
              noteRebase(edit.songId, edit.body.revision, latest.revision);
              dropEdit(edit.songId);
              continue;
            }
            const document = edit.base && edit.body.document && latest.document;
            const merged = document
              ? mergeOnto(latest.document!, edit.body.document!, edit.base!)
              : null;
            if (merged) {
              // Only the sync marks or BPM moved elsewhere: save the edit on top of them.
              const saved = await putSong(edit.songId, {
                ...edit.body,
                document: merged,
                revision: latest.revision,
              });
              noteRebase(edit.songId, edit.body.revision, saved.revision);
              dropEdit(edit.songId);
              continue;
            }
          } catch (retry) {
            if (retry instanceof ApiError && !isOfflineError(retry)) {
              markEdit(edit.songId, retry.status === 409 ? "conflict" : "failed", retry.message);
              continue;
            }
            break;
          }
        }
        markEdit(edit.songId, error.status === 409 ? "conflict" : "failed", error.message);
      }
    }
  } finally {
    offline.syncing = false;
  }
}

/**
 * Settle an edit that could not be sent. `mine` saves it on top of the newer version, which overwrites what was
 * changed elsewhere; `theirs` drops the edit and keeps the newer version.
 */
export async function resolveEdit(songId: string, keep: "mine" | "theirs"): Promise<void> {
  const edit = queue.edits.find((item) => item.songId === songId);
  if (!edit) return;
  const latest = await getSong(songId);
  if (keep === "mine") {
    try {
      const saved = await putSong(songId, { ...edit.body, revision: latest.revision });
      noteRebase(songId, edit.body.revision, saved.revision);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409)
        markEdit(songId, "conflict", error.message);
      throw error;
    }
  } else if (isSongSaved(songId)) {
    await saveSong(songId, true);
  }
  dropEdit(songId);
}

/** Forget this device's copy of the library, for example on sign-out. Edits not yet sent are lost with it. */
export async function clearOfflineData(): Promise<void> {
  await clearAllData();
  for (const edit of [...queue.edits]) dropEdit(edit.songId);
  setSaved(emptyRegistry());
}

// --- wiring -----------------------------------------------------------------------------------------------------

async function registerWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register(new URL("sw.js", document.baseURI), { scope: "./" });
  } catch {
    /* the app still works online without it */
  }
}

/** Track the connection, send queued edits when it returns, and (in a build) install the service worker. */
export function startOffline(): void {
  offline.online = navigator.onLine !== false;
  window.addEventListener("online", () => {
    offline.online = true;
    void flushQueue().then(refreshSaved);
  });
  window.addEventListener("offline", () => {
    offline.online = false;
  });
  // Another tab may have queued or sent edits.
  window.addEventListener("storage", reloadQueue);
  // `online` can fire before the connection really works, and a server can be unreachable for a while: try again.
  setInterval(() => {
    if (offline.online && queue.edits.some((edit) => edit.state === "pending")) void flushQueue();
  }, 5000);
  if (import.meta.env.PROD) void registerWorker();
  if (offline.online) void flushQueue().then(() => setTimeout(() => void refreshSaved(), 3000));
}
