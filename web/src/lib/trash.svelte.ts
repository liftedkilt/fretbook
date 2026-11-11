// Deleting a song moves it to the server's trash. This holds the "Undo" offer shown right after a delete.

import { deleteSong, listTrash, restoreSong } from "./api";

/** How long the Undo offer stays on screen. */
export const UNDO_MS = 10_000;

export type UndoOffer = { id: string; title: string; failed: boolean };

export const trashUndo = $state<{ current: UndoOffer | null }>({ current: null });

let enabled: Promise<boolean> | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Whether the server keeps deleted songs (`FRETBOOK_TRASH_DAYS` above 0). Asked once; a failure asks again. */
export function trashEnabled(): Promise<boolean> {
  enabled ??= listTrash().then(
    (trash) => trash.retention_days > 0,
    () => {
      enabled = null;
      return false;
    },
  );
  return enabled;
}

export function dismissUndo(): void {
  clearTimeout(timer);
  trashUndo.current = null;
}

/** Delete a song and, when the server has a trash, offer to undo it for a few seconds. */
export async function trashSong(song: { id: string; title: string }): Promise<void> {
  await deleteSong(song.id);
  if (!(await trashEnabled())) return;
  dismissUndo();
  trashUndo.current = { id: song.id, title: song.title, failed: false };
  timer = setTimeout(dismissUndo, UNDO_MS);
}

/** Restore the song the offer is for. Returns whether it came back; a failure leaves the offer up, marked. */
export async function undoDelete(): Promise<boolean> {
  const offer = trashUndo.current;
  if (!offer) return false;
  clearTimeout(timer);
  try {
    await restoreSong(offer.id);
  } catch {
    if (trashUndo.current === offer) trashUndo.current = { ...offer, failed: true };
    return false;
  }
  if (trashUndo.current === offer) trashUndo.current = null;
  return true;
}

/** Forget what was learnt about the server (tests). */
export function resetTrashState(): void {
  enabled = null;
  dismissUndo();
}
