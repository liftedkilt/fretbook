/**
 * Capo suggestions for a chord sheet: which fret to clamp the capo at so the shapes are the easy open ones.
 * Chords are the sounding names; each candidate capo lowers every chord by that many semitones.
 */
import { CHORD, transposeChord } from "./chordpro";

export const MAX_SUGGESTED_CAPO = 7;

/** Open-position shapes, by root and quality. Everything else (sharps and flats, F, B, Bm, ...) counts as a barre. */
const EASY_ROOTS = new Set(["C", "D", "E", "G", "A"]);
const EASY_QUALITIES = new Set(["", "m", "7", "maj7", "m7", "sus2", "sus4", "add9", "6"]);
const EASY_MINOR_ROOTS = new Set(["A", "D", "E"]);

export interface CapoSuggestion {
  /** The fret to put the capo on, 1 or more. */
  capo: number;
  /** The shapes to play, in order of first use. */
  shapes: string[];
  /** How many of the shapes are not open chords; lower is easier. */
  barres: number;
}

function isOpenShape(chord: string): boolean {
  const match = CHORD.exec(chord);
  if (!match) return true;
  const [, root, quality] = match;
  if (!EASY_ROOTS.has(root) || !EASY_QUALITIES.has(quality)) return false;
  return !quality.startsWith("m") || quality.startsWith("maj") || EASY_MINOR_ROOTS.has(root);
}

function barreCount(shapes: string[]): number {
  return shapes.filter((shape) => !isOpenShape(shape)).length;
}

/**
 * Capo positions (1 to 7) that make the chords easier than they are with the `current` capo (none by default),
 * easiest first, at most `limit`. Pass the chords as they sound, so a sheet that already has a capo passes its
 * shapes raised by that capo. Chords that cannot be parsed (N.C.) are ignored.
 */
export function suggestCapos(
  chords: string[],
  flats = false,
  limit = 3,
  current = 0,
): CapoSuggestion[] {
  const sounding = [...new Set(chords.filter((chord) => CHORD.test(chord)))];
  if (sounding.length === 0) return [];
  const baseline = barreCount(sounding.map((chord) => transposeChord(chord, -current, flats)));
  const found: CapoSuggestion[] = [];
  for (let capo = 1; capo <= MAX_SUGGESTED_CAPO; capo += 1) {
    const shapes = sounding.map((chord) => transposeChord(chord, -capo, flats));
    const barres = barreCount(shapes);
    if (capo !== current && barres < baseline) found.push({ capo, shapes, barres });
  }
  return found.sort((a, b) => a.barres - b.barres || a.capo - b.capo).slice(0, limit);
}
