import { describe, expect, it, vi } from "vitest";
import {
  addDays,
  agoDays,
  daysBetween,
  durationParts,
  goalProgress,
  heatLevel,
  heatmapWeeks,
  IdleWatch,
  localDay,
  MAX_SESSION_SECONDS,
  MERGE_PAUSE_MS,
  MIN_SESSION_SECONDS,
  WAIT_IDLE_MS,
  minutesOf,
  parseDay,
  PracticeTimer,
  ringOffset,
  type SessionContext,
} from "./practiceLog";
import type { PracticeSessionDraft } from "./types";

const base: SessionContext = {
  songId: "song-1",
  trackId: "t1",
  loopName: "",
  loopStart: null,
  loopEnd: null,
  mode: "free",
  speed: 1,
};

function harness() {
  let clock = new Date(2026, 2, 10, 20, 0, 0).getTime();
  const sessions: { session: PracticeSessionDraft; keepalive: boolean }[] = [];
  let pending: { fn: () => void; at: number; id: number } | null = null;
  let next = 0;
  const timer = new PracticeTimer({
    now: () => clock,
    onSession: (session, keepalive) => sessions.push({ session, keepalive }),
    setTimer: (fn, ms) => {
      pending = { fn, at: clock + ms, id: ++next };
      return pending.id;
    },
    clearTimer: (id) => {
      if (pending?.id === id) pending = null;
    },
  });
  return {
    timer,
    sessions,
    advance(ms: number) {
      clock += ms;
      if (pending && clock >= pending.at) {
        const { fn } = pending;
        pending = null;
        fn();
      }
    },
    get armed() {
      return pending !== null;
    },
  };
}

describe("PracticeTimer", () => {
  it("logs one session for a stretch of playing", () => {
    const h = harness();
    h.timer.update(true, base);
    h.advance(90_000);
    h.timer.update(false, base);
    expect(h.sessions).toHaveLength(0);
    h.advance(MERGE_PAUSE_MS);
    expect(h.sessions).toHaveLength(1);
    const { session } = h.sessions[0];
    expect(session).toMatchObject({
      song_id: "song-1",
      day: "2026-03-10",
      duration_seconds: 90,
      speed: 1,
      mode: "free",
      loop_name: "",
      score: null,
    });
    expect(session.started_at).toBe(new Date(2026, 2, 10, 20, 0, 0).toISOString());
  });

  it("keeps a short pause inside the same session", () => {
    const h = harness();
    h.timer.update(true, base);
    h.advance(30_000);
    h.timer.update(false, base);
    h.advance(20_000);
    h.timer.update(true, base);
    h.advance(30_000);
    h.timer.update(false, base);
    h.timer.flush();
    expect(h.sessions.map((item) => item.session.duration_seconds)).toEqual([60]);
  });

  it("drops stretches too short to mean anything", () => {
    const h = harness();
    h.timer.update(true, base);
    h.advance((MIN_SESSION_SECONDS - 1) * 1000);
    h.timer.update(false, base);
    h.timer.flush();
    expect(h.sessions).toHaveLength(0);
  });

  it("splits when the loop, track or mode changes and reports the speed time was spent at", () => {
    const h = harness();
    h.timer.update(true, { ...base, speed: 0.5 });
    h.advance(30_000);
    h.timer.update(true, { ...base, speed: 1 });
    h.advance(30_000);
    // Moving to a loop ends the first session and starts the next without a pause.
    const loop = { ...base, loopName: "Riff", loopStart: 2, loopEnd: 5, speed: 0.8 };
    h.timer.update(true, loop);
    h.advance(40_000);
    h.timer.flush();
    expect(h.sessions.map((item) => [item.session.duration_seconds, item.session.speed])).toEqual([
      [60, 0.75],
      [40, 0.8],
    ]);
    expect(h.sessions[1].session).toMatchObject({ loop_name: "Riff", loop_start: 2, loop_end: 5 });
  });

  it("does not split on a speed change alone", () => {
    const h = harness();
    h.timer.update(true, base);
    h.advance(20_000);
    h.timer.update(true, { ...base, speed: 0.9 });
    h.advance(20_000);
    h.timer.flush();
    expect(h.sessions).toHaveLength(1);
  });

  it("flush ends the session at once, and with keepalive when the page is going away", () => {
    const h = harness();
    h.timer.update(true, base);
    h.advance(45_000);
    h.timer.flush(true);
    expect(h.sessions).toHaveLength(1);
    expect(h.sessions[0].keepalive).toBe(true);
    expect(h.sessions[0].session.duration_seconds).toBe(45);
    // Nothing is left to send twice.
    h.timer.flush(true);
    expect(h.sessions).toHaveLength(1);
  });

  it("carries on into a new session after a flush while still playing", () => {
    const h = harness();
    h.timer.update(true, base);
    h.advance(30_000);
    h.timer.flush();
    h.advance(30_000);
    h.timer.flush();
    expect(h.sessions.map((item) => item.session.duration_seconds)).toEqual([30, 30]);
  });

  it("cuts a very long session at the cap", () => {
    const h = harness();
    h.timer.update(true, base);
    h.advance((MAX_SESSION_SECONDS + 100) * 1000);
    h.timer.update(true, base);
    h.timer.flush();
    expect(h.sessions.map((item) => item.session.duration_seconds)).toEqual([
      MAX_SESSION_SECONDS + 100,
    ]);
  });

  it("keeps the score only for scored sessions", () => {
    const h = harness();
    h.timer.update(true, { ...base, mode: "scored", score: 88 });
    h.advance(30_000);
    h.timer.flush();
    h.timer.update(true, { ...base, mode: "wait", score: 99 });
    h.advance(30_000);
    h.timer.flush();
    expect(h.sessions.map((item) => item.session.score)).toEqual([88, null]);
  });

  it("dispose drops the pending pause timer and any open session", () => {
    const h = harness();
    h.timer.update(true, base);
    h.advance(30_000);
    h.timer.update(false, base);
    expect(h.armed).toBe(true);
    h.timer.dispose();
    expect(h.armed).toBe(false);
    h.timer.flush();
    expect(h.sessions).toHaveLength(0);
  });
});

describe("days", () => {
  it("formats the player's local day and does date arithmetic across month ends", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(parseDay("2026-03-10").getDate()).toBe(10);
    expect(daysBetween("2026-03-01", "2026-03-10")).toBe(9);
    expect(daysBetween("2026-03-10", "2026-03-01")).toBe(-9);
    expect(agoDays("2026-03-10", "2026-03-10")).toBe(0);
    expect(agoDays("2026-03-20", "2026-03-10")).toBe(0);
    expect(agoDays("2026-02-24", "2026-03-10")).toBe(14);
  });
});

describe("goal, ring and durations", () => {
  it("splits durations into seconds, minutes, or hours and minutes", () => {
    expect(durationParts(0)).toEqual({ unit: "seconds", seconds: 0 });
    expect(durationParts(45)).toEqual({ unit: "seconds", seconds: 45 });
    expect(durationParts(60)).toEqual({ unit: "minutes", minutes: 1 });
    expect(durationParts(59 * 60 + 40)).toEqual({ unit: "hours", hours: 1, minutes: 0 });
    expect(durationParts(3600 + 5 * 60)).toEqual({ unit: "hours", hours: 1, minutes: 5 });
    expect(durationParts(-5)).toEqual({ unit: "seconds", seconds: 0 });
    expect(minutesOf(119)).toBe(1);
  });

  it("progress is capped at 1 and a zero goal never fills", () => {
    expect(goalProgress(300, 10)).toBe(0.5);
    expect(goalProgress(6000, 10)).toBe(1);
    expect(goalProgress(600, 0)).toBe(0);
  });

  it("the ring's offset runs from a full circle to none", () => {
    const circumference = 2 * Math.PI * 40;
    expect(ringOffset(0, 40)).toBeCloseTo(circumference);
    expect(ringOffset(0.5, 40)).toBeCloseTo(circumference / 2);
    expect(ringOffset(1, 40)).toBeCloseTo(0);
    expect(ringOffset(5, 40)).toBeCloseTo(0);
    expect(ringOffset(-1, 40)).toBeCloseTo(circumference);
  });
});

describe("heatmap", () => {
  it("levels are quarters-ish of the goal, or of half an hour without one", () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(60, 10)).toBe(1);
    expect(heatLevel(300, 10)).toBe(2);
    expect(heatLevel(500, 10)).toBe(3);
    expect(heatLevel(600, 10)).toBe(4);
    expect(heatLevel(1800, 0)).toBe(4);
    expect(heatLevel(60, 0)).toBe(1);
  });

  it("lays out Sunday-first weeks ending with this week, blanking days to come", () => {
    // 2026-03-10 is a Tuesday.
    const weeks = heatmapWeeks([{ day: "2026-03-09", seconds: 600 }], "2026-03-10", 10, 3);
    expect(weeks).toHaveLength(3);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks[0][0].day).toBe("2026-02-22");
    const last = weeks[2];
    expect(last.map((cell) => cell.day)).toEqual([
      "2026-03-08",
      "2026-03-09",
      "2026-03-10",
      "2026-03-11",
      "2026-03-12",
      "2026-03-13",
      "2026-03-14",
    ]);
    expect(last.map((cell) => cell.future)).toEqual([false, false, false, true, true, true, true]);
    expect(last[1]).toMatchObject({ seconds: 600, level: 4 });
    expect(last[0]).toMatchObject({ seconds: 0, level: 0 });
  });
});

describe("IdleWatch", () => {
  it("fires once after the quiet time, and re-arming restarts it", () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const watch = new IdleWatch(WAIT_IDLE_MS, onIdle);
    watch.arm();
    vi.advanceTimersByTime(WAIT_IDLE_MS - 1);
    watch.arm();
    vi.advanceTimersByTime(WAIT_IDLE_MS - 1);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(WAIT_IDLE_MS * 2);
    expect(onIdle).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("does not fire once disarmed", () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const watch = new IdleWatch(1000, onIdle);
    watch.arm();
    watch.disarm();
    vi.advanceTimersByTime(5000);
    expect(onIdle).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("stops a wait-mode session counting when the player is stuck", () => {
    const h = harness();
    h.timer.update(true, { ...base, mode: "wait" });
    h.advance(WAIT_IDLE_MS);
    // The idle cap turns the activity off; the stretch before it is kept.
    h.timer.update(false, { ...base, mode: "wait" });
    h.advance(10 * 60_000);
    expect(h.sessions).toHaveLength(1);
    expect(h.sessions[0].session.duration_seconds).toBe(120);
    expect(h.sessions[0].session.mode).toBe("wait");
  });

  it("logs scored mode with its score", () => {
    const h = harness();
    h.timer.update(true, { ...base, mode: "scored", score: 87.5 });
    h.advance(30_000);
    h.timer.flush();
    expect(h.sessions[0].session).toMatchObject({ mode: "scored", score: 87.5 });
  });
});
