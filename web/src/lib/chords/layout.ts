import type { Voicing } from "./voicings";

/** Where the marks of a chord diagram go. The SVG component and the PDF export both draw from this. */

/** Fret rows a diagram shows. */
export const DIAGRAM_ROWS = 5;

export interface DiagramGeometry {
  strings: number;
  rows: number;
  /** The fret the first row stands for. Above 1 the diagram is labelled with it. */
  baseFret: number;
  dots: { string: number; row: number }[];
  barre: { row: number; from: number; to: number } | null;
  open: number[];
  muted: number[];
}

export function diagramGeometry(voicing: Voicing, strings: number): DiagramGeometry {
  const dots: DiagramGeometry["dots"] = [];
  const open: number[] = [];
  const muted: number[] = [];
  for (let index = 0; index < strings; index += 1) {
    const fret = voicing.frets[index] ?? null;
    if (fret === null) muted.push(index);
    else if (fret === 0) open.push(index);
    else dots.push({ string: index, row: fret - voicing.baseFret });
  }
  const { barre } = voicing;
  return {
    strings,
    rows: DIAGRAM_ROWS,
    baseFret: voicing.baseFret,
    dots: barre
      ? dots.filter(
          (dot) =>
            !(
              dot.row === barre.fret - voicing.baseFret &&
              dot.string >= barre.from &&
              dot.string <= barre.to
            ),
        )
      : dots,
    barre: barre ? { row: barre.fret - voicing.baseFret, from: barre.from, to: barre.to } : null,
    open,
    muted,
  };
}

/** "x 3 2 0 1 0", the frets from the lowest string, for a screen reader. */
export function describeFrets(voicing: Voicing): string {
  return voicing.frets.map((fret) => (fret === null ? "x" : String(fret))).join(" ");
}
