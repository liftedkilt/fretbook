import { remapSync } from "../sync";
import type { ScoreDocument } from "../types";

/**
 * What a tab edit was made on top of: the content and tempo of the document the editor loaded, and for each bar now
 * in the edited document, the index of the bar it came from (`null` for a bar added since).
 */
export interface EditBase {
  content: string;
  bpm: number;
  origin: (number | null)[];
}

/** The part of a document the editor changes. Sync marks and BPM are left out: the player moves them elsewhere. */
export function contentKey(document: ScoreDocument): string {
  return JSON.stringify({ bars: document.bars, tracks: document.tracks });
}

/**
 * Put an edited document on top of a newer one. Only possible when the bars and tracks have not changed since the
 * edit's base: then the newer sync marks (re-keyed to the edited bars) and, unless the edit set its own, the newer
 * BPM are kept. Returns null when someone changed the content too, which only the user can settle.
 */
export function mergeOnto(
  latest: ScoreDocument,
  edited: ScoreDocument,
  base: EditBase,
): ScoreDocument | null {
  if (contentKey(latest) !== base.content) return null;
  return {
    ...edited,
    bpm: edited.bpm === base.bpm ? latest.bpm : edited.bpm,
    sync: remapSync(latest.sync, base.origin, latest.bars, edited.bars),
  };
}

/** The base of two edits in a row: the earlier edit's base, with `later.origin` (into the earlier result) followed back. */
export function chainBase(earlier: EditBase, later: EditBase): EditBase {
  return {
    content: earlier.content,
    bpm: earlier.bpm,
    origin: later.origin.map((source) =>
      source == null ? null : (earlier.origin[source] ?? null),
    ),
  };
}
