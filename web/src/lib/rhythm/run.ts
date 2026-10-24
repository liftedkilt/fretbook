import { barSeconds, cellCount, expectedHits, type RhythmPattern } from "./patterns";
import {
  applyLatency,
  matchHits,
  matchWindow,
  summarize,
  type MatchResult,
  type TimingSummary,
} from "./timing";

export type HitSource = "mic" | "keyboard" | "touch";

export interface RhythmRunOptions {
  pattern: RhythmPattern;
  bpm: number;
  /** Bars the player is scored on, after the count-in bar. */
  bars: number;
  /** Wall clock in ms (`performance.now`), the clock hits are reported on. */
  now: () => number;
  /** Plays a click `delay` seconds from now. */
  click: (delaySeconds: number, accent: boolean) => void;
  onFinish: (result: RhythmResult) => void;
  /** Round trip of the calibrated device pair in ms. */
  latencyMs?: number;
}

export interface RhythmResult {
  match: MatchResult;
  summary: TimingSummary;
  /** Expected hits in ms from the start of the scored bars. */
  expected: number[];
}

export interface RunPosition {
  /** True during the count-in bar. */
  countIn: boolean;
  /** Bar index within the scored bars, or the count-in beat when `countIn`. */
  bar: number;
  /** Cell within the bar; during the count-in, the beat times the grid. */
  cell: number;
}

const LOOKAHEAD_MS = 120;
const START_DELAY_MS = 300;
/** How long after the last expected hit the run waits for a late one. */
const TAIL_MS = 400;

/** One scored run: a count-in bar of clicks, then the scored bars with a click on every beat. */
export class RhythmRun {
  private timer: ReturnType<typeof setInterval> | undefined;
  private start = 0;
  private nextBeat = 0;
  private readonly played: number[] = [];
  private finished = false;
  private readonly beatMs: number;
  private readonly barMs: number;
  private readonly totalBeats: number;

  constructor(private readonly options: RhythmRunOptions) {
    this.beatMs = 60000 / options.bpm;
    this.barMs = barSeconds(options.pattern, options.bpm) * 1000;
    this.totalBeats = options.pattern.beats * (options.bars + 1);
  }

  get running(): boolean {
    return this.timer !== undefined && !this.finished;
  }

  /** Time in ms of the first scored bar on the `now` clock. */
  get scoredStart(): number {
    return this.start + this.barMs;
  }

  begin(): void {
    this.start = this.options.now() + START_DELAY_MS;
    this.timer = setInterval(() => this.tick(), 25);
    this.tick();
  }

  stop(): void {
    this.finished = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Records a hit made at `timeMs` on the `now` clock. `scale` is the share of latency to remove. */
  hit(timeMs: number, source: HitSource): void {
    if (this.finished || this.timer === undefined) return;
    const full = this.options.latencyMs ?? 0;
    // A microphone hit lags by the whole round trip; a tap or key press only by the output half.
    const latency = source === "mic" ? full : full / 2;
    this.played.push(applyLatency(timeMs, latency) - this.scoredStart);
  }

  position(): RunPosition | null {
    if (this.timer === undefined) return null;
    const elapsed = this.options.now() - this.start;
    if (elapsed < 0) return null;
    const { pattern } = this.options;
    if (elapsed < this.barMs) {
      return { countIn: true, bar: 0, cell: Math.floor(elapsed / this.beatMs) * pattern.grid };
    }
    const into = elapsed - this.barMs;
    const bar = Math.floor(into / this.barMs);
    const cell = Math.min(
      cellCount(pattern) - 1,
      Math.floor(((into % this.barMs) / this.beatMs) * pattern.grid),
    );
    return { countIn: false, bar, cell };
  }

  private tick(): void {
    if (this.finished) return;
    const now = this.options.now();
    while (
      this.nextBeat < this.totalBeats &&
      this.start + this.nextBeat * this.beatMs < now + LOOKAHEAD_MS
    ) {
      const at = this.start + this.nextBeat * this.beatMs;
      this.options.click(
        Math.max(0, (at - now) / 1000),
        this.nextBeat % this.options.pattern.beats === 0,
      );
      this.nextBeat++;
    }
    const end = this.scoredStart + this.options.bars * this.barMs;
    if (now >= end + TAIL_MS) this.finish();
  }

  private finish(): void {
    const expected = expectedHits(this.options.pattern, this.options.bpm, this.options.bars);
    this.stop();
    const match = matchHits(expected, this.played, matchWindow(expected));
    this.options.onFinish({ match, summary: summarize(match), expected });
  }
}
