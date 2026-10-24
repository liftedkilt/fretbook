import type { RhythmPattern } from "./patterns";

export interface BeamInfo {
  /** How many cell intervals to span from this stem to the target stem. */
  span: number;
  /** Whether to draw a secondary sixteenth-note beam. */
  secondary: boolean;
}

/**
 * Calculates whether a beam starts at the given cell in the pattern.
 * A beam connects consecutive hits within the same beat.
 *
 * @param pattern The rhythm pattern (grid defines cells per beat).
 * @param cell The cell index to inspect.
 * @param isHit Optional predicate returning whether a cell index is a hit.
 */
export function beamAt(
  pattern: RhythmPattern,
  cell: number,
  isHit?: (cell: number) => boolean,
): BeamInfo | null {
  if (pattern.grid < 2) return null;
  const checkHit = isHit ?? ((i: number) => pattern.cells[i] === "x");
  if (!checkHit(cell)) return null;

  const beatStart = Math.floor(cell / pattern.grid) * pattern.grid;
  const beatEnd = beatStart + pattern.grid;

  // If the preceding cell in this beat is also a hit, it is already part of the beam group.
  if (cell > beatStart && checkHit(cell - 1)) {
    return null;
  }

  // Count consecutive hits within this beat.
  let end = cell;
  while (end + 1 < beatEnd && checkHit(end + 1)) {
    end++;
  }

  const span = end - cell;
  if (span === 0) return null;

  return {
    span,
    secondary: pattern.grid === 4,
  };
}

/**
 * Checks whether an isolated hit note needs a flag (e.g. an isolated eighth or sixteenth note).
 */
export function hasFlag(
  pattern: RhythmPattern,
  cell: number,
  isHit?: (cell: number) => boolean,
): boolean {
  if (pattern.grid < 2) return false;
  const checkHit = isHit ?? ((i: number) => pattern.cells[i] === "x");
  if (!checkHit(cell)) return false;

  const beatStart = Math.floor(cell / pattern.grid) * pattern.grid;
  const beatEnd = beatStart + pattern.grid;

  const prevHit = cell > beatStart && checkHit(cell - 1);
  const nextHit = cell + 1 < beatEnd && checkHit(cell + 1);

  return !prevHit && !nextHit;
}
