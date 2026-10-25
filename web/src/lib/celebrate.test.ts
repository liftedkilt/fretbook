import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CelebrationQueue,
  MOTION_MS,
  PRACTICE_LOGGED,
  STREAK_MILESTONES,
  TOAST_MS,
  celebrations,
  claimCourseAnimation,
  consumeLessonPassed,
  courseMinutes,
  emptyMemory,
  holdCelebrations,
  isStreakMilestone,
  markLessonPassed,
  notifyPracticeLogged,
  onPracticeLogged,
  personalBestPoints,
  planPracticeCelebrations,
  practiceToasts,
  presentPractice,
  readMemory,
  rememberPractice,
  resetCelebrations,
  reviewAfterPractice,
  snapshotFromStats,
  subscribePracticeMarks,
  writeMemory,
  type Celebration,
  type PracticeSnapshot,
} from "./celebrate";

const day = "2026-10-25";

function stats(extra: Partial<PracticeSnapshot> = {}): PracticeSnapshot {
  return { day, goalMinutes: 10, todaySeconds: 300, streak: 1, ...extra };
}

describe("streak milestones", () => {
  it("celebrates only 3, 7, 14, 30, 50 and 100", () => {
    const due: number[] = [];
    for (let days = 0; days <= 120; days += 1) if (isStreakMilestone(days)) due.push(days);
    expect(due).toEqual([...STREAK_MILESTONES]);
    for (const quiet of [0, 2, 4, 8, 15, 31, 49, 99, 101]) {
      expect(planPracticeCelebrations(stats({ streak: quiet }), emptyMemory()).streak).toBeNull();
    }
    for (const milestone of STREAK_MILESTONES) {
      expect(planPracticeCelebrations(stats({ streak: milestone }), emptyMemory()).streak).toBe(
        milestone,
      );
    }
  });

  it("does not celebrate the same milestone again on reload the same day", () => {
    const once = planPracticeCelebrations(stats({ streak: 7 }), emptyMemory());
    const remembered = rememberPractice(emptyMemory(), day, once);
    expect(remembered.streaks["7"]).toBe(day);
    expect(planPracticeCelebrations(stats({ streak: 7 }), remembered).streak).toBeNull();
  });

  it("celebrates a milestone again when it is reached on a later day", () => {
    const remembered = rememberPractice(emptyMemory(), "2026-10-01", { goal: false, streak: 7 });
    expect(planPracticeCelebrations(stats({ streak: 7 }), remembered).streak).toBe(7);
  });

  it("leaves the memory alone when nothing is due", () => {
    const stored = emptyMemory();
    expect(rememberPractice(stored, day, { goal: false, streak: null })).toBe(stored);
  });
});

describe("daily goal", () => {
  it("is due once the minutes are met, and not before, at zero, or twice the same day", () => {
    expect(planPracticeCelebrations(stats({ todaySeconds: 599 }), emptyMemory()).goal).toBe(false);
    expect(planPracticeCelebrations(stats({ todaySeconds: 600 }), emptyMemory()).goal).toBe(true);
    expect(planPracticeCelebrations(stats({ todaySeconds: 900 }), emptyMemory()).goal).toBe(true);
    expect(
      planPracticeCelebrations(stats({ goalMinutes: 0, todaySeconds: 900 }), emptyMemory()).goal,
    ).toBe(false);
    const remembered = rememberPractice(emptyMemory(), day, { goal: true, streak: null });
    expect(planPracticeCelebrations(stats({ todaySeconds: 900 }), remembered).goal).toBe(false);
    expect(
      planPracticeCelebrations(stats({ day: "2026-10-26", todaySeconds: 900 }), remembered).goal,
    ).toBe(true);
  });

  it("toasts the goal off the practice page and keeps it quiet on the page, goal before streak", () => {
    const plan = { goal: true, streak: 7 };
    const given = stats({ todaySeconds: 600, streak: 7 });
    expect(practiceToasts(given, plan, false)).toEqual([
      { id: `goal:${day}`, kind: "goal", count: 7, visual: true },
      { id: `streak:7:${day}`, kind: "streak", count: 7, visual: true },
    ]);
    expect(practiceToasts(given, plan, true)[0].visual).toBe(false);
    expect(practiceToasts(given, { goal: false, streak: null }, false)).toEqual([]);
    expect(practiceToasts(stats({ streak: -3, todaySeconds: 600 }), plan, false)[0].count).toBe(0);
  });
});

describe("personal best and course length", () => {
  it("reports the rise in percentage points", () => {
    expect(personalBestPoints(0.94, 0.88)).toBe(6);
    expect(personalBestPoints(0.7, null)).toBeNull();
    expect(personalBestPoints(0.901, 0.899)).toBeNull();
    expect(personalBestPoints(0.5, 0.9)).toBeNull();
  });

  it("adds up lesson minutes and ignores a length that is not a number", () => {
    expect(
      courseMinutes([
        { lessons: [{ minutes: 6 }, { minutes: 10 }] },
        { lessons: [{ minutes: Number.NaN }, { minutes: 4 }] },
      ]),
    ).toBe(20);
    expect(courseMinutes([])).toBe(0);
  });
});

describe("memory", () => {
  it("keeps valid days and drops the rest", () => {
    const raw = writeMemory({
      goalDay: day,
      streaks: { "7": day, "4": day, "14": "nope" },
      courses: ["g1", "g1", 3 as unknown as string],
    });
    expect(readMemory(raw)).toEqual({ goalDay: day, streaks: { "7": day }, courses: ["g1"] });
    expect(readMemory(null)).toEqual(emptyMemory());
    expect(readMemory("{")).toEqual(emptyMemory());
    expect(readMemory("[]")).toEqual(emptyMemory());
    expect(readMemory(JSON.stringify({ goalDay: "today", streaks: null, courses: "g1" }))).toEqual(
      emptyMemory(),
    );
  });
});

describe("CelebrationQueue", () => {
  it("shows one at a time, skips duplicates, and uses a shorter dwell for a quiet goal", () => {
    const timers = clock();
    const queue = new CelebrationQueue({
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    const seen: (string | null)[] = [];
    queue.subscribe((item) => seen.push(item?.id ?? null));
    const goal: Celebration = { id: "goal", kind: "goal", count: 6, visual: false };
    const streak: Celebration = { id: "streak", kind: "streak", count: 7, visual: true };
    queue.push(goal);
    queue.push(goal);
    queue.push(streak);
    expect(queue.current).toEqual(goal);
    expect(timers.queued.map((item) => item.ms)).toEqual([MOTION_MS]);
    timers.fire();
    expect(queue.current).toEqual(streak);
    expect(timers.queued.map((item) => item.ms)).toEqual([TOAST_MS]);
    timers.fire();
    expect(queue.current).toBeNull();
    expect(seen).toEqual([null, "goal", "streak", null]);
  });

  it("holds a toast while playback is on and shows it when playback stops", () => {
    const timers = clock();
    const queue = new CelebrationQueue({
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    const goal: Celebration = { id: "goal", kind: "goal", count: 1, visual: true };
    queue.hold(true);
    queue.push(goal);
    expect(queue.current).toBeNull();
    expect(timers.queued).toHaveLength(0);
    queue.hold(true);
    queue.hold(false);
    expect(queue.current?.id).toBe("goal");
    queue.hold(true);
    expect(queue.current).toBeNull();
    expect(timers.queued).toHaveLength(0);
    queue.hold(false);
    expect(queue.current?.id).toBe("goal");
    queue.dismiss();
    queue.dismiss();
    expect(queue.current).toBeNull();
  });

  it("reset drops whatever is waiting", () => {
    const timers = clock();
    const queue = new CelebrationQueue({
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    queue.push({ id: "goal", kind: "goal", count: 1, visual: true });
    queue.reset();
    expect(queue.current).toBeNull();
    expect(timers.queued).toHaveLength(0);
  });
});

describe("presenting practice", () => {
  afterEach(() => {
    resetCelebrations();
    vi.unstubAllGlobals();
  });

  function storage(initial: string | null = null) {
    const data = new Map<string, string>();
    if (initial !== null) data.set("fretbook.celebrations", initial);
    const store = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (store.fail) throw new Error("full");
        data.set(key, value);
      },
      fail: false,
    };
    vi.stubGlobal("localStorage", store);
    return store;
  }

  it("glows and pulses once, then stays quiet for the rest of the day", () => {
    const store = storage();
    const marks: { glowGoal: boolean; pulseStreak: boolean }[] = [];
    const stop = subscribePracticeMarks((next) => marks.push({ ...next }));
    presentPractice(stats({ todaySeconds: 600, streak: 14 }), true);
    expect(marks).toEqual([{ glowGoal: true, pulseStreak: true }]);
    expect(celebrations.current?.visual).toBe(false);
    expect(readMemory(store.getItem("fretbook.celebrations"))).toMatchObject({
      goalDay: day,
      streaks: { "14": day },
    });
    stop();
    resetCelebrations();
    const again: { glowGoal: boolean }[] = [];
    subscribePracticeMarks((next) => again.push(next));
    presentPractice(stats({ todaySeconds: 900, streak: 14 }), true);
    expect(again).toEqual([]);
    expect(celebrations.current).toBeNull();
  });

  it("toasts off the practice page and survives a full store", () => {
    const store = storage();
    presentPractice(stats({ todaySeconds: 600, streak: 6 }), false);
    expect(celebrations.current).toMatchObject({ kind: "goal", visual: true, count: 6 });
    store.fail = true;
    expect(() =>
      presentPractice(stats({ day: "2026-10-26", todaySeconds: 600, streak: 6 }), false),
    ).not.toThrow();
  });

  it("ignores a broken store", () => {
    storage("{");
    expect(() => presentPractice(stats({ todaySeconds: 10 }), false)).not.toThrow();
    expect(celebrations.current).toBeNull();
  });

  it("maps the dashboard fields", () => {
    expect(
      snapshotFromStats({
        today: day,
        goal: { daily_minutes: 15 },
        today_seconds: 90,
        current_streak: 3,
      }),
    ).toEqual({ day, goalMinutes: 15, todaySeconds: 90, streak: 3 });
  });

  it("keeps marks until the practice page is listening", () => {
    storage();
    presentPractice(stats({ todaySeconds: 600, streak: 2 }), true);
    let glow = false;
    subscribePracticeMarks((next) => {
      glow = next.glowGoal;
    });
    expect(glow).toBe(true);
    glow = false;
    subscribePracticeMarks((next) => {
      glow = next.glowGoal;
    });
    expect(glow).toBe(false);
  });

  it("reviews a loaded snapshot and swallows a failed load", async () => {
    storage();
    await reviewAfterPractice(async () => stats({ todaySeconds: 600, streak: 3 }));
    expect(celebrations.current?.kind).toBe("goal");
    await expect(
      reviewAfterPractice(async () => {
        throw new Error("down");
      }),
    ).resolves.toBeUndefined();
  });

  it("asks the practice page to refresh instead of toasting over it", async () => {
    storage();
    const events: string[] = [];
    vi.stubGlobal("window", {
      dispatchEvent: (event: Event) => {
        events.push(event.type);
        return true;
      },
    });
    const load = vi.fn(async () => stats({ todaySeconds: 0 }));
    onPracticeLogged(true, false, load);
    onPracticeLogged(false, true, load);
    expect(load).not.toHaveBeenCalled();
    expect(events).toEqual([PRACTICE_LOGGED]);
    onPracticeLogged(false, false, load);
    expect(load).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(celebrations.current).toBeNull());
  });

  it("notify does nothing without a window", () => {
    vi.stubGlobal("window", undefined);
    expect(() => notifyPracticeLogged()).not.toThrow();
  });

  it("plays the course banner once and draws a passed lesson once", () => {
    const store = storage();
    expect(claimCourseAnimation("g1")).toBe(true);
    expect(claimCourseAnimation("g1")).toBe(false);
    expect(readMemory(store.getItem("fretbook.celebrations")).courses).toEqual(["g1"]);
    expect(consumeLessonPassed("g1")).toBeNull();
    markLessonPassed("g1", "l2");
    expect(consumeLessonPassed("other")).toBeNull();
    expect(consumeLessonPassed("g1")).toBe("l2");
    expect(consumeLessonPassed("g1")).toBeNull();
  });

  it("releases a hold", () => {
    storage();
    holdCelebrations(true);
    presentPractice(stats({ todaySeconds: 600, streak: 1 }), false);
    expect(celebrations.current).toBeNull();
    holdCelebrations(false);
    expect(celebrations.current?.kind).toBe("goal");
  });
});

function clock() {
  const queued: { fn: () => void; ms: number }[] = [];
  return {
    queued,
    setTimer(fn: () => void, ms: number) {
      const handle = { fn, ms };
      queued.push(handle);
      return handle;
    },
    clearTimer(handle: unknown) {
      const index = queued.indexOf(handle as (typeof queued)[number]);
      if (index >= 0) queued.splice(index, 1);
    },
    fire() {
      queued.shift()?.fn();
    },
  };
}
