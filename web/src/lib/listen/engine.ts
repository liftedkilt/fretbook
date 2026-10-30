import { ChromaAnalyzer, type ChromaEvent } from "./chroma";
import { MpmDetector, windowSizeFor } from "./mpm";
import { DEFAULT_A4, describePitch, midiToFrequency } from "./notes";
import { OnsetDetector } from "./onset";

/** One analysis result, stamped against the AudioContext clock (seconds). */
export interface PitchEvent {
  /** Time of the newest sample in the analysed window. */
  time: number;
  /** Fundamental in Hz, or null when nothing pitched is playing. */
  frequency: number | null;
  clarity: number;
  midi: number | null;
  cents: number | null;
  /** True when a new note was attacked (or the pitch moved to a new note) since the last event. */
  onset: boolean;
  /** Estimated time of that attack, when `onset` is true. */
  onsetTime: number | null;
}

export interface EngineOptions {
  sampleRate: number;
  a4?: number;
  /**
   * Lowest note to track; sets the long analysis window (default 25 Hz, so drop A at 27.5 Hz fits
   * with margin; about 85 ms at 48 kHz).
   */
  minFrequency?: number;
  maxFrequency?: number;
  /** Seconds between pitch readings. */
  pitchInterval?: number;
  /** Windows quieter than this RMS (full scale = 1) are treated as silence. */
  silenceRms?: number;
  /** Readings below this clarity report no pitch. */
  minClarity?: number;
  /** Corner of the one-pole high-pass in front of pitch detection, in Hz (default 25). 0 turns it off. */
  highPassHz?: number;
  /** A sounding note stays open down to `silenceRms` times this (default 0.5), so decay does not flicker. */
  keepRatio?: number;
}

/** Pitches below this (about D2) are read from the long window; guitar pitches from the short one. */
const SHORT_WINDOW_MIN_FREQUENCY = 75;

/** Streaming monophonic pitch and onset detector. Feed it audio blocks; it returns events. */
export class PitchEngine {
  readonly sampleRate: number;
  readonly windowSize: number;
  private readonly a4: number;
  private readonly mpm: MpmDetector;
  /** Reads guitar-range pitches from the newest ~43 ms, so the attack and the last note smear less. */
  private readonly shortMpm: MpmDetector;
  private readonly shortWindowSize: number;
  private readonly onsets: OnsetDetector;
  private readonly pitchHop: number;
  private readonly silenceRms: number;
  private readonly minClarity: number;
  private readonly keepRms: number;
  private readonly hpCoeff: number;
  private hpIn = 0;
  private hpOut = 0;
  private gateOpen = false;
  private readonly ring: Float32Array;
  /** The ring again, high-passed: pitch reads this; onsets and chroma read the raw ring. */
  private readonly pitchRing: Float32Array;
  private readonly window: Float32Array;
  private readonly frame: Float32Array;
  private written = 0;
  private expectedFrequency: number | null = null;
  private strictOctave = false;
  private pendingOnset: number | null = null;
  private heldMidi: number | null = null;
  private candidateMidi: number | null = null;
  private candidateRuns = 0;
  private silentHops = 0;
  private lastOnsetFrame = -Infinity;
  private blockPeak = 0;
  private blockSumSquares = 0;
  private blockCount = 0;
  private readonly chroma: ChromaAnalyzer;
  private readonly chromaHop: number;
  private readonly chromaWindow: Float32Array;
  private chromaOn = false;
  private chromaPendingOnset: number | null = null;
  private chromaEvents: ChromaEvent[] = [];

  constructor(options: EngineOptions) {
    this.sampleRate = options.sampleRate;
    this.a4 = options.a4 ?? DEFAULT_A4;
    // Two windows (short for guitar pitches, long for low ones): the tradeoff is in
    // docs/design/tuner-and-wait-pitch.md.
    const minFrequency = options.minFrequency ?? 25;
    const maxFrequency = options.maxFrequency ?? 2000;
    this.windowSize = windowSizeFor(this.sampleRate, minFrequency);
    this.mpm = new MpmDetector({
      sampleRate: this.sampleRate,
      windowSize: this.windowSize,
      minFrequency,
      maxFrequency,
    });
    this.shortWindowSize = Math.min(
      this.windowSize,
      windowSizeFor(this.sampleRate, SHORT_WINDOW_MIN_FREQUENCY * 0.8),
    );
    this.shortMpm = new MpmDetector({
      sampleRate: this.sampleRate,
      windowSize: this.shortWindowSize,
      minFrequency: SHORT_WINDOW_MIN_FREQUENCY * 0.8,
      maxFrequency,
    });
    this.onsets = new OnsetDetector({ sampleRate: this.sampleRate });
    const hop = this.onsets.hopSize;
    this.pitchHop = Math.max(
      hop,
      Math.round(((options.pitchInterval ?? 0.02) * this.sampleRate) / hop) * hop,
    );
    this.silenceRms = options.silenceRms ?? 0.003;
    this.keepRms = this.silenceRms * (options.keepRatio ?? 0.5);
    const highPassHz = options.highPassHz ?? 25;
    this.hpCoeff = highPassHz > 0 ? 1 / (1 + (2 * Math.PI * highPassHz) / this.sampleRate) : 1;
    this.minClarity = options.minClarity ?? 0.7;
    this.chroma = new ChromaAnalyzer({ sampleRate: this.sampleRate });
    this.chromaHop = Math.max(hop, Math.round((0.05 * this.sampleRate) / hop) * hop);
    this.chromaWindow = new Float32Array(this.chroma.size);
    this.ring = new Float32Array(
      Math.max(this.windowSize, this.onsets.frameSize, this.chroma.size),
    );
    this.pitchRing = new Float32Array(this.ring.length);
    this.window = new Float32Array(this.windowSize);
    this.frame = new Float32Array(this.onsets.frameSize);
  }

  /** Tell the detector which note is expected next so octave errors resolve towards it. */
  setExpectedMidi(midi: number | null, strictOctave = false): void {
    this.strictOctave = strictOctave;
    this.expectedFrequency = midi === null ? null : midiToFrequency(midi, this.a4);
  }

  /**
   * Turn chroma readings on or off. They cost an FFT every 50 ms, so only wait mode on a chord
   * asks for them. Read them with `takeChroma`.
   */
  setChroma(on: boolean): void {
    this.chromaOn = on;
    if (!on) {
      this.chromaPendingOnset = null;
      this.chromaEvents = [];
    }
  }

  /** The chroma readings made since the last call. */
  takeChroma(): ChromaEvent[] {
    const events = this.chromaEvents;
    this.chromaEvents = [];
    return events;
  }

  /** RMS and peak (0..1) of the audio since the last call; resets the meter. */
  takeLevel(): { rms: number; peak: number } {
    const rms = this.blockCount ? Math.sqrt(this.blockSumSquares / this.blockCount) : 0;
    const level = { rms, peak: this.blockPeak };
    this.blockPeak = 0;
    this.blockSumSquares = 0;
    this.blockCount = 0;
    return level;
  }

  /** `startTime` is the clock time of `block[0]`. */
  process(block: Float32Array, startTime: number): PitchEvent[] {
    const events: PitchEvent[] = [];
    const hop = this.onsets.hopSize;
    const size = this.ring.length;
    for (let i = 0; i < block.length; i++) {
      const sample = block[i];
      this.ring[this.written % size] = sample;
      // One-pole high-pass: y[n] = a * (y[n-1] + x[n] - x[n-1]); skipped (a = 1) when turned off.
      this.hpOut = this.hpCoeff * (this.hpOut + sample - this.hpIn);
      this.hpIn = sample;
      this.pitchRing[this.written % size] = this.hpCoeff === 1 ? sample : this.hpOut;
      this.written++;
      const magnitude = Math.abs(sample);
      if (magnitude > this.blockPeak) this.blockPeak = magnitude;
      this.blockSumSquares += sample * sample;
      this.blockCount++;
      if (this.written % hop !== 0 || this.written < this.onsets.frameSize) continue;
      const now = startTime + (i + 1) / this.sampleRate;
      this.copyTail(this.frame);
      const onset = this.onsets.push(this.frame);
      if (onset && this.pendingOnset === null) {
        // The rise happens in the newest part of the frame before the confirming hop.
        this.pendingOnset =
          now - (onset.hopsAgo * hop + this.onsets.frameSize * 0.25) / this.sampleRate;
        this.lastOnsetFrame = this.written;
        if (this.chromaOn && this.chromaPendingOnset === null)
          this.chromaPendingOnset = this.pendingOnset;
      }
      if (
        this.chromaOn &&
        this.written % this.chromaHop === 0 &&
        this.written >= this.chroma.size
      ) {
        this.chromaEvents.push(this.analyseChroma(now));
      }
      if (this.written % this.pitchHop === 0 && this.written >= this.windowSize) {
        events.push(this.analyse(now));
      }
    }
    return events;
  }

  private copyTail(into: Float32Array, from: Float32Array = this.ring): void {
    const size = from.length;
    const start = this.written - into.length;
    for (let j = 0; j < into.length; j++) into[j] = from[(start + j) % size];
  }

  private analyseChroma(now: number): ChromaEvent {
    this.copyTail(this.chromaWindow);
    let energy = 0;
    for (let i = 0; i < this.chromaWindow.length; i++) energy += this.chromaWindow[i] ** 2;
    const loud = Math.sqrt(energy / this.chromaWindow.length) >= this.silenceRms;
    const onsetTime = this.chromaPendingOnset;
    this.chromaPendingOnset = null;
    return {
      time: now,
      bins: loud ? this.chroma.analyse(this.chromaWindow) : new Array<number>(12).fill(0),
      span: this.chroma.size / this.sampleRate,
      onset: onsetTime !== null,
      onsetTime,
    };
  }

  private analyse(now: number): PitchEvent {
    this.copyTail(this.window, this.pitchRing);
    let energy = 0;
    for (let i = 0; i < this.window.length; i++) energy += this.window[i] ** 2;
    const rms = Math.sqrt(energy / this.window.length);
    let frequency: number | null = null;
    let clarity = 0;
    // Hysteresis: opening takes the full threshold, a note already sounding only the lower one.
    this.gateOpen = rms >= this.silenceRms || (this.gateOpen && rms >= this.keepRms);
    if (this.gateOpen) {
      const detect = {
        expectedFrequency: this.expectedFrequency,
        strictOctave: this.strictOctave,
      };
      // Like YIN's minFreq: try the short window first, and only a low (or unreadable) candidate
      // pays for the long one.
      let result = null;
      if (
        this.shortWindowSize < this.windowSize &&
        (this.expectedFrequency === null || this.expectedFrequency >= SHORT_WINDOW_MIN_FREQUENCY)
      ) {
        const short = this.shortMpm.detect(
          this.window.subarray(this.windowSize - this.shortWindowSize),
          detect,
        );
        if (
          short &&
          short.clarity >= this.minClarity &&
          short.frequency >= SHORT_WINDOW_MIN_FREQUENCY
        )
          result = short;
      }
      result ??= this.mpm.detect(this.window, detect);
      if (result) {
        clarity = result.clarity;
        if (clarity >= this.minClarity) frequency = result.frequency;
      }
    }
    const described = frequency === null ? null : describePitch(frequency, this.a4);

    // Legato: a hammer-on or pull-off has no attack transient, so confirm a new, steady pitch.
    let onsetTime = this.pendingOnset;
    if (described && clarity >= 0.9) {
      this.silentHops = 0;
      if (this.heldMidi === null) {
        this.heldMidi = described.midi;
      } else if (described.midi !== this.heldMidi && (described.midi - this.heldMidi) % 12 !== 0) {
        // (A jump by whole octaves is almost always the detector flipping harmonics, not a new note.)
        if (this.candidateMidi === described.midi) this.candidateRuns++;
        else {
          this.candidateMidi = described.midi;
          this.candidateRuns = 1;
        }
        if (this.candidateRuns >= 3) {
          if (onsetTime === null && this.written - this.lastOnsetFrame > 0.1 * this.sampleRate) {
            onsetTime = now - this.candidateRuns * (this.pitchHop / this.sampleRate);
            this.lastOnsetFrame = this.written;
          }
          this.heldMidi = described.midi;
          this.candidateMidi = null;
        }
      } else {
        this.candidateMidi = null;
      }
    } else if (!described) {
      this.silentHops++;
      if (this.silentHops * this.pitchHop > 0.15 * this.sampleRate) {
        this.heldMidi = null;
        this.candidateMidi = null;
      }
    }
    if (this.pendingOnset !== null) {
      // A flux onset restarts the held note, so the following reading is not a "pitch change".
      this.heldMidi = described ? described.midi : null;
      this.candidateMidi = null;
    }
    this.pendingOnset = null;

    return {
      time: now,
      frequency,
      clarity,
      midi: described?.midi ?? null,
      cents: described?.cents ?? null,
      onset: onsetTime !== null,
      onsetTime,
    };
  }
}
