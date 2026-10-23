import { Clicker } from "./clicker";

export const MIN_BPM = 30;
export const MAX_BPM = 300;
export const DEFAULT_BPM = 120;

export interface TimeSignatureOption {
  id: string;
  beats: number;
  value: number;
}

export const TIME_SIGNATURES: TimeSignatureOption[] = [
  { id: "2/4", beats: 2, value: 4 },
  { id: "3/4", beats: 3, value: 4 },
  { id: "4/4", beats: 4, value: 4 },
  { id: "5/4", beats: 5, value: 4 },
  { id: "6/4", beats: 6, value: 4 },
  { id: "6/8", beats: 6, value: 8 },
  { id: "7/8", beats: 7, value: 8 },
  { id: "9/8", beats: 9, value: 8 },
  { id: "12/8", beats: 12, value: 8 },
];

export const SUBDIVISIONS = [
  { id: 1, labelKey: "tools.subdivisionNone" },
  { id: 2, labelKey: "tools.subdivisionEighth" },
  { id: 3, labelKey: "tools.subdivisionTriplet" },
  { id: 4, labelKey: "tools.subdivisionSixteenth" },
];

export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return DEFAULT_BPM;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
}

export function tempoMarking(bpm: number): string {
  if (bpm < 60) return "Largo";
  if (bpm < 76) return "Adagio";
  if (bpm < 108) return "Andante";
  if (bpm < 120) return "Moderato";
  if (bpm < 168) return "Allegro";
  if (bpm < 200) return "Presto";
  return "Prestissimo";
}

export class TapTempoTracker {
  private taps: number[] = [];

  constructor(
    private readonly timeoutMs = 2500,
    private readonly maxTaps = 8,
  ) {}

  tap(now = performance.now()): number | null {
    if (this.taps.length > 0 && now - this.taps[this.taps.length - 1] > this.timeoutMs) {
      this.taps = [];
    }
    this.taps.push(now);
    if (this.taps.length > this.maxTaps) {
      this.taps.shift();
    }
    if (this.taps.length < 2) return null;
    const intervals: number[] = [];
    for (let i = 1; i < this.taps.length; i++) {
      intervals.push(this.taps[i] - this.taps[i - 1]);
    }
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    if (avg <= 0) return null;
    return clampBpm(60000 / avg);
  }

  reset(): void {
    this.taps = [];
  }
}

export interface MetronomeConfig {
  bpm: number;
  signature: string;
  accentBeat1: boolean;
  subdivisions: number;
  volume: number;
}

const METRONOME_STORAGE_KEY = "fretbook.metronome.settings";

export function loadMetronomeConfig(): MetronomeConfig {
  try {
    const raw =
      typeof localStorage !== "undefined" ? localStorage.getItem(METRONOME_STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        bpm: clampBpm(parsed.bpm),
        signature: TIME_SIGNATURES.some((s) => s.id === parsed.signature)
          ? parsed.signature
          : "4/4",
        accentBeat1: parsed.accentBeat1 !== false,
        subdivisions: [1, 2, 3, 4].includes(parsed.subdivisions) ? parsed.subdivisions : 1,
        volume: typeof parsed.volume === "number" ? Math.min(1, Math.max(0, parsed.volume)) : 0.7,
      };
    }
  } catch {
    // ignore
  }
  return {
    bpm: DEFAULT_BPM,
    signature: "4/4",
    accentBeat1: true,
    subdivisions: 1,
    volume: 0.7,
  };
}

export function saveMetronomeConfig(config: MetronomeConfig): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(METRONOME_STORAGE_KEY, JSON.stringify(config));
    }
  } catch {
    // ignore
  }
}

export class MetronomeEngine {
  private timer: ReturnType<typeof setInterval> | null = null;
  private visualTimeouts: ReturnType<typeof setTimeout>[] = [];
  private nextClickTime = 0;
  private currentBeat = 0;
  private currentSub = 0;
  private running = false;
  private config: MetronomeConfig;

  constructor(
    private readonly clicker: Clicker,
    config?: Partial<MetronomeConfig>,
    private readonly onTick?: (beat: number, subdivision: number) => void,
  ) {
    this.config = {
      bpm: DEFAULT_BPM,
      signature: "4/4",
      accentBeat1: true,
      subdivisions: 1,
      volume: 0.7,
      ...config,
    };
  }

  get isRunning(): boolean {
    return this.running;
  }

  updateConfig(config: Partial<MetronomeConfig>): void {
    this.config = { ...this.config, ...config };
  }

  start(): void {
    if (this.running) return;
    this.clicker.unlock();
    this.running = true;
    this.currentBeat = 0;
    this.currentSub = 0;
    this.nextClickTime = this.clicker.currentTime + 0.05;

    this.timer = setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const id of this.visualTimeouts) {
      clearTimeout(id);
    }
    this.visualTimeouts = [];
  }

  private schedule(): void {
    if (!this.running) return;
    const now = this.clicker.currentTime;
    const lookahead = 0.1;

    const sig = TIME_SIGNATURES.find((s) => s.id === this.config.signature) ?? TIME_SIGNATURES[2];
    const beatsCount = sig.beats;
    const subCount = Math.max(1, this.config.subdivisions);
    const secondsPerBeat = 60 / Math.max(MIN_BPM, this.config.bpm);
    const secondsPerSub = secondsPerBeat / subCount;

    while (this.nextClickTime < now + lookahead) {
      const delay = Math.max(0, this.nextClickTime - now);
      const beat = this.currentBeat;
      const sub = this.currentSub;
      const isMainBeat = sub === 0;
      const isAccent = isMainBeat && beat === 0 && this.config.accentBeat1;
      const vol = isMainBeat ? this.config.volume : this.config.volume * 0.45;

      this.clicker.click(delay, isAccent, vol);

      if (this.onTick) {
        const timeout = setTimeout(() => {
          if (this.running) {
            this.onTick?.(beat, sub);
          }
        }, delay * 1000);
        this.visualTimeouts.push(timeout);
        if (this.visualTimeouts.length > 50) {
          this.visualTimeouts.shift();
        }
      }

      this.nextClickTime += secondsPerSub;
      this.currentSub++;
      if (this.currentSub >= subCount) {
        this.currentSub = 0;
        this.currentBeat = (this.currentBeat + 1) % beatsCount;
      }
    }
  }

  close(): void {
    this.stop();
  }
}
