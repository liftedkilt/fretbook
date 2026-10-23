import type { AsciiTabBody } from "./api-types";

/** Shortest note a pasted tab's positions snap to (4 = quarter … 32 = thirty-second). */
export const GRIDS = [4, 8, 16, 32] as const;
export type Grid = (typeof GRIDS)[number];

export const DEFAULT_GRID: Grid = 8;

export interface AsciiTabForm {
  text: string;
  title: string;
  artist: string;
  grid: Grid;
  /** Blank (null) means "use the tempo written in the text, or 120". */
  bpm: number | null;
  numerator: number;
  denominator: number;
}

const DENOMINATORS = [1, 2, 4, 8, 16, 32];

/** The request for the form, or null while there is nothing to convert or the timing is not valid yet. */
export function asciiTabBody(form: AsciiTabForm): AsciiTabBody | null {
  if (!form.text.trim()) return null;
  const { numerator, denominator } = form;
  if (!Number.isInteger(numerator) || numerator < 1 || numerator > 32) return null;
  if (!DENOMINATORS.includes(denominator)) return null;
  const bpm =
    form.bpm !== null && Number.isFinite(form.bpm) && form.bpm > 0 && form.bpm < 400
      ? form.bpm
      : null;
  return {
    text: form.text,
    title: form.title.trim(),
    artist: form.artist.trim(),
    grid: form.grid,
    signature: [numerator, denominator],
    bpm,
  };
}

/** Run `action` once `wait` ms after the last call. `cancel` drops a pending call. */
export function debounced<Args extends unknown[]>(
  action: (...args: Args) => void,
  wait: number,
): { call: (...args: Args) => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  return {
    call: (...args) => {
      cancel();
      timer = setTimeout(() => {
        timer = undefined;
        action(...args);
      }, wait);
    },
    cancel,
  };
}
