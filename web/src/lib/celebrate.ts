/*
 * Celebration moments (design language §14): the daily goal, streak milestones, and the
 * one-shot signals the lesson and course pages use. Toasts are queued so only one is on
 * screen, they wait while music is playing, and a goal or milestone already shown today
 * is not shown again on reload.
 */

export const STREAK_MILESTONES = [3, 7, 14, 30, 50, 100] as const;

/** How long a visible toast stays up. */
export const TOAST_MS = 5000;
/** The longest a celebration is allowed to move. */
export const MOTION_MS = 1200;

const STORAGE_KEY = "fretbook.celebrations";

export type CelebrationKind = "goal" | "streak";

export interface Celebration {
  id: string;
  kind: CelebrationKind;
  /** Streak length, or the current streak beside a daily goal. */
  count: number;
  /** False hides the card and keeps the words for the screen reader (the ring is the visual). */
  visual: boolean;
}

export interface PracticeSnapshot {
  /** The player's calendar day, `YYYY-MM-DD`. */
  day: string;
  goalMinutes: number;
  todaySeconds: number;
  streak: number;
}

export interface CelebrationMemory {
  /** The day the daily goal was celebrated, if it was. */
  goalDay: string | null;
  /** Milestone length -> the day that length was celebrated. */
  streaks: Record<string, string>;
  /** Course ids whose finished banner has already played its entrance. */
  courses: string[];
}

export interface PracticePlan {
  goal: boolean;
  /** The milestone to celebrate, or null. */
  streak: number | null;
}

export interface PracticeMarks {
  glowGoal: boolean;
  pulseStreak: boolean;
}

export function emptyMemory(): CelebrationMemory {
  return { goalDay: null, streaks: {}, courses: [] };
}

const EMPTY_MARKS: PracticeMarks = { glowGoal: false, pulseStreak: false };

function isDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a stored memory, dropping anything that is not a day or a known milestone. */
export function readMemory(raw: string | null): CelebrationMemory {
  if (!raw) return emptyMemory();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return emptyMemory();
    const streaks: Record<string, string> = {};
    if (isRecord(parsed.streaks)) {
      for (const milestone of STREAK_MILESTONES) {
        const day = parsed.streaks[String(milestone)];
        if (isDay(day)) streaks[String(milestone)] = day;
      }
    }
    const courses = Array.isArray(parsed.courses)
      ? [...new Set(parsed.courses.filter((item): item is string => typeof item === "string"))]
      : [];
    return { goalDay: isDay(parsed.goalDay) ? parsed.goalDay : null, streaks, courses };
  } catch {
    return emptyMemory();
  }
}

export function writeMemory(memory: CelebrationMemory): string {
  return JSON.stringify(memory);
}

function loadMemory(): CelebrationMemory {
  try {
    if (typeof localStorage === "undefined") return emptyMemory();
    return readMemory(localStorage.getItem(STORAGE_KEY));
  } catch {
    return emptyMemory();
  }
}

function saveMemory(memory: CelebrationMemory): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, writeMemory(memory));
  } catch {
    // Private mode or a full quota: the celebration just will not be remembered.
  }
}

export function isStreakMilestone(days: number): boolean {
  return (STREAK_MILESTONES as readonly number[]).includes(days);
}

/**
 * Which practice celebrations are still due. A goal or milestone already recorded for this
 * calendar day is skipped, so a reload the same day stays quiet. Reaching the same milestone
 * on a later day (the streak was broken and rebuilt) celebrates again.
 */
export function planPracticeCelebrations(
  stats: PracticeSnapshot,
  memory: CelebrationMemory,
): PracticePlan {
  const goalMet = stats.goalMinutes > 0 && stats.todaySeconds >= stats.goalMinutes * 60;
  const milestone = isStreakMilestone(stats.streak) ? stats.streak : null;
  return {
    goal: goalMet && memory.goalDay !== stats.day,
    streak:
      milestone !== null && memory.streaks[String(milestone)] !== stats.day ? milestone : null,
  };
}

/** The memory after `plan` has been shown. The same object comes back when nothing was due. */
export function rememberPractice(
  memory: CelebrationMemory,
  day: string,
  plan: PracticePlan,
): CelebrationMemory {
  if (!plan.goal && plan.streak === null) return memory;
  const streaks = { ...memory.streaks };
  if (plan.streak !== null) streaks[String(plan.streak)] = day;
  return {
    goalDay: plan.goal ? day : memory.goalDay,
    streaks,
    courses: memory.courses,
  };
}

/** Goal first, then the streak. On the practice page the goal toast is announced but not shown. */
export function practiceToasts(
  stats: PracticeSnapshot,
  plan: PracticePlan,
  onPracticePage: boolean,
): Celebration[] {
  const items: Celebration[] = [];
  if (plan.goal) {
    items.push({
      id: `goal:${stats.day}`,
      kind: "goal",
      count: Math.max(0, Math.round(stats.streak)),
      visual: !onPracticePage,
    });
  }
  if (plan.streak !== null) {
    items.push({
      id: `streak:${plan.streak}:${stats.day}`,
      kind: "streak",
      count: plan.streak,
      visual: true,
    });
  }
  return items;
}

/** Percentage points over the previous best, or null when there is no earlier score or no visible rise. */
export function personalBestPoints(accuracy: number, previous: number | null): number | null {
  if (previous === null) return null;
  const delta = Math.round(accuracy * 100) - Math.round(previous * 100);
  return delta > 0 ? delta : null;
}

/** Estimated length of a course, from the minutes on each lesson. */
export function courseMinutes(levels: { lessons: { minutes: number }[] }[]): number {
  return levels.reduce(
    (sum, level) =>
      sum +
      level.lessons.reduce(
        (inner, lesson) => inner + (Number.isFinite(lesson.minutes) ? lesson.minutes : 0),
        0,
      ),
    0,
  );
}

export function snapshotFromStats(stats: {
  today: string;
  goal: { daily_minutes: number };
  today_seconds: number;
  current_streak: number;
}): PracticeSnapshot {
  return {
    day: stats.today,
    goalMinutes: stats.goal.daily_minutes,
    todaySeconds: stats.today_seconds,
    streak: stats.current_streak,
  };
}

type TimerFn = (fn: () => void, ms: number) => unknown;

export class CelebrationQueue {
  private queue: Celebration[] = [];
  private currentItem: Celebration | null = null;
  private held = false;
  private timer: unknown = null;
  private readonly listeners = new Set<(item: Celebration | null) => void>();
  private readonly toastMs: number;
  private readonly motionMs: number;
  private readonly setTimer: TimerFn;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(
    options: {
      toastMs?: number;
      motionMs?: number;
      setTimer?: TimerFn;
      clearTimer?: (handle: unknown) => void;
    } = {},
  ) {
    this.toastMs = options.toastMs ?? TOAST_MS;
    this.motionMs = options.motionMs ?? MOTION_MS;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer =
      options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  get current(): Celebration | null {
    return this.currentItem;
  }

  subscribe(listener: (item: Celebration | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.currentItem);
    return () => this.listeners.delete(listener);
  }

  /** Ignore a celebration that is already showing or waiting. */
  push(item: Celebration): void {
    if (this.currentItem?.id === item.id || this.queue.some((queued) => queued.id === item.id))
      return;
    this.queue.push(item);
    this.pump();
  }

  /**
   * Hold the queue while music is playing or the score is on screen. A toast that was already
   * up goes back to the front and returns when the hold lifts.
   */
  hold(held: boolean): void {
    if (this.held === held) return;
    this.held = held;
    if (held) {
      this.stopTimer();
      if (this.currentItem) {
        this.queue.unshift(this.currentItem);
        this.currentItem = null;
        this.emit();
      }
    } else {
      this.pump();
    }
  }

  dismiss(): void {
    this.stopTimer();
    if (!this.currentItem) return;
    this.currentItem = null;
    this.pump();
    // Skip the empty beat when the next celebration is already waiting.
    if (!this.currentItem) this.emit();
  }

  reset(): void {
    this.stopTimer();
    this.queue = [];
    this.currentItem = null;
    this.held = false;
    this.emit();
  }

  private pump(): void {
    if (this.held || this.currentItem || this.queue.length === 0) return;
    this.currentItem = this.queue.shift() ?? null;
    this.emit();
    if (!this.currentItem) return;
    const dwell = this.currentItem.visual ? this.toastMs : this.motionMs;
    this.timer = this.setTimer(() => this.dismiss(), dwell);
  }

  private stopTimer(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.currentItem);
  }
}

class MarkHub {
  private marks: PracticeMarks = { ...EMPTY_MARKS };
  private readonly listeners = new Set<(marks: PracticeMarks) => void>();

  set(next: PracticeMarks): void {
    this.marks = next;
    if (this.listeners.size === 0) return;
    for (const listener of this.listeners) listener(next);
    this.marks = { ...EMPTY_MARKS };
  }

  subscribe(listener: (marks: PracticeMarks) => void): () => void {
    if (this.marks.glowGoal || this.marks.pulseStreak) {
      listener(this.marks);
      this.marks = { ...EMPTY_MARKS };
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reset(): void {
    this.marks = { ...EMPTY_MARKS };
    this.listeners.clear();
  }
}

export const celebrations = new CelebrationQueue();
const practiceMarks = new MarkHub();

export function subscribePracticeMarks(listener: (marks: PracticeMarks) => void): () => void {
  return practiceMarks.subscribe(listener);
}

/** Remember the plan, glow the practice page, and queue the toasts. Safe to call again the same day. */
export function presentPractice(stats: PracticeSnapshot, onPracticePage: boolean): void {
  const memory = loadMemory();
  const plan = planPracticeCelebrations(stats, memory);
  const next = rememberPractice(memory, stats.day, plan);
  if (next !== memory) saveMemory(next);
  if (onPracticePage && (plan.goal || plan.streak !== null)) {
    practiceMarks.set({ glowGoal: plan.goal, pulseStreak: plan.streak !== null });
  }
  for (const item of practiceToasts(stats, plan, onPracticePage)) celebrations.push(item);
}

export async function reviewAfterPractice(load: () => Promise<PracticeSnapshot>): Promise<void> {
  try {
    presentPractice(await load(), false);
  } catch {
    // A missed celebration must not get in the way of playing.
  }
}

/** The practice page refetches when a session lands, so the ring can fill without a second toast. */
export const PRACTICE_LOGGED = "fretbook-practice";

export function notifyPracticeLogged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PRACTICE_LOGGED));
}

/**
 * After a practice session is saved. On the practice page the view refetches and celebrates
 * in place. Anywhere else, the toast is queued (and waits if playback is holding it).
 */
export function onPracticeLogged(
  keepalive: boolean,
  onPracticePage: boolean,
  load: () => Promise<PracticeSnapshot>,
): void {
  if (keepalive) return;
  if (onPracticePage) {
    notifyPracticeLogged();
    return;
  }
  void reviewAfterPractice(load);
}

export function holdCelebrations(held: boolean): void {
  celebrations.hold(held);
}

/** True the first time a finished course is shown, so the banner only enters once. */
export function claimCourseAnimation(courseId: string): boolean {
  const memory = loadMemory();
  if (memory.courses.includes(courseId)) return false;
  saveMemory({ ...memory, courses: [...memory.courses, courseId] });
  return true;
}

let freshLesson: { courseId: string; lessonId: string } | null = null;

/** The course path draws this lesson's check the next time that course is opened. */
export function markLessonPassed(courseId: string, lessonId: string): void {
  freshLesson = { courseId, lessonId };
}

/** The lesson id to animate, once. A reload forgets it, so the draw does not repeat. */
export function consumeLessonPassed(courseId: string): string | null {
  if (freshLesson?.courseId !== courseId) return null;
  const lessonId = freshLesson.lessonId;
  freshLesson = null;
  return lessonId;
}

export function resetCelebrations(): void {
  celebrations.reset();
  practiceMarks.reset();
  freshLesson = null;
}
