import { FFT } from "./fft";

/** The soft rule wants flux this many times the recent median, and a hop at least 4% louder. */
const SOFT_RATIO = 4;
const SOFT_RISE = 1.04;
const QUIET_RISE = 3;
/** The soft rule also waits this many hops after any onset, which hides an attack's own ripple. */
const SOFT_GAP_FRAMES = 14;

export interface OnsetOptions {
  sampleRate: number;
  /** Analysis frame length (power of two) and hop, in samples. */
  frameSize?: number;
  hopSize?: number;
  /** Peak must exceed the local mean flux by this much (relative to the running scale). */
  sensitivity?: number;
  /** Refractory period after an onset, in seconds. */
  minGap?: number;
  /** Frames quieter than this RMS never start a note. */
  silenceRms?: number;
  /** Minimum flux (per-bin, scaled) for an onset; raise it in noisy rooms. */
  fluxFloor?: number;
}

/**
 * Spectral-flux onset detector. Each hop it takes the half-wave-rectified increase of the
 * log-compressed magnitude spectrum, then picks a peak that clears an adaptive threshold.
 * Detection is delayed by one hop so a frame can be confirmed as a local maximum.
 */
export class OnsetDetector {
  readonly hopSize: number;
  readonly frameSize: number;
  private readonly fft: FFT;
  private readonly window: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private previous: Float64Array;
  private readonly sensitivity: number;
  private readonly minGapFrames: number;
  private readonly silenceRms: number;
  private readonly floor: number;
  private readonly softFloor: number;
  private readonly bins: number;
  private readonly firstBin: number;
  private readonly history: number[] = [];
  private flux1 = 0;
  private flux2 = 0;
  private readonly rmsHistory: number[] = [];
  private sinceOnset = Infinity;
  private primed = false;

  constructor(options: OnsetOptions) {
    // The frame has to span about two periods of the lowest bass, whatever the sample rate.
    let frameSize = 256;
    while (frameSize < 0.04 * options.sampleRate) frameSize <<= 1;
    this.frameSize = options.frameSize ?? frameSize;
    this.hopSize = options.hopSize ?? Math.round(0.01 * options.sampleRate);
    this.sensitivity = options.sensitivity ?? 1.6;
    this.silenceRms = options.silenceRms ?? 0.003;
    this.floor = options.fluxFloor ?? 1;
    this.softFloor = this.floor * 0.3;
    this.minGapFrames = Math.max(
      1,
      Math.round(((options.minGap ?? 0.06) * options.sampleRate) / this.hopSize),
    );
    this.fft = new FFT(this.frameSize);
    this.window = new Float64Array(this.frameSize);
    for (let i = 0; i < this.frameSize; i++) {
      this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.frameSize);
    }
    this.re = new Float64Array(this.frameSize);
    this.im = new Float64Array(this.frameSize);
    this.bins = this.frameSize / 2;
    this.firstBin = 1;
    this.previous = new Float64Array(this.bins);
  }

  /**
   * Feed the latest `frameSize` samples (a new frame every `hopSize`). Returns the number of
   * hops back from this frame at which an onset was confirmed, or null.
   */
  push(frame: Float32Array | Float64Array): { hopsAgo: number; strength: number } | null {
    const { re, im, window, bins } = this;
    let energy = 0;
    for (let i = 0; i < this.frameSize; i++) {
      re[i] = frame[i] * window[i];
      im[i] = 0;
      energy += frame[i] * frame[i];
    }
    const rms = Math.sqrt(energy / this.frameSize);
    // Energy of the newest hop only: an attack sits at the end of the frame, where the window
    // and the frame-wide RMS both hide it.
    let hopEnergy = 0;
    for (let i = this.frameSize - this.hopSize; i < this.frameSize; i++)
      hopEnergy += frame[i] * frame[i];
    this.fft.transform(re, im);
    this.rmsHistory.push(Math.sqrt(hopEnergy / this.hopSize));
    if (this.rmsHistory.length > 4) this.rmsHistory.shift();
    let flux = 0;
    for (let k = this.firstBin; k < bins; k++) {
      const magnitude = Math.log1p((200 * Math.hypot(re[k], im[k])) / this.frameSize);
      const rise = magnitude - this.previous[k];
      if (rise > 0) flux += rise;
      this.previous[k] = magnitude;
    }
    flux = (flux * 100) / (bins - this.firstBin);
    this.sinceOnset++;
    if (!this.primed) {
      // The first frame only seeds the spectrum; it would otherwise look like a huge rise.
      this.primed = true;
      this.flux2 = this.flux1 = 0;
      return null;
    }

    // flux1 is the previous frame: it is a peak when it beats both neighbours.
    let result: { hopsAgo: number; strength: number } | null = null;
    const mean =
      this.history.length > 0 ? this.history.reduce((a, b) => a + b, 0) / this.history.length : 0;
    const threshold = this.sensitivity * mean + this.floor;
    const peak = this.flux1 >= this.flux2 && this.flux1 > flux;
    const settled = rms > this.silenceRms * 0.5 && this.sinceOnset > this.minGapFrames;
    // The regular rule is untouched, so a clean attack keeps its timestamp. The soft rule only
    // adds onsets the regular one rejects: a quiet pluck whose flux is under the absolute floor,
    // or a repluck on a ringing string that adds less than the 12% the regular rule wants.
    // Both still need to stand well clear of the recent flux.
    if (
      peak &&
      settled &&
      ((this.flux1 > threshold && this.louderThanBefore()) ||
        (this.flux1 > this.softFloor &&
          this.sinceOnset > SOFT_GAP_FRAMES &&
          ((this.flux1 > SOFT_RATIO * this.medianFlux() + this.softFloor &&
            this.louderThanBefore(SOFT_RISE)) ||
            // A pluck out of near silence nearly doubles the hop energy, and the damping of
            // the note before it can inflate the median.
            (this.flux1 > SOFT_RATIO * this.lowerQuartileFlux() + this.softFloor &&
              this.louderThanBefore(QUIET_RISE)))))
    ) {
      result = { hopsAgo: 1, strength: this.flux1 };
      this.sinceOnset = 1;
    }
    this.history.push(flux);
    if (this.history.length > 24) this.history.shift();
    this.flux2 = this.flux1;
    this.flux1 = flux;
    return result;
  }

  private medianFlux(): number {
    if (this.history.length === 0) return 0;
    const sorted = [...this.history].sort((a, b) => a - b);
    return sorted[sorted.length >> 1];
  }

  private lowerQuartileFlux(): number {
    if (this.history.length === 0) return 0;
    const sorted = [...this.history].sort((a, b) => a - b);
    return sorted[sorted.length >> 2];
  }

  /** A real attack adds energy; a string being damped, or a click on a fade, does not. */
  private louderThanBefore(rise = 1.12): boolean {
    const history = this.rmsHistory;
    // history[last] is this frame, [last - 1] the flux peak, [0] three hops earlier.
    if (history.length < 4) return true;
    return Math.max(history[2], history[3]) > history[0] * rise + 1e-5;
  }
}
