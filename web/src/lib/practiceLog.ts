import type { PracticeMode, PracticeSessionDraft } from "./types";

/*
 * The practice log, browser side: time the player spends playing is gathered into sessions, and
 * the dashboard's day, ring and heatmap arithmetic. Everything here is plain functions and one
 * small class with an injectable clock, so it is tested without a browser.
 */

/** Stretches shorter than this are noise (a tap on play, a seek), and are not logged. */
export const MIN_SESSION_SECONDS = 5;
/** A pause shorter than this keeps the same session going, so stopping to retune is not a new row. */
export const MERGE_PAUSE_MS = 60_000;
/** The server refuses more than six hours in one session; one hour is plenty to cut at. */
export const MAX_SESSION_SECONDS = 3600;

/** In wait mode, time stuck on one note with no input counts as practice for this long, then stops. */
export const WAIT_IDLE_MS = 120_000;
/** On a chord sheet, time without a key, tap or scroll counts for this long, then stops. */
export const SHEET_IDLE_MS = 300_000;

/**
 * Calls `onIdle` once, `ms` after the last `arm`. Arm it again on every sign of life, and
 * `disarm` it when the thing it watches ends. Timers are injectable so it is tested without a clock.
 */
export class IdleWatch {
  private handle: unknown = null;
  private readonly setTimer: NonNullable<TimerOptions["setTimer"]>;
  private readonly clearTimer: NonNullable<TimerOptions["clearTimer"]>;

  constructor(
    private readonly ms: number,
    private readonly onIdle: () => void,
    options: Pick<TimerOptions, "setTimer" | "clearTimer"> = {},
  ) {
    this.setTimer = options.setTimer ?? ((fn, delay) => setTimeout(fn, delay));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as number));
  }

  arm(): void {
    this.disarm();
    this.handle = this.setTimer(() => {
      this.handle = null;
      this.onIdle();
    }, this.ms);
  }

  disarm(): void {
    if (this.handle !== null) this.clearTimer(this.handle);
    this.handle = null;
  }
}

const pad = (value: number) => String(value).padStart(2, "0");

/** A date as the player's own calendar day, `YYYY-MM-DD`. */
export function localDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDay(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date);
}

export function addDays(day: string, count: number): string {
  const next = parseDay(day);
  next.setDate(next.getDate() + count);
  return localDay(next);
}

/** What a session is about. A change in any of these ends the session and starts another. */
export interface SessionContext {
  songId: string;
  trackId: string;
  loopName: string;
  loopStart: number | null;
  loopEnd: number | null;
  mode: PracticeMode;
  /** Playback speed as a ratio (1 is the written tempo). It does not split a session. */
  speed: number;
  score?: number | null;
}

function sameTopic(a: SessionContext, b: SessionContext): boolean {
  return (
    a.songId === b.songId &&
    a.trackId === b.trackId &&
    a.loopName === b.loopName &&
    a.loopStart === b.loopStart &&
    a.loopEnd === b.loopEnd &&
    a.mode === b.mode
  );
}

interface Open {
  context: SessionContext;
  startedAt: number;
  seconds: number;
  /** Seconds weighted by speed, to report the speed the time was spent at. */
  weighted: number;
  /** The player played the whole song through in this session (see `PracticeTimer.complete`). */
  completed?: boolean;
}

export interface TimerOptions {
  /** Called with each finished session. `keepalive` is true when the page is going away. */
  onSession: (session: PracticeSessionDraft, keepalive: boolean) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Turns "playing" and "not playing" into sessions. Call `update` whenever the activity or the
 * context changes; call `flush` when the player is closed or the page is hidden.
 */
export class PracticeTimer {
  private open: Open | null = null;
  private since: number | null = null;
  private context: SessionContext | null = null;
  private pauseTimer: unknown = null;
  private readonly onSession: TimerOptions["onSession"];
  private readonly now: () => number;
  private readonly setTimer: NonNullable<TimerOptions["setTimer"]>;
  private readonly clearTimer: NonNullable<TimerOptions["clearTimer"]>;

  constructor(options: TimerOptions) {
    this.onSession = options.onSession;
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as number));
  }

  /** The player is playing (or, in wait mode, playing along) when `active`. */
  update(active: boolean, context: SessionContext): void {
    const now = this.now();
    this.accrue(now);
    if (this.open && !sameTopic(this.open.context, context)) {
      this.finish(false);
      this.open = null;
    }
    this.context = context;
    if (this.open) this.open.context = context;
    // Still playing, on something new: the next session starts where the last one ended.
    else if (this.since !== null) this.open = { context, startedAt: now, seconds: 0, weighted: 0 };

    if (active && this.since === null) {
      this.since = now;
      this.cancelPauseTimer();
      this.open ??= { context, startedAt: now, seconds: 0, weighted: 0 };
    } else if (!active && this.since !== null) {
      this.since = null;
      if (this.open) this.armPauseTimer();
    }
  }

  /** Gather what has been played so far into the open session without ending it. */
  private accrue(now: number): void {
    if (this.since === null || !this.open || !this.context) return;
    const seconds = Math.max(0, (now - this.since) / 1000);
    this.open.seconds += seconds;
    this.open.weighted += seconds * this.context.speed;
    this.since = now;
    if (this.open.seconds >= MAX_SESSION_SECONDS) this.finish(false);
  }

  /** End the open session now, even if the player is still playing. */
  flush(keepalive = false): void {
    this.accrue(this.now());
    this.finish(keepalive);
  }

  /**
   * A wait-mode run was played through: end the open session now, flagged as completed. The flag belongs to this
   * session only, not to the one that carries on after it.
   */
  complete(): void {
    this.accrue(this.now());
    if (this.open) this.open.completed = true;
    this.finish(false);
  }

  /** Stop the timer and drop its pending work. Call after `flush`. */
  dispose(): void {
    this.cancelPauseTimer();
    this.open = null;
    this.since = null;
  }

  private armPauseTimer(): void {
    this.cancelPauseTimer();
    this.pauseTimer = this.setTimer(() => {
      this.pauseTimer = null;
      this.finish(false);
    }, MERGE_PAUSE_MS);
  }

  private cancelPauseTimer(): void {
    if (this.pauseTimer !== null) this.clearTimer(this.pauseTimer);
    this.pauseTimer = null;
  }

  private finish(keepalive: boolean): void {
    this.cancelPauseTimer();
    const open = this.open;
    this.open = null;
    if (this.since !== null) this.since = this.now();
    if (!open) return;
    const seconds = Math.round(open.seconds);
    if (seconds < MIN_SESSION_SECONDS) return;
    const speed = open.weighted / open.seconds;
    const { context } = open;
    this.onSession(
      {
        song_id: context.songId,
        day: localDay(new Date(open.startedAt)),
        started_at: new Date(open.startedAt).toISOString(),
        duration_seconds: seconds,
        track_id: context.trackId,
        loop_name: context.loopName,
        loop_start: context.loopStart,
        loop_end: context.loopEnd,
        speed: Math.round(speed * 100) / 100 || 1,
        mode: context.mode,
        score: context.mode === "scored" ? (context.score ?? null) : null,
        ...(open.completed && context.mode === "wait" ? { completed: true } : {}),
      },
      keepalive,
    );
    // Still playing: carry on into a fresh session on the same topic.
    if (this.since !== null && this.context) {
      this.open = { context: this.context, startedAt: this.now(), seconds: 0, weighted: 0 };
    }
  }
}

/** A duration split for display: seconds under a minute, minutes under an hour, then hours and minutes. */
export function durationParts(
  seconds: number,
):
  | { unit: "seconds"; seconds: number }
  | { unit: "minutes"; minutes: number }
  | { unit: "hours"; hours: number; minutes: number } {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return { unit: "seconds", seconds: total };
  const minutes = Math.round(total / 60);
  if (minutes < 60) return { unit: "minutes", minutes };
  return { unit: "hours", hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}

/** Whole minutes, for the ring and the goal. */
export function minutesOf(seconds: number): number {
  return Math.floor(seconds / 60);
}

/** 0 to 1: how far through the daily goal. A goal of 0 means "no goal", which is never full. */
export function goalProgress(seconds: number, goalMinutes: number): number {
  if (goalMinutes <= 0) return 0;
  return Math.min(1, seconds / (goalMinutes * 60));
}

/** Where the ring's arc ends, as an SVG `stroke-dashoffset` for a circle of this radius. */
export function ringOffset(progress: number, radius: number): number {
  const circumference = 2 * Math.PI * radius;
  return circumference * (1 - Math.min(1, Math.max(0, progress)));
}

export interface HeatCell {
  day: string;
  seconds: number;
  /** 0 (nothing) to 4 (a lot), relative to the goal. */
  level: 0 | 1 | 2 | 3 | 4;
  future: boolean;
}

/** How dark a day's square is. Levels are quarters of the daily goal, or of 30 minutes with no goal. */
export function heatLevel(seconds: number, goalMinutes: number): 0 | 1 | 2 | 3 | 4 {
  if (seconds <= 0) return 0;
  const target = (goalMinutes > 0 ? goalMinutes : 30) * 60;
  const ratio = seconds / target;
  return ratio < 0.34 ? 1 : ratio < 0.67 ? 2 : ratio < 1 ? 3 : 4;
}

/**
 * The calendar heatmap as weeks of seven days, Sunday first, ending with the week of `today`.
 * Days after `today` in the last week are marked `future` so they can be left blank.
 */
export function heatmapWeeks(
  days: readonly { day: string; seconds: number }[],
  today: string,
  goalMinutes: number,
  weeks = 53,
): HeatCell[][] {
  const seconds = new Map(days.map((item) => [item.day, item.seconds]));
  const last = parseDay(today);
  const start = addDays(today, -(weeks - 1) * 7 - last.getDay());
  const result: HeatCell[][] = [];
  for (let week = 0; week < weeks; week += 1) {
    const column: HeatCell[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const day = addDays(start, week * 7 + weekday);
      const value = seconds.get(day) ?? 0;
      column.push({
        day,
        seconds: value,
        level: heatLevel(value, goalMinutes),
        future: day > today,
      });
    }
    result.push(column);
  }
  return result;
}

/** Whole days between two `YYYY-MM-DD` dates (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  const a = parseDay(from);
  const b = parseDay(to);
  return Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
      Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) /
      86_400_000,
  );
}

/** "Today", "Yesterday" or "12 days ago" as a count, so the caller can translate it. */
export function agoDays(day: string, today: string): number {
  return Math.max(0, daysBetween(day, today));
}
