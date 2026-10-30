import { centsBetween } from "./notes";
import { FFT } from "./fft";

export interface PitchResult {
  frequency: number;
  /** Height of the normalised autocorrelation peak, 0..1. Near 1 for a clean periodic tone. */
  clarity: number;
}

export interface MpmOptions {
  sampleRate: number;
  /** Window length in samples; must be a power of two. */
  windowSize: number;
  minFrequency?: number;
  maxFrequency?: number;
  /** A peak qualifies when it is at least this fraction of the highest peak (McLeod's k). */
  cutoff?: number;
}

export interface DetectOptions {
  /** When set, a peak within `expectedToleranceCents` of this frequency wins over an octave error. */
  expectedFrequency?: number | null;
  expectedToleranceCents?: number;
  /** Never let the expected note pull the pick to a lower octave than the unbiased estimate. */
  strictOctave?: boolean;
}

/** Smallest power-of-two window that fits two periods of `minFrequency`. */
export function windowSizeFor(sampleRate: number, minFrequency: number): number {
  const needed = Math.ceil((2.1 * sampleRate) / minFrequency);
  let size = 256;
  while (size < needed) size <<= 1;
  return size;
}

/**
 * McLeod Pitch Method: normalised square difference function from an FFT autocorrelation,
 * first qualifying peak, parabolic interpolation. Allocates its buffers once.
 */
export class MpmDetector {
  readonly windowSize: number;
  private readonly sampleRate: number;
  private readonly minLag: number;
  private readonly maxLag: number;
  private readonly cutoff: number;
  private readonly fft: FFT;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly nsdf: Float64Array;

  constructor(options: MpmOptions) {
    this.sampleRate = options.sampleRate;
    this.windowSize = options.windowSize;
    this.cutoff = options.cutoff ?? 0.9;
    const maxFrequency = options.maxFrequency ?? 2000;
    const minFrequency = options.minFrequency ?? 28;
    this.minLag = Math.max(2, Math.floor(this.sampleRate / maxFrequency));
    this.maxLag = Math.min(this.windowSize - 2, Math.ceil(this.sampleRate / minFrequency));
    this.fft = new FFT(this.windowSize * 2);
    this.re = new Float64Array(this.windowSize * 2);
    this.im = new Float64Array(this.windowSize * 2);
    this.nsdf = new Float64Array(this.windowSize);
  }

  /** `samples` must hold at least `windowSize` values; the first `windowSize` are analysed. */
  detect(samples: Float32Array | Float64Array, options: DetectOptions = {}): PitchResult | null {
    const n = this.windowSize;
    const { re, im, nsdf } = this;
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < n; i++) re[i] = samples[i];
    this.fft.transform(re, im);
    for (let i = 0; i < re.length; i++) {
      re[i] = re[i] * re[i] + im[i] * im[i];
      im[i] = 0;
    }
    this.fft.transform(re, im, true);
    const scale = 1 / re.length;

    let m = 2 * re[0] * scale;
    if (m <= 1e-12) return null;
    nsdf[0] = 1;
    for (let tau = 1; tau < n; tau++) {
      m -= samples[tau - 1] ** 2 + samples[n - tau] ** 2;
      nsdf[tau] = m > 1e-12 ? (2 * re[tau] * scale) / m : 0;
    }

    // Key maxima: the highest point of each positive lobe after the first dip below zero.
    const peaks: number[] = [];
    let tau = 1;
    while (tau < this.maxLag && nsdf[tau] > 0) tau++;
    while (tau < this.maxLag) {
      while (tau < this.maxLag && nsdf[tau] <= 0) tau++;
      let best = -1;
      while (tau < this.maxLag && nsdf[tau] > 0) {
        if (tau >= this.minLag && (best < 0 || nsdf[tau] > nsdf[best])) best = tau;
        tau++;
      }
      if (best > 0 && best > 1 && best < n - 1) peaks.push(best);
    }
    if (peaks.length === 0) return null;

    let highest = 0;
    for (const p of peaks) highest = Math.max(highest, nsdf[p]);
    const threshold = this.cutoff * highest;
    let chosen = peaks.find((p) => nsdf[p] >= threshold) ?? peaks[0];

    const expected = options.expectedFrequency;
    if (expected && expected > 0) {
      const tolerance = options.expectedToleranceCents ?? 40;
      let nearest = -1;
      let nearestError = Infinity;
      for (const p of peaks) {
        const error = Math.abs(centsBetween(this.refine(p).frequency, expected));
        // A note an octave up also repeats at the expected period; strict mode must not fold it down.
        if (options.strictOctave && p > chosen) continue;
        if (error < tolerance && error < nearestError && nsdf[p] >= 0.5 * highest) {
          nearest = p;
          nearestError = error;
        }
      }
      if (nearest > 0) chosen = nearest;
    }

    return this.refine(chosen);
  }

  private refine(lag: number): PitchResult {
    const { nsdf } = this;
    const a = nsdf[lag - 1];
    const b = nsdf[lag];
    const c = nsdf[lag + 1];
    const denominator = a - 2 * b + c;
    let shift = 0;
    let height = b;
    if (denominator < 0) {
      shift = (0.5 * (a - c)) / denominator;
      height = b - 0.25 * (a - c) * shift;
    }
    return {
      frequency: this.sampleRate / (lag + shift),
      clarity: Math.min(1, height),
    };
  }
}
