import { FFT } from "./fft";
import { frequencyToMidiFloat } from "./notes";

/*
 * Pitch-class content ("chroma") of a short stretch of sound, for wait mode on chords. The
 * monophonic detector cannot tell what a strummed chord contains, and transcribing every string
 * is fragile. Instead the spectrum's peaks are folded into twelve pitch classes and compared
 * with the notes the chord should contain.
 */

/** One chroma reading, stamped against the AudioContext clock (seconds). */
export interface ChromaEvent {
  /** Time of the newest sample in the analysed window. */
  time: number;
  /** Energy per pitch class, C = 0. All zeros when the window is silent. */
  bins: number[];
  /** Length of the analysed window, seconds. */
  span: number;
  /** True when a spectral-flux attack (a strum) was seen since the last reading. */
  onset: boolean;
  /** Estimated time of that attack, when `onset` is true. */
  onsetTime: number | null;
}

export interface ChromaOptions {
  sampleRate: number;
  /** Below this the low strings blur into their neighbours; their harmonics still count. */
  minFrequency?: number;
  maxFrequency?: number;
  /** Peaks weaker than this fraction of the strongest are noise. */
  peakFloor?: number;
}

/** Window length in samples: a power of two covering at least 0.15 s. */
export function chromaWindowSize(sampleRate: number): number {
  let size = 2048;
  while (size < 0.15 * sampleRate) size *= 2;
  return size;
}

/** Folds a window of audio into twelve pitch-class energies. */
export class ChromaAnalyzer {
  readonly size: number;
  private readonly fft: FFT;
  private readonly hann: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly mags: Float64Array;
  private readonly firstBin: number;
  private readonly lastBin: number;
  private readonly peakFloor: number;
  private readonly binHz: number;

  constructor(options: ChromaOptions) {
    this.size = chromaWindowSize(options.sampleRate);
    this.fft = new FFT(this.size);
    this.hann = new Float64Array(this.size);
    for (let i = 0; i < this.size; i++)
      this.hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (this.size - 1));
    this.re = new Float64Array(this.size);
    this.im = new Float64Array(this.size);
    this.mags = new Float64Array(this.size / 2);
    this.binHz = options.sampleRate / this.size;
    this.firstBin = Math.max(2, Math.floor((options.minFrequency ?? 90) / this.binHz));
    this.lastBin = Math.min(
      this.size / 2 - 2,
      Math.ceil((options.maxFrequency ?? 2500) / this.binHz),
    );
    this.peakFloor = options.peakFloor ?? 0.08;
  }

  /** `samples` must hold exactly `size` values. Returns twelve energies, or zeros for silence. */
  analyse(samples: Float32Array): number[] {
    const bins = new Array<number>(12).fill(0);
    for (let i = 0; i < this.size; i++) {
      this.re[i] = samples[i] * this.hann[i];
      this.im[i] = 0;
    }
    this.fft.transform(this.re, this.im);
    let strongest = 0;
    for (let k = 0; k < this.mags.length; k++) {
      this.mags[k] = Math.hypot(this.re[k], this.im[k]);
      if (k >= this.firstBin && k <= this.lastBin && this.mags[k] > strongest)
        strongest = this.mags[k];
    }
    if (strongest <= 0) return bins;
    const floor = strongest * this.peakFloor;
    for (let k = this.firstBin; k <= this.lastBin; k++) {
      const m = this.mags[k];
      if (m < floor || m < this.mags[k - 1] || m <= this.mags[k + 1]) continue;
      // Parabolic interpolation on the log magnitudes places the peak between bins.
      const a = Math.log(this.mags[k - 1] + 1e-12);
      const b = Math.log(m + 1e-12);
      const c = Math.log(this.mags[k + 1] + 1e-12);
      const denominator = a - 2 * b + c;
      const shift = denominator === 0 ? 0 : (0.5 * (a - c)) / denominator;
      const frequency = (k + shift) * this.binHz;
      const pitchClass = ((Math.round(frequencyToMidiFloat(frequency)) % 12) + 12) % 12;
      bins[pitchClass] += m;
    }
    return bins;
  }
}

/**
 * How well a chroma reading matches the pitch classes a chord should contain, 0..1. Two things
 * count: how much of the energy sits on the chord's notes, and how many of the chord's notes are
 * there at all. A wrong string costs a little of each; a different chord costs most of both.
 */
export function chromaScore(bins: readonly number[], pitchClasses: readonly number[]): number {
  const wanted = [...new Set(pitchClasses.map((pc) => ((pc % 12) + 12) % 12))];
  const total = bins.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || wanted.length === 0) return 0;
  const inChord = wanted.reduce((sum, pc) => sum + bins[pc], 0);
  const share = inChord / total;
  // A note is present when it holds a fair part of what an even split of the chord would give.
  const even = inChord / wanted.length;
  const present = wanted.filter((pc) => bins[pc] >= 0.35 * even).length / wanted.length;
  return share * (0.4 + 0.6 * present);
}
