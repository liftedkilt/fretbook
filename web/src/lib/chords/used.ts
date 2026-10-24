import type { Sheet } from "../chordpro";
import { parseChord, shapeName } from "./theory";

/** The distinct chords of a sheet that can be drawn, in order of first use, as displayed. */
export function chordsUsed(sheet: Sheet, transpose: number, flats: boolean): string[] {
  const seen = new Set<string>();
  for (const block of sheet.blocks) {
    for (const line of block.lines) {
      if (line.kind !== "lyrics") continue;
      for (const segment of line.segments) {
        if (!segment.chord) continue;
        const name = shapeName(segment.chord, transpose, flats);
        if (parseChord(name)) seen.add(name);
      }
    }
  }
  return [...seen];
}

/** The capo fret from a sheet's `{capo:}`, 0 when there is none. */
export function capoOf(sheet: Sheet): number {
  const capo = Number.parseInt(sheet.meta.capo ?? "", 10);
  return Number.isFinite(capo) && capo > 0 && capo <= 12 ? capo : 0;
}
