/** Pure helpers for band libraries and read-only links. */

/** A missing role is the caller's own song, which they can edit. Only `view` is locked. */
export function canEdit(role: string | null | undefined): boolean {
  return role !== "view";
}

/** Browser path for a share token. Slashes are dropped so the token stays one segment. */
export function sharePath(token: string): string {
  return `/share/${encodeURIComponent(token.replaceAll("/", ""))}`;
}

/** Empty storage means the personal library. */
export function activeLibraryId(stored: string, personalId: string): string {
  const trimmed = stored.trim();
  return trimmed || personalId;
}

/**
 * Editable libraries other than the song's current one.
 * The API rejects a copy or move into the same library (`library.same`).
 * Order is kept, so the personal library stays first when the song is in a band.
 */
export function transferDestinations<T extends { id: string; role: string }>(
  libraries: readonly T[],
  currentLibraryId: string | null | undefined,
): T[] {
  const current = (currentLibraryId ?? "").trim();
  return libraries.filter((item) => item.role === "edit" && item.id !== current);
}
