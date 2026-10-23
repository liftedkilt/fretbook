import { DEFAULT_A4, centsBetween, describePitch, midiToFrequency } from "./listen/notes";

/** Range of the A4 reference the tuner offers. */
export const A4_MIN = 432;
export const A4_MAX = 446;

/** A string counts as in tune within this many cents. */
export const IN_TUNE_CENTS = 5;

/** Needle readings are clamped to this many cents either side of centre. */
export const NEEDLE_RANGE = 50;

/** Consecutive in-tune readings before the "string in tune" tick appears. */
export const TICK_READINGS = 6;

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

/** Counts steady in-tune readings so one lucky reading does not flash the tick. */
export class InTuneTracker {
  private count = 0;
  private target: number | null = null;

  /** Feed one reading (or null when nothing is playing). Returns whether the tick should show. */
  update(target: number | null, cents: number | null): boolean {
    if (target === null || cents === null || !isInTune(cents)) {
      this.count = 0;
      this.target = target;
      return false;
    }
    if (target !== this.target) {
      this.target = target;
      this.count = 0;
    }
    this.count += 1;
    return this.count >= TICK_READINGS;
  }

  reset(): void {
    this.count = 0;
    this.target = null;
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
