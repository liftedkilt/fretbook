import type { SetlistEntry, SetlistEntryDraft } from "./types";

/** The most a chord sheet is shifted per entry; the server enforces the same range. */
export const MAX_TRANSPOSE = 11;

/** A copy of `list` with the item at `from` moved to `to`. Out-of-range positions are clamped. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length) return next;
  const target = Math.max(0, Math.min(next.length - 1, to));
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

export function clampTranspose(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-MAX_TRANSPOSE, Math.min(MAX_TRANSPOSE, Math.round(value)));
}

/** "+2", "-3" or "0". */
export function transposeLabel(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export function toDrafts(entries: readonly SetlistEntry[]): SetlistEntryDraft[] {
  return entries.map(({ song_id, note, transpose }) => ({ song_id, note, transpose }));
}

export function setlistPath(id: string): string {
  return `/setlists/${id}`;
}

/** The play-through page for the entry at `index` (0-based); the address counts from 1. */
export function playPath(id: string, index: number): string {
  return `/setlists/${id}/play/${index + 1}`;
}

/** The 0-based entry for a play-through address, or 0 when it is missing or not a number. */
export function playIndex(position: string | undefined, length: number): number {
  const parsed = Number.parseInt(position ?? "", 10);
  if (!Number.isFinite(parsed) || length < 1) return 0;
  return Math.max(0, Math.min(length - 1, parsed - 1));
}

/** The entry `step` away from `index`, or null at either end of the setlist. */
export function neighbour(index: number, length: number, step: 1 | -1): number | null {
  const next = index + step;
  return next >= 0 && next < length ? next : null;
}

/** Which key press asks for the next or previous song: Alt with an arrow, so the player's own keys stay free. */
export function stepForKey(event: {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): 1 | -1 | null {
  if (!event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === "ArrowRight") return 1;
  if (event.key === "ArrowLeft") return -1;
  return null;
}

/** Which key press moves a focused row: Alt with up or down. */
export function reorderKey(event: {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): 1 | -1 | null {
  if (!event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === "ArrowDown") return 1;
  if (event.key === "ArrowUp") return -1;
  return null;
}
