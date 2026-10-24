import type { ChordDefine } from "../chordpro";
import { parseChord, type ParsedChord } from "./theory";

/**
 * Chord voicings, generated.
 *
 * Fretbook computes every shape itself from the open-string pitches: it tries
 * each fret window of four frets (plus open strings) and keeps the fingerings
 * that sound every essential note of the chord, are playable with four
 * fingers, and read well. No third-party chord table is used, so there is
 * no data licence to carry; the generator and its ranking are this file.
 *
 * Strings run from the lowest-numbered (left in a diagram) to the highest,
 * as in ChordPro `{define:}`; for a re-entrant ukulele that is G C E A. This
 * is the reverse of the tuner's `tuning_midi` order (see `physicalTuning`).
 */

export interface Barre {
  fret: number;
  /** String indices, inclusive. */
  from: number;
  to: number;
}

export interface Voicing {
  /** Absolute fret per string, `null` muted, 0 open. */
  frets: (number | null)[];
  /** First fret of the drawn window: 1 when everything fits near the nut. */
  baseFret: number;
  barre: Barre | null;
  /** Where it came from: generated, or a `{define:}` in the song. */
  source: "generated" | "define";
}

export interface GenerateOptions {
  /** The lowest sounding note must be the root (or slash bass). Off for ukulele. */
  rootInBass?: boolean;
  /** How many voicings to keep. */
  limit?: number;
}

const WINDOW = 4;
const MAX_START = 12;
const MAX_FINGERS = 4;
/** An open string next to frets above this is a stretch no one plays. */
const OPEN_STRING_REACH = 5;

export function voicingKey(frets: (number | null)[]): string {
  return frets.map((fret) => (fret === null ? "x" : String(fret))).join(".");
}

/** A tuner tuning (highest string first) as the diagram's string order (lowest string first). */
export function physicalTuning(tuning: number[]): number[] {
  return [...tuning].reverse();
}

function findBarre(frets: (number | null)[]): Barre | null {
  const fretted = frets.filter((fret): fret is number => fret !== null && fret > 0);
  if (fretted.length < 2) return null;
  const lowest = Math.min(...fretted);
  const first = frets.indexOf(lowest);
  const last = frets.lastIndexOf(lowest);
  // A barre starts at the lowest sounding string: a finger laid across the strings from there.
  if (first === last || first !== frets.findIndex((fret) => fret !== null)) return null;
  for (let index = first; index <= last; index += 1) {
    const fret = frets[index];
    if (fret === null || fret < lowest) return null;
  }
  return { fret: lowest, from: first, to: last };
}

function fingersNeeded(frets: (number | null)[], barre: Barre | null): number {
  let count = 0;
  frets.forEach((fret, index) => {
    if (fret === null || fret === 0) return;
    if (barre && fret === barre.fret && index >= barre.from && index <= barre.to) return;
    count += 1;
  });
  return count + (barre ? 1 : 0);
}

function baseFretOf(frets: (number | null)[]): number {
  const fretted = frets.filter((fret): fret is number => fret !== null && fret > 0);
  if (!fretted.length) return 1;
  return Math.max(...fretted) <= WINDOW ? 1 : Math.min(...fretted);
}

function toVoicing(frets: (number | null)[], source: Voicing["source"]): Voicing {
  return { frets, baseFret: baseFretOf(frets), barre: findBarre(frets), source };
}

function score(frets: (number | null)[], barre: Barre | null): number {
  const fretted = frets.filter((fret): fret is number => fret !== null && fret > 0);
  const sounding = frets.filter((fret) => fret !== null).length;
  const open = frets.filter((fret) => fret === 0).length;
  const muted = frets.length - sounding;
  const low = fretted.length ? Math.min(...fretted) : 0;
  const high = fretted.length ? Math.max(...fretted) : 0;
  return (
    muted * 1.5 +
    low * 0.5 +
    (high - low) * 2 +
    (barre ? 3 : 0) +
    fingersNeeded(frets, barre) -
    open * 0.8 -
    sounding
  );
}

function generate(tuning: number[], chord: ParsedChord, options: GenerateOptions): Voicing[] {
  const strings = tuning.length;
  const limit = options.limit ?? 6;
  const rootInBass = options.rootInBass ?? true;
  const allowed = new Set([...chord.required, ...chord.optional]);
  const wanted = chord.bass ?? chord.root;
  const minSounding = Math.min(3, strings);
  const found = new Map<string, { frets: (number | null)[]; score: number }>();

  const check = (frets: (number | null)[]): void => {
    let lowestIndex = -1;
    let lowestPitch = Infinity;
    const present = new Set<number>();
    let sounding = 0;
    let seenSound = false;
    for (let index = 0; index < strings; index += 1) {
      const fret = frets[index];
      if (fret === null) {
        if (seenSound) return;
        continue;
      }
      seenSound = true;
      sounding += 1;
      const pitch = tuning[index] + fret;
      present.add(pitch % 12);
      if (pitch < lowestPitch) {
        lowestPitch = pitch;
        lowestIndex = index;
      }
    }
    if (sounding < minSounding || lowestIndex < 0) return;
    if (!chord.required.every((pitch) => present.has(pitch))) return;
    const lowestClass = lowestPitch % 12;
    if (rootInBass ? lowestClass !== wanted : !present.has(wanted)) return;
    if (frets.includes(0) && Math.max(...frets.map((fret) => fret ?? 0)) > OPEN_STRING_REACH)
      return;
    const barre = findBarre(frets);
    if (fingersNeeded(frets, barre) > MAX_FINGERS) return;
    const key = voicingKey(frets);
    if (!found.has(key)) found.set(key, { frets, score: score(frets, barre) });
  };

  for (let start = 1; start <= MAX_START; start += 1) {
    const options: (number | null)[][] = tuning.map((open) => {
      const list: (number | null)[] = [null];
      if (allowed.has(open % 12)) list.push(0);
      for (let fret = start; fret < start + WINDOW; fret += 1) {
        if (allowed.has((open + fret) % 12)) list.push(fret);
      }
      return list;
    });
    const walk = (index: number, picked: (number | null)[]): void => {
      if (index === strings) {
        check(picked);
        return;
      }
      for (const fret of options[index]) walk(index + 1, [...picked, fret]);
    };
    walk(0, []);
  }

  const ranked = [...found.entries()].sort(
    (left, right) => left[1].score - right[1].score || (left[0] < right[0] ? -1 : 1),
  );
  const picked: string[] = [];
  const perPosition = new Map<number, number>();
  const take = (key: string, capped: boolean): void => {
    if (picked.length >= limit || picked.includes(key)) return;
    const position = baseFretOf(found.get(key)!.frets);
    if (capped && (perPosition.get(position) ?? 0) >= 2) return;
    perPosition.set(position, (perPosition.get(position) ?? 0) + 1);
    picked.push(key);
  };
  for (const [key] of ranked) take(key, true);
  for (const [key] of ranked) take(key, false);
  return picked.map((key) => toVoicing(found.get(key)!.frets, "generated"));
}

const cache = new Map<string, Voicing[]>();

/** Generated voicings for a chord, best first. Empty when the symbol is not a chord. */
export function generateVoicings(
  tuning: number[],
  chordName: string,
  options: GenerateOptions = {},
): Voicing[] {
  const chord = parseChord(chordName);
  if (!chord || tuning.length < 3) return [];
  const key = [
    tuning.join(","),
    chord.root,
    chord.quality,
    chord.bass,
    options.rootInBass ?? true,
    options.limit ?? 6,
  ].join("|");
  let voicings = cache.get(key);
  if (!voicings) {
    voicings = generate(tuning, chord, options);
    cache.set(key, voicings);
  }
  return voicings;
}

/** A `{define:}` fingering as a voicing, or `null` if it is for another number of strings. */
export function defineVoicing(define: ChordDefine, strings: number): Voicing | null {
  if (define.frets.length !== strings) return null;
  return toVoicing(define.frets, "define");
}

/**
 * The voicings to pick from for a chord shown under `name`: the song's own
 * `{define:}` first, then the generated ones.
 */
export function voicingsFor(
  name: string,
  tuning: number[],
  defines: Record<string, ChordDefine>,
  options: GenerateOptions = {},
): Voicing[] {
  const generated = generateVoicings(tuning, name, options);
  const define = defines[name];
  const defined = define ? defineVoicing(define, tuning.length) : null;
  if (!defined) return generated;
  const key = voicingKey(defined.frets);
  return [defined, ...generated.filter((voicing) => voicingKey(voicing.frets) !== key)];
}
