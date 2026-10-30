import { midiToFrequency } from "../notes";

export interface SynthNote {
  midi: number;
  /** Seconds from the start of the recording. */
  start: number;
  /** Seconds the string rings before it is damped. */
  duration: number;
  /** A hammer-on or pull-off: no pick attack, the previous note fades into this one. */
  legato?: boolean;
  /** 0..1, default 0.8. */
  velocity?: number;
}

export type Instrument = "bass" | "guitar";

export interface SynthOptions {
  sampleRate: number;
  instrument: Instrument;
  /** Seed for the noise generator, so fixtures are reproducible. */
  seed?: number;
  /** RMS of white background noise relative to full scale. */
  noiseFloor?: number;
  /** Extra gain on the fundamental of low bass notes (below MIDI 40); 1 keeps the default. */
  fundamentalGain?: number;
}

/** Small deterministic PRNG (mulberry32). */
export function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Additive plucked-string model: a stack of slightly stretched harmonics that decay faster the
 * higher they are, a short noisy pick attack, and a damped release. Low bass notes get a weak
 * fundamental and a strong second harmonic, as on a real instrument, so octave errors are a
 * real risk. Not a recording, but it has the properties that make pitch detection hard.
 */
export function renderNotes(
  notes: SynthNote[],
  seconds: number,
  options: SynthOptions,
): Float32Array {
  const { sampleRate, instrument } = options;
  const out = new Float32Array(Math.ceil(seconds * sampleRate));
  const random = prng(options.seed ?? 1);
  const sorted = [...notes].sort((a, b) => a.start - b.start);

  sorted.forEach((note, index) => {
    const f0 = midiToFrequency(note.midi);
    const velocity = note.velocity ?? 0.8;
    const begin = Math.round(note.start * sampleRate);
    const nextStart = sorted[index + 1] ? sorted[index + 1].start : Infinity;
    const nextLegato = sorted[index + 1]?.legato ?? false;
    const ringEnd = Math.min(note.start + note.duration, nextStart);
    // Release: damped over 25 ms, or crossfaded over 20 ms into a legato successor.
    const fade = nextLegato ? 0.02 : 0.025;
    const end = Math.min(out.length, Math.round((ringEnd + fade) * sampleRate));
    const baseDecay =
      (instrument === "bass" ? 1.4 : 1.0) * (1 + 0.5 * Math.exp(-(note.midi - 28) / 14));
    const stretch = instrument === "bass" ? 0.00004 : 0.00008;
    const harmonics: { w: number; amp: number; tau: number; phase: number }[] = [];
    for (let h = 1; h * f0 < sampleRate * 0.45 && h <= 14; h++) {
      let amp = 1 / h ** (instrument === "bass" ? 0.9 : 1.1);
      if (instrument === "bass" && note.midi < 40) {
        if (h === 1) amp *= 0.35 * (options.fundamentalGain ?? 1);
        if (h === 2) amp *= 1.4;
      }
      const frequency = f0 * h * Math.sqrt(1 + stretch * h * h);
      harmonics.push({
        w: (2 * Math.PI * frequency) / sampleRate,
        amp,
        tau: baseDecay / (1 + 0.55 * (h - 1)),
        phase: random() * 2 * Math.PI,
      });
    }
    const attack = note.legato ? 0.012 : 0.003;
    const gain = velocity * 0.5;
    let noiseState = 0;
    for (let i = begin; i < end; i++) {
      const t = (i - begin) / sampleRate;
      let value = 0;
      for (const h of harmonics)
        value += h.amp * Math.exp(-t / h.tau) * Math.sin(h.w * (i - begin) + h.phase);
      let envelope = Math.min(1, t / attack);
      if (t > ringEnd - note.start)
        envelope *= Math.max(0, 1 - (t - (ringEnd - note.start)) / fade);
      let sample = value * envelope;
      if (!note.legato && t < 0.012) {
        // Pick noise: low-passed white noise that dies in a few milliseconds.
        noiseState += 0.3 * (random() * 2 - 1 - noiseState);
        sample += noiseState * Math.exp(-t / 0.004) * 1.6;
      }
      out[i] += gain * sample;
    }
  });

  if (options.noiseFloor) {
    for (let i = 0; i < out.length; i++)
      out[i] += options.noiseFloor * (random() * 2 - 1) * Math.sqrt(3);
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0.95) for (let i = 0; i < out.length; i++) out[i] *= 0.95 / peak;
  return out;
}

export interface StrumNote {
  midi: number;
  /** Seconds the string rings. */
  duration?: number;
}

/**
 * A strummed chord: every string is rendered on its own (the string model is monophonic) and
 * the strings are summed, each starting `spread` seconds after the one before. Down strums run
 * from the lowest string up, up strums the other way.
 */
export function renderStrum(
  midis: number[],
  start: number,
  seconds: number,
  options: SynthOptions & { spread?: number; duration?: number; up?: boolean },
): Float32Array {
  const out = new Float32Array(Math.ceil(seconds * options.sampleRate));
  const ordered = [...midis].sort((a, b) => (options.up ? b - a : a - b));
  ordered.forEach((midi, index) => {
    const string = renderNotes(
      [
        {
          midi,
          start: start + index * (options.spread ?? 0.014),
          duration: options.duration ?? 1.2,
          velocity: 0.7,
        },
      ],
      seconds,
      { ...options, seed: (options.seed ?? 1) + index },
    );
    for (let i = 0; i < out.length; i++) out[i] += string[i] * 0.45;
  });
  return out;
}
