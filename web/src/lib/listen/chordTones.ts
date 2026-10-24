/*
 * The pitch classes a chord name stands for, for checking a chord sheet by ear. This is
 * deliberately small and lives next to the listening code: it only needs to know which notes to
 * listen for, not how to draw or spell the chord.
 */

const NATURALS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Pitch class of a note name such as "F#", "Bb" or "E♭", or null when it is not one. */
export function notePitchClass(name: string): number | null {
  const match = /^([A-G])([#b♯♭]?)$/.exec(name.trim());
  if (!match) return null;
  const offset = match[2] === "#" || match[2] === "♯" ? 1 : match[2] ? -1 : 0;
  return (((NATURALS[match[1]] + offset) % 12) + 12) % 12;
}

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function pitchClassName(pitchClass: number): string {
  return SHARP_NAMES[((pitchClass % 12) + 12) % 12];
}

/**
 * Pitch classes (C = 0, ascending, root first) of a chord name like "Am7", "F#m7b5", "Dsus4",
 * "C/G" or "Bb6/9"-free forms. Returns null for anything that is not a chord ("N.C.", "%").
 */
export function chordPitchClasses(name: string): number[] | null {
  const match = /^([A-G][#b♯♭]?)([^/]*)(?:\/([A-G][#b♯♭]?))?$/.exec(name.trim());
  if (!match) return null;
  const root = notePitchClass(match[1]);
  if (root === null) return null;
  let rest = match[2].replace(/[()]/g, "");

  let third: number | null = 4;
  let fifth = 7;
  const extras = new Set<number>();
  let diminished = false;

  const take = (pattern: RegExp): boolean => {
    const found = pattern.exec(rest);
    if (!found) return false;
    rest = rest.slice(found[0].length);
    return true;
  };

  if (take(/^(maj|M|Δ)(?=\d|$)/)) {
    // Major, or a major seventh when a number follows ("maj7", "maj9").
    if (/^\d/.test(rest)) extras.add(11);
  } else if (take(/^(mmaj|mM|m\(maj\)|minmaj|mΔ)/)) {
    third = 3;
    extras.add(11);
  } else if (take(/^(min|m|-)/)) {
    third = 3;
  } else if (take(/^(dim|°|o)/)) {
    third = 3;
    fifth = 6;
    diminished = true;
  } else if (take(/^ø/)) {
    third = 3;
    fifth = 6;
    extras.add(10);
  } else if (take(/^(aug|\+)/)) {
    fifth = 8;
  }

  // The number: 5 is a power chord, the rest stack on the seventh.
  const number = /^(\d+)/.exec(rest);
  if (number) {
    rest = rest.slice(number[0].length);
    switch (number[1]) {
      case "5":
        third = null;
        break;
      case "6":
        extras.add(9);
        break;
      case "69":
        extras.add(9);
        extras.add(2);
        break;
      case "7":
        extras.add(extras.has(11) ? 11 : diminished ? 9 : 10);
        break;
      case "9":
        extras.add(extras.has(11) ? 11 : 10);
        extras.add(2);
        break;
      case "11":
        extras.add(extras.has(11) ? 11 : 10);
        extras.add(2);
        extras.add(5);
        break;
      case "13":
        extras.add(extras.has(11) ? 11 : 10);
        extras.add(2);
        extras.add(9);
        break;
      default:
        return null;
    }
  }

  // What is left: sus, add and altered tones, in any order.
  while (rest.length > 0) {
    let found = /^sus([24]?)/.exec(rest);
    if (found) {
      rest = rest.slice(found[0].length);
      third = null;
      extras.add(found[1] === "2" ? 2 : 5);
      continue;
    }
    found = /^(add)?(b|#|♭|♯)?(\d+)/.exec(rest);
    if (!found) return null;
    rest = rest.slice(found[0].length);
    const flat = found[2] === "b" || found[2] === "♭";
    const sharp = found[2] === "#" || found[2] === "♯";
    const degrees: Record<string, number> = { "2": 2, "4": 5, "5": 7, "9": 2, "11": 5, "13": 9 };
    const base = degrees[found[3]];
    if (base === undefined) return null;
    const tone = (base + (sharp ? 1 : flat ? -1 : 0) + 12) % 12;
    if (found[3] === "5" && !found[1]) fifth = tone;
    else extras.add(tone);
  }

  const tones = new Set<number>([0, fifth, ...extras]);
  if (third !== null) tones.add(third);
  const pcs = [...tones].map((tone) => (root + tone) % 12);
  const bass = match[3] ? notePitchClass(match[3]) : null;
  if (match[3] && bass === null) return null;
  if (bass !== null) pcs.push(bass);
  return [...new Set(pcs)];
}
