import type { Sheet } from "../chordpro";
import { transposeChord } from "../chordpro";
import { chordPitchClasses } from "./chordTones";
import type { WaitStep } from "./wait";

/** Where a chord sits in the rendered sheet, so the sheet can highlight it. */
export function segmentKey(block: number, line: number, segment: number): string {
  return `${block}:${line}:${segment}`;
}

export interface ChordSheetSteps {
  steps: WaitStep[];
  /** `keys[i]` is the sheet position of `steps[i]`. */
  keys: string[];
}

/**
 * The chords of a sheet in reading order, as wait steps. The player plays the chord shown and
 * the sheet advances to the next one. A chord that is not a chord ("N.C.") is skipped.
 * `transpose` is the sheet's transposition in semitones; the sheet's `{capo}` raises the sound
 * of the shapes, since the chords are written as shapes. `capoOverride` replaces that capo (an
 * applied capo suggestion), with `transpose` then carrying the shift of the shapes.
 */
export function chordSheetSteps(
  sheet: Sheet,
  transpose = 0,
  flats = false,
  capoOverride?: number,
): ChordSheetSteps {
  const capo = capoOverride ?? Number.parseInt(sheet.meta.capo ?? "", 10);
  const lift = Number.isFinite(capo) && capo > 0 ? capo : 0;
  const steps: WaitStep[] = [];
  const keys: string[] = [];
  sheet.blocks.forEach((block, blockIndex) => {
    block.lines.forEach((line, lineIndex) => {
      if (line.kind !== "lyrics") return;
      line.segments.forEach((segment, segmentIndex) => {
        if (!segment.chord) return;
        const shown = transposeChord(segment.chord, transpose, flats);
        const pcs = chordPitchClasses(shown);
        if (!pcs) return;
        const index = steps.length;
        steps.push({
          bar: 0,
          position: index,
          tick: index,
          kind: "chord",
          midis: [],
          pcs: pcs.map((pc) => (pc + lift) % 12),
          label: shown,
          string: 0,
          fret: 0,
        });
        keys.push(segmentKey(blockIndex, lineIndex, segmentIndex));
      });
    });
  });
  return { steps, keys };
}
