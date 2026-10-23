import { DEFAULT_A4, centsBetween, describePitch, midiToFrequency } from "./listen/notes";

/** Range of the A4 reference the tuner offers. */
export const A4_MIN = 432;
export const A4_MAX = 446;

/** A string counts as in tune within this many cents. */
export const IN_TUNE_CENTS = 3;

/** Readings this close to centre are shown as exactly centred, so the display does not twitch. */
export const DEAD_ZONE_CENTS = 1.5;

/** Seconds a string must stay in tune before it is marked tuned. */
export const HOLD_SECONDS = 1;

/** How many recent pitch readings the median filter looks at. */
export const SMOOTH_WINDOW = 5;

/** The last note is held this many seconds through a dropout before the display clears. */
export const DROPOUT_SECONDS = 0.4;

/** A jump bigger than this many cents is a new note: the median filter starts over. */
export const NEW_NOTE_CENTS = 80;

/** Needle readings are clamped to this many cents either side of centre. */
export const NEEDLE_RANGE = 50;

export interface TunerPreset {
  id: string;
  /** Locale key for the preset's name. */
  labelKey: string;
  /** Open-string MIDI notes, highest string first (the order of a track's `tuning_midi`). */
  midi: number[];
}

/** Standard tunings the tuner offers beside the song's own. Strings run highest to lowest. */
export const PRESETS: TunerPreset[] = [
  { id: "standard", labelKey: "tuner.preset.standard", midi: [64, 59, 55, 50, 45, 40] },
  { id: "dropD", labelKey: "tuner.preset.dropD", midi: [64, 59, 55, 50, 45, 38] },
  { id: "eb", labelKey: "tuner.preset.eb", midi: [63, 58, 54, 49, 44, 39] },
  { id: "dadgad", labelKey: "tuner.preset.dadgad", midi: [62, 57, 55, 50, 45, 38] },
  { id: "openG", labelKey: "tuner.preset.openG", midi: [62, 59, 55, 50, 43, 38] },
  { id: "bass4", labelKey: "tuner.preset.bass4", midi: [43, 38, 33, 28] },
  { id: "bass5", labelKey: "tuner.preset.bass5", midi: [43, 38, 33, 28, 23] },
  { id: "bass6", labelKey: "tuner.preset.bass6", midi: [48, 43, 38, 33, 28, 23] },
];

export function clampA4(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_A4;
  return Math.min(A4_MAX, Math.max(A4_MIN, Math.round(value)));
}

/** What the open strings sound like with a capo on. */
export function withCapo(tuning: number[], capo: number): number[] {
  return tuning.map((midi) => midi + Math.max(0, capo));
}

export interface StringMatch {
  /** Index into the tuning (0 is the first, highest, string). */
  index: number;
  cents: number;
}

/** The string closest to a detected pitch, and how many cents the pitch is off that string. */
export function nearestString(
  frequency: number,
  tuning: number[],
  a4 = DEFAULT_A4,
): StringMatch | null {
  if (!(frequency > 0) || tuning.length === 0) return null;
  let best: StringMatch | null = null;
  tuning.forEach((midi, index) => {
    const cents = centsBetween(frequency, midiToFrequency(midi, a4));
    if (!best || Math.abs(cents) < Math.abs(best.cents)) best = { index, cents };
  });
  return best;
}

/** Nearest note to a pitch, for the chromatic mode. */
export function chromaticMatch(
  frequency: number,
  a4 = DEFAULT_A4,
): { midi: number; cents: number } | null {
  if (!(frequency > 0)) return null;
  return describePitch(frequency, a4);
}

/** Needle position from -1 (far flat) to 1 (far sharp). */
export function needlePosition(cents: number): number {
  return Math.min(1, Math.max(-1, cents / NEEDLE_RANGE));
}

export function isInTune(cents: number): boolean {
  return Math.abs(cents) <= IN_TUNE_CENTS;
}

/** Cents shown on screen: anything inside the dead zone reads as centred. */
export function displayCents(cents: number): number {
  return Math.abs(cents) <= DEAD_ZONE_CENTS ? 0 : cents;
}

/** The cents `frequency` is off one chosen string of the tuning. */
export function centsFromString(
  frequency: number,
  tuning: number[],
  index: number,
  a4 = DEFAULT_A4,
): number | null {
  if (!(frequency > 0) || index < 0 || index >= tuning.length) return null;
  return centsBetween(frequency, midiToFrequency(tuning[index], a4));
}

/**
 * Steadies the detected pitch: a median over the last few readings (in the log-frequency domain),
 * a restart when the player moves to a new note, and a short hold through dropouts.
 */
export class PitchSmoother {
  private window: number[] = [];
  private last: number | null = null;
  private lastTime = 0;

  /** Feed one reading (`null` when no pitch was heard) at `time` seconds; returns the steady pitch. */
  push(time: number, frequency: number | null): number | null {
    if (frequency === null || !(frequency > 0)) {
      if (this.last !== null && time - this.lastTime <= DROPOUT_SECONDS) return this.last;
      this.reset();
      return null;
    }
    const value = Math.log2(frequency);
    if (this.last !== null && Math.abs(value - Math.log2(this.last)) * 1200 > NEW_NOTE_CENTS) {
      this.window = [];
    }
    this.window.push(value);
    if (this.window.length > SMOOTH_WINDOW) this.window.shift();
    const sorted = [...this.window].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    this.last = 2 ** median;
    this.lastTime = time;
    return this.last;
  }

  reset(): void {
    this.window = [];
    this.last = null;
  }
}

export interface TuneUpdate {
  /** 0 to 1: how far the current string is through its hold. */
  progress: number;
  /** The string has held in tune for the whole hold time. */
  confirmed: boolean;
  /** The hold finished on this reading for a string that was not marked tuned yet. */
  newlyTuned: boolean;
}

/** Times how long a string stays in tune and remembers which strings have been tuned. */
export class TuneTracker {
  readonly tuned = new Set<number>();
  private target: number | null = null;
  private since: number | null = null;
  private done = false;

  constructor(private readonly holdSeconds = HOLD_SECONDS) {}

  /**
   * Feed one reading at `time` seconds (a `null` target or cents when nothing is playing).
   * With `remember` off (chromatic mode) nothing is added to `tuned`, but a hold still confirms.
   */
  update(time: number, target: number | null, cents: number | null, remember = true): TuneUpdate {
    if (target === null || cents === null || !isInTune(cents)) {
      this.target = target;
      this.since = null;
      this.done = false;
      return { progress: 0, confirmed: false, newlyTuned: false };
    }
    if (target !== this.target || this.since === null) {
      this.target = target;
      this.since = time;
      this.done = false;
    }
    const progress = Math.min(1, Math.max(0, (time - this.since) / this.holdSeconds));
    const confirmed = progress >= 1;
    let newlyTuned = false;
    if (confirmed && !this.done) {
      this.done = true;
      newlyTuned = !remember || !this.tuned.has(target);
      if (remember) this.tuned.add(target);
    }
    return { progress, confirmed, newlyTuned };
  }

  /** Forget the current hold and, with `all`, which strings were tuned. */
  reset(all = true): void {
    this.target = null;
    this.since = null;
    this.done = false;
    if (all) this.tuned.clear();
  }
}

/** A short two-note chime for a string that just came into tune. */
export function playSuccessChime(): void {
  try {
    const context = new AudioContext();
    const notes = [880, 1318.5];
    notes.forEach((frequency, i) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + i * 0.12;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.15, start + 0.02);
      gain.gain.linearRampToValueAtTime(0, start + 0.25);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.27);
    });
    window.setTimeout(() => void context.close().catch(() => undefined), 600);
  } catch {
    // No audio output available: the visual confirmation is enough.
  }
}

export interface ReferenceTone {
  stop(): void;
}

/** A quiet sine at `frequency` until `stop()`. Needs a user gesture to start. */
export function playReferenceTone(frequency: number): ReferenceTone {
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0, context.currentTime);
  gain.gain.linearRampToValueAtTime(0.2, context.currentTime + 0.05);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  return {
    stop() {
      try {
        gain.gain.cancelScheduledValues(context.currentTime);
        gain.gain.setValueAtTime(gain.gain.value, context.currentTime);
        gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.05);
        oscillator.stop(context.currentTime + 0.06);
      } finally {
        window.setTimeout(() => void context.close().catch(() => undefined), 120);
      }
    },
  };
}
