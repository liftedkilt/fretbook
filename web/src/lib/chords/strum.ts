import type { Voicing } from "./voicings";

/** Hear a chord: a synthesized strum, low string to high. */

export interface StrumNote {
  midi: number;
  /** Seconds after the strum starts. */
  delay: number;
}

/** Gap between strings in a downstroke. */
export const STRUM_GAP = 0.035;

/**
 * The notes of a voicing in strum order. Strings are lowest first and a capo
 * raises every string, so what plays is `open + capo + fret`.
 */
export function strumNotes(voicing: Voicing, tuning: number[], capo = 0): StrumNote[] {
  const notes: StrumNote[] = [];
  voicing.frets.forEach((fret, index) => {
    if (fret === null || index >= tuning.length) return;
    notes.push({ midi: tuning[index] + Math.max(0, capo) + fret, delay: notes.length * STRUM_GAP });
  });
  return notes;
}

export function midiFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

let shared: AudioContext | null = null;

/** Play notes with a plucked-string sound. Does nothing where WebAudio is missing. */
export function playStrum(notes: StrumNote[], makeContext: () => AudioContext = defaultContext) {
  let context: AudioContext;
  try {
    shared ??= makeContext();
    context = shared;
  } catch {
    return;
  }
  void context.resume?.();
  const start = context.currentTime + 0.02;
  for (const note of notes) {
    const at = start + note.delay;
    const frequency = midiFrequency(note.midi);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.22, at + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.6);
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(Math.min(6000, frequency * 8), at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(400, frequency * 1.5), at + 1.2);
    filter.connect(gain);
    gain.connect(context.destination);
    for (const [type, ratio, level] of [
      ["sawtooth", 1, 1],
      ["triangle", 2, 0.4],
    ] as const) {
      const oscillator = context.createOscillator();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency * ratio, at);
      const part = context.createGain();
      part.gain.value = level;
      oscillator.connect(part);
      part.connect(filter);
      oscillator.start(at);
      oscillator.stop(at + 1.7);
    }
  }
}

function defaultContext(): AudioContext {
  return new AudioContext();
}
