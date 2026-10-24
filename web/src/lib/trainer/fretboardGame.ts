/*
 * The fretboard note trainer: a note name and a string are shown, and the player finds the note
 * on that string, by tapping the fretboard or by playing it. Everything here is pure, with the
 * random source passed in, so it is tested without a browser.
 */

export type Rng = () => number;

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

export type Accidentals = "sharps" | "flats";

/** The name of a pitch class (C = 0), spelled with sharps or flats. */
export function noteName(pitchClass: number, accidentals: Accidentals = "sharps"): string {
  const names = accidentals === "flats" ? FLAT_NAMES : SHARP_NAMES;
  return names[((pitchClass % 12) + 12) % 12];
}

export interface FretQuestion {
  /** Pitch class to find, C = 0. */
  pitchClass: number;
  /** 0-based string, 0 being the highest string (as in `Fretboard`). */
  string: number;
}

export function randomInt(rng: Rng, below: number): number {
  return Math.min(below - 1, Math.floor(rng() * below));
}

/**
 * The next question. `strings` limits which strings come up; `previous` is avoided so the same
 * question does not come twice in a row. Strings the player is weakest on come up more often
 * when `weights` is given (one weight per string, higher is more likely).
 */
export function nextQuestion(
  rng: Rng,
  stringCount: number,
  options: { strings?: readonly number[]; previous?: FretQuestion | null; weights?: number[] } = {},
): FretQuestion {
  const pool = (options.strings ?? Array.from({ length: stringCount }, (_, i) => i)).filter(
    (s) => s >= 0 && s < stringCount,
  );
  const candidates = pool.length ? pool : Array.from({ length: stringCount }, (_, i) => i);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const total = candidates.reduce((sum, s) => sum + Math.max(0.1, options.weights?.[s] ?? 1), 0);
    let pick = rng() * total;
    let string = candidates[candidates.length - 1];
    for (const candidate of candidates) {
      pick -= Math.max(0.1, options.weights?.[candidate] ?? 1);
      if (pick < 0) {
        string = candidate;
        break;
      }
    }
    const question = { pitchClass: randomInt(rng, 12), string };
    const { previous } = options;
    if (
      !previous ||
      previous.pitchClass !== question.pitchClass ||
      previous.string !== question.string
    )
      return question;
  }
  return { pitchClass: randomInt(rng, 12), string: candidates[0] };
}

/** Frets (0 = open) on a string where the question's note sounds. */
export function answerFrets(
  tuning: readonly number[],
  question: FretQuestion,
  frets: number,
): number[] {
  const open = tuning[question.string];
  const result: number[] = [];
  for (let fret = 0; fret <= frets; fret += 1) {
    if ((open + fret) % 12 === question.pitchClass) result.push(fret);
  }
  return result;
}

/** A tap on the fretboard answers when it is on the asked string and sounds the asked note. */
export function checkTap(
  tuning: readonly number[],
  question: FretQuestion,
  tap: { string: number; fret: number },
): boolean {
  if (tap.string !== question.string) return false;
  const open = tuning[tap.string];
  return open !== undefined && (open + tap.fret) % 12 === question.pitchClass;
}

/** A played note answers when it is the asked note, within the frets of the asked string. */
export function checkPlayed(
  tuning: readonly number[],
  question: FretQuestion,
  midi: number,
  frets: number,
): boolean {
  const open = tuning[question.string];
  if (open === undefined) return false;
  return midi >= open && midi <= open + frets && midi % 12 === question.pitchClass;
}

/**
 * Turns a stream of pitch readings into notes the player meant: a note counts once the same
 * pitch has been read `needed` times in a row, and is reported again only after silence or a
 * different note.
 */
export class StableNote {
  private candidate: number | null = null;
  private count = 0;
  private reported: number | null = null;

  constructor(private readonly needed = 3) {}

  /** Feed a reading (`null` for no pitch). Returns the MIDI note when it has just become stable. */
  push(midi: number | null): number | null {
    if (midi === null) {
      this.candidate = null;
      this.count = 0;
      this.reported = null;
      return null;
    }
    if (midi === this.candidate) this.count += 1;
    else {
      this.candidate = midi;
      this.count = 1;
    }
    if (this.count >= this.needed && this.reported !== midi) {
      this.reported = midi;
      return midi;
    }
    return null;
  }

  reset(): void {
    this.push(null);
  }
}

export interface StringStat {
  asked: number;
  correct: number;
  /** Total milliseconds taken over the correct answers. */
  totalMs: number;
}

export type StringStats = Record<string, StringStat>;

export function emptyStat(): StringStat {
  return { asked: 0, correct: 0, totalMs: 0 };
}

/** Fold one answer into the per-string statistics (returns a new object). */
export function recordAnswer(
  stats: StringStats,
  string: number,
  correct: boolean,
  ms: number,
): StringStats {
  const before = stats[string] ?? emptyStat();
  return {
    ...stats,
    [string]: {
      asked: before.asked + 1,
      correct: before.correct + (correct ? 1 : 0),
      totalMs: before.totalMs + (correct ? Math.max(0, ms) : 0),
    },
  };
}

/** Share of answers that were right, 0 to 1, or null with no answers. */
export function accuracy(stat: StringStat | undefined): number | null {
  return stat && stat.asked > 0 ? stat.correct / stat.asked : null;
}

/** Mean time of the correct answers in milliseconds, or null with none. */
export function meanMs(stat: StringStat | undefined): number | null {
  return stat && stat.correct > 0 ? stat.totalMs / stat.correct : null;
}

/**
 * Weights for `nextQuestion`: strings with a low hit rate come up more often, untried ones count
 * as middling so every string gets asked.
 */
export function weakStringWeights(stats: StringStats, stringCount: number): number[] {
  return Array.from({ length: stringCount }, (_, string) => {
    const rate = accuracy(stats[string]);
    return rate === null ? 1.5 : 1 + (1 - rate) * 3;
  });
}
