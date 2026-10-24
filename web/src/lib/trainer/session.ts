/*
 * One sitting of a trainer game: rounds against the clock. The clock is passed in so the timing is
 * tested without waiting. A session with `limitSeconds` of 0 has no time limit.
 */

import { summarize, type RoundResult, type SessionSummary } from "./ear";
import type { TrainerKind } from "./store";

export const TIME_LIMITS = [0, 30, 60, 120] as const;

export interface FinishedSession {
  kind: TrainerKind;
  startedAt: number;
  /** Seconds from the first question to the end. */
  seconds: number;
  results: RoundResult[];
  summary: SessionSummary;
}

export class TrainerSession {
  private results: RoundResult[] = [];
  private roundStart: number;
  private ended = false;
  readonly startedAt: number;

  constructor(
    readonly kind: TrainerKind,
    readonly limitSeconds: number,
    private readonly now: () => number = Date.now,
  ) {
    this.startedAt = now();
    this.roundStart = this.startedAt;
  }

  /** A new question was put to the player: its clock starts now. */
  startRound(): void {
    this.roundStart = this.now();
  }

  /** Seconds left, or null for an untimed session. Never below 0. */
  remaining(): number | null {
    if (!this.limitSeconds) return null;
    return Math.max(0, this.limitSeconds - (this.now() - this.startedAt) / 1000);
  }

  get over(): boolean {
    return this.ended || this.remaining() === 0;
  }

  /** Record an answer. Returns the response time in milliseconds. Ignored once the session is over. */
  answer(correct: boolean): number {
    const ms = Math.max(0, this.now() - this.roundStart);
    if (!this.over) this.results.push({ correct, ms });
    return ms;
  }

  get rounds(): number {
    return this.results.length;
  }

  get correct(): number {
    return this.results.filter((result) => result.correct).length;
  }

  finish(): FinishedSession {
    this.ended = true;
    return {
      kind: this.kind,
      startedAt: this.startedAt,
      seconds: Math.round((this.now() - this.startedAt) / 1000),
      results: [...this.results],
      summary: summarize(this.results),
    };
  }
}
