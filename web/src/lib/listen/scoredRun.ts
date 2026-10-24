import type { PitchEvent } from "./engine";
import type { ListenOptions, ListenSession } from "./input";
import {
  DEFAULT_SCORE_OPTIONS,
  Scorer,
  type NoteGrade,
  type ScoreOptions,
  type ScoredStep,
  type ScoreSummary,
} from "./scored";

export interface ScoredRunOptions {
  steps: ScoredStep[];
  /** Played bars in the song, for the per-bar breakdown. */
  barCount: number;
  /** Opens the microphone; `startListening` in the app, a fake in tests. */
  listen: (options: ListenOptions) => Promise<ListenSession>;
  match?: Partial<ScoreOptions>;
  /** The playback clock in seconds (the recording's clock, or the synth's). */
  songTime: () => number;
  /** Playback speed, 1 for the written tempo. Song seconds pass this fast per real second. */
  rate: () => number;
  /** Round-trip latency from calibration, seconds. */
  latencySeconds: number;
  /** Steps whose grade just changed. */
  onGrades: (
    changed: number[],
    grades: readonly (NoteGrade | null)[],
    summary: ScoreSummary,
  ) => void;
  /** An attack was heard inside the pass: totals so far, for the bleed check. */
  onAttacks?: (attacks: number, restAttacks: number) => void;
  /** The pass reached its end: every note has a grade. */
  onComplete: (summary: ScoreSummary) => void;
}

/**
 * Runs a scored pass: owns the microphone session and the scorer, and maps the detector's clock
 * onto the song's clock. The player keeps playing; this only listens and grades.
 */
export class ScoredRun {
  private session: ListenSession | null = null;
  private scorer: Scorer | null = null;
  private range = { from: 0, to: 0 };
  private timer: ReturnType<typeof setInterval> | undefined;
  private done = false;
  private readonly match: ScoreOptions;

  constructor(private readonly options: ScoredRunOptions) {
    this.match = { ...DEFAULT_SCORE_OPTIONS, ...options.match };
  }

  async start(range: { from: number; to: number }): Promise<void> {
    this.session = await this.options.listen({ onPitch: (event) => this.hear(event) });
    this.begin(range);
    this.timer = setInterval(() => this.tick(), 100);
  }

  /** Start a fresh pass over `range`, dropping the grades so far. */
  begin(range: { from: number; to: number }): void {
    this.range = range;
    this.done = false;
    this.scorer = new Scorer(this.options.steps, this.options.barCount, range, this.match);
    this.options.onGrades([], this.scorer.stepGrades, this.scorer.summary());
  }

  get summary(): ScoreSummary | null {
    return this.scorer?.summary() ?? null;
  }

  /** True when a pass is open (not yet complete). */
  get running(): boolean {
    return this.scorer !== null && !this.done;
  }

  get attacks(): number {
    return this.scorer?.attacks ?? 0;
  }

  get restAttacks(): number {
    return this.scorer?.restAttacks ?? 0;
  }

  /** End the pass now: notes still open count as missed. */
  finish(): ScoreSummary | null {
    const scorer = this.scorer;
    if (!scorer || this.done) return scorer?.summary() ?? null;
    this.done = true;
    const changed = scorer.finish();
    const summary = scorer.summary();
    this.options.onGrades(changed, scorer.stepGrades, summary);
    this.options.onComplete(summary);
    return summary;
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.scorer = null;
    this.done = true;
    const session = this.session;
    this.session = null;
    void session?.stop().catch(() => undefined);
  }

  /** Microphone seconds to song seconds: the speed and the calibrated latency both apply. */
  private toSong(time: number): number {
    const session = this.session;
    const rate = this.options.rate();
    const ago = session ? session.currentTime - time : 0;
    return this.options.songTime() - (ago + this.options.latencySeconds) * rate;
  }

  private hear(event: PitchEvent): void {
    const scorer = this.scorer;
    if (!scorer || this.done) return;
    const before = scorer.attacks;
    const changed = scorer.push(event, (time) => this.toSong(time));
    if (scorer.attacks !== before) this.options.onAttacks?.(scorer.attacks, scorer.restAttacks);
    if (changed.length > 0) this.options.onGrades(changed, scorer.stepGrades, scorer.summary());
    this.checkEnd();
  }

  private tick(): void {
    const scorer = this.scorer;
    if (!scorer || this.done) return;
    const changed = scorer.advance(this.options.songTime());
    if (changed.length > 0) this.options.onGrades(changed, scorer.stepGrades, scorer.summary());
    this.checkEnd();
  }

  private checkEnd(): void {
    const scorer = this.scorer;
    if (!scorer || this.done) return;
    if (scorer.complete && this.options.songTime() >= this.range.to) this.finish();
  }
}
