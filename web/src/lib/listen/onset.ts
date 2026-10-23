import { FFT } from "./fft";

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
  private readonly bins: number;
  private readonly firstBin: number;
  private readonly history: number[] = [];
  private flux1 = 0;
  private flux2 = 0;
  private readonly rmsHistory: number[] = [];
  private sinceOnset = Infinity;
  private primed = false;

  constructor(options: OnsetOptions) {
    this.frameSize = options.frameSize ?? 1024;
    this.hopSize = options.hopSize ?? 256;
    this.sensitivity = options.sensitivity ?? 1.6;
    this.silenceRms = options.silenceRms ?? 0.003;
    this.minGapFrames = Math.max(1, Math.round(((options.minGap ?? 0.06) * options.sampleRate) / this.hopSize));
    this.fft = new FFT(this.frameSize);
    this.window = new Float64Array(this.frameSize);
    for (let i = 0; i < this.frameSize; i++) {
      this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.frameSize);
    }
    this.re = new Float64Array(this.frameSize);
    this.im = new Float64Array(this.frameSize);
    this.bins = this.frameSize / 2;
    // Skip bins under ~100 Hz: a low bass fundamental is shorter than the frame and just flickers.
    this.firstBin = Math.max(1, Math.ceil((100 * this.frameSize) / options.sampleRate));
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
    // A second difference stands in for a high-pass: the swing of a 31-41 Hz wave must not look
    // like an attack, but the pick noise and upper harmonics must.
    for (let i = this.frameSize - this.hopSize; i < this.frameSize; i++) {
      const d = frame[i] - 2 * frame[i - 1] + frame[i - 2];
      hopEnergy += d * d;
    }
    this.fft.transform(re, im);
    this.rmsHistory.push(hopEnergy / this.hopSize);
    if (this.rmsHistory.length > 4) this.rmsHistory.shift();
    let flux = 0;
    for (let k = this.firstBin; k < bins; k++) {
      const magnitude = Math.log1p(100 * Math.hypot(re[k], im[k]));
      const rise = magnitude - this.previous[k];
      if (rise > 0) flux += rise;
      this.previous[k] = magnitude;
    }
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
    const threshold = this.sensitivity * mean + 4;
    if (
      this.flux1 > threshold &&
      this.flux1 >= this.flux2 &&
      this.flux1 > flux &&
      rms > this.silenceRms * 0.5 &&
      this.louderThanBefore() &&
      this.sinceOnset > this.minGapFrames
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

  /** A real attack adds high-frequency energy; a string being damped or a bass wave swinging does not. */
  private louderThanBefore(): boolean {
    const history = this.rmsHistory;
    // history[last] is this frame, [last - 1] the flux peak, [0] three hops earlier.
    if (history.length < 4) return true;
    return Math.max(history[2], history[3]) > history[0] * 1.3 + 1e-12;
  }
}
