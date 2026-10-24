import type { ChromaEvent } from "./chroma";
import type { PitchEvent } from "./engine";
import type { ListenSession, ListenOptions } from "./input";
import { DEFAULT_WAIT_OPTIONS, WaitMatcher, type WaitOptions, type WaitStep } from "./wait";

export interface WaitRunOptions {
  steps: WaitStep[];
  /** Opens the microphone; `startListening` in the app, a fake in tests. */
  listen: (options: ListenOptions) => Promise<ListenSession>;
  match?: Partial<WaitOptions>;
  /** Seconds on one beat before `onHint` fires. 0 turns the hint off. */
  hintSeconds: number;
  /** The player stopped on a step: show it and wait for the note. */
  onWait: (step: WaitStep, index: number) => void;
  /** The note was played: let the player go on. */
  onHit: (step: WaitStep, index: number) => void;
  /** The beat has been waiting for `hintSeconds`. */
  onHint: (step: WaitStep, index: number) => void;
}

/**
 * Runs wait mode: owns the microphone session and the matcher, and tells the player when to stop
 * on a beat (`onWait`) and when to carry on (`onHit`). The player calls `reach` as its cursor
 * arrives at a beat of the track.
 */
export class WaitRun {
  private session: ListenSession | null = null;
  private readonly matcher: WaitMatcher;
  private current = -1;
  /** Index of the last step handled; steps up to here do not stop the cursor again. */
  private passed = -1;
  private hintTimer: ReturnType<typeof setTimeout> | undefined;
  hits = 0;

  constructor(private readonly options: WaitRunOptions) {
    this.matcher = new WaitMatcher({ ...DEFAULT_WAIT_OPTIONS, ...options.match });
  }

  get total(): number {
    return this.options.steps.length;
  }

  /** The step the cursor is waiting on, or -1. */
  get waitingOn(): number {
    return this.current;
  }

  async start(): Promise<void> {
    this.session = await this.options.listen({
      onPitch: (event) => this.hear(event),
      onChroma: (event) => this.hearChroma(event),
    });
  }

  /** The cursor arrived at step `index`. Returns true when it should stop and wait. */
  reach(index: number): boolean {
    if (!this.session || index <= this.passed || index === this.current) return false;
    const step = this.options.steps[index];
    if (!step) return false;
    this.current = index;
    this.matcher.wait(step);
    this.session.setExpectedMidi(step.kind === "note" ? (step.midis[0] ?? null) : null);
    this.session.setChroma(step.kind === "chord");
    this.clearHint();
    if (this.options.hintSeconds > 0) {
      this.hintTimer = setTimeout(
        () => this.options.onHint(step, index),
        this.options.hintSeconds * 1000,
      );
    }
    this.options.onWait(step, index);
    return true;
  }

  /** The player jumped to `tick`: steps from there on stop the cursor again. */
  seek(tick: number): void {
    this.release();
    const first = this.options.steps.findIndex((step) => step.tick >= tick);
    this.passed = (first < 0 ? this.options.steps.length : first) - 1;
  }

  /** Let the player past the current step without a note. */
  skip(): void {
    if (this.current < 0) return;
    this.finish(false);
  }

  stop(): void {
    this.release();
    const session = this.session;
    this.session = null;
    void session?.stop().catch(() => undefined);
  }

  private hear(event: PitchEvent): void {
    if (this.matcher.push(event)) this.finish(true);
  }

  private hearChroma(event: ChromaEvent): void {
    if (this.matcher.pushChroma(event)) this.finish(true);
  }

  private finish(hit: boolean): void {
    const index = this.current;
    const step = this.options.steps[index];
    this.release();
    this.passed = index;
    if (hit) this.hits += 1;
    this.options.onHit(step, index);
  }

  private release(): void {
    this.clearHint();
    this.current = -1;
    this.matcher.wait(null);
    this.session?.setExpectedMidi(null);
    this.session?.setChroma(false);
  }

  private clearHint(): void {
    clearTimeout(this.hintTimer);
    this.hintTimer = undefined;
  }
}
