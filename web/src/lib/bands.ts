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
