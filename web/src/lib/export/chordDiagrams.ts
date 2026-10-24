import { rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { diagramGeometry } from "../chords/layout";
import type { Voicing } from "../chords/voicings";
import { encodable } from "./svg";

/** Chord diagrams drawn as PDF vectors, for the strip at the top of a chord sheet. */

export interface PdfDiagramInput {
  /** String count of the tuning the voicings are for. */
  strings: number;
  /** Capo fret (0 for none), printed above the diagrams. */
  capo: number;
  chords: { name: string; voicing: Voicing }[];
}

export const DIAGRAM_CELL = { width: 66, height: 88 };

const INK = rgb(0.1, 0.08, 0.05);
const RULE = rgb(0.55, 0.45, 0.32);
const ROW = 9;
const GRID_WIDTH = 36;

/** How many cells fit on a line of `width`. */
export function diagramsPerRow(width: number): number {
  return Math.max(1, Math.floor(width / DIAGRAM_CELL.width));
}

/** Paint one diagram with its cell's top-left corner at (`left`, `top`) in page coordinates. */
export function paintDiagram(
  page: PDFPage,
  font: PDFFont,
  chord: PdfDiagramInput["chords"][number],
  strings: number,
  left: number,
  top: number,
): void {
  const geometry = diagramGeometry(chord.voicing, strings);
  const name = encodable(font, chord.name);
  page.drawText(name, { x: left + 4, y: top - 10, size: 10, font, color: INK });
  const gridLeft = left + 17;
  const gridTop = top - 30;
  const gap = strings > 1 ? GRID_WIDTH / (strings - 1) : 0;
  const x = (string: number) => gridLeft + string * gap;
  const y = (row: number) => gridTop - row * ROW - ROW / 2;
  const bottom = gridTop - geometry.rows * ROW;
  const line = (x1: number, y1: number, x2: number, y2: number, thickness = 0.6) =>
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color: RULE });
  line(gridLeft, gridTop, gridLeft + GRID_WIDTH, gridTop, geometry.baseFret === 1 ? 2 : 0.6);
  for (let row = 1; row <= geometry.rows; row += 1) {
    line(gridLeft, gridTop - row * ROW, gridLeft + GRID_WIDTH, gridTop - row * ROW);
  }
  for (let string = 0; string < strings; string += 1) line(x(string), gridTop, x(string), bottom);
  if (geometry.baseFret > 1) {
    page.drawText(String(geometry.baseFret), {
      x: left + 3,
      y: y(0) - 3,
      size: 7,
      font,
      color: INK,
    });
  }
  for (const string of geometry.open) {
    page.drawCircle({
      x: x(string),
      y: gridTop + 5,
      size: 2.2,
      borderColor: INK,
      borderWidth: 0.7,
    });
  }
  for (const string of geometry.muted) {
    const cy = gridTop + 5;
    line(x(string) - 2, cy - 2, x(string) + 2, cy + 2, 0.8);
    line(x(string) - 2, cy + 2, x(string) + 2, cy - 2, 0.8);
  }
  if (geometry.barre) {
    const cy = y(geometry.barre.row);
    page.drawRectangle({
      x: x(geometry.barre.from) - 3,
      y: cy - 3,
      width: x(geometry.barre.to) - x(geometry.barre.from) + 6,
      height: 6,
      color: INK,
    });
  }
  for (const dot of geometry.dots) {
    page.drawCircle({ x: x(dot.string), y: y(dot.row), size: 3, color: INK });
  }
}
