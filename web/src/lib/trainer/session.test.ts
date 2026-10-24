import { describe, expect, it } from "vitest";
import { TrainerSession } from "./session";

function clock() {
  let now = 1_000_000;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe("TrainerSession", () => {
  it("times each answer from the start of its round", () => {
    const c = clock();
    const session = new TrainerSession("fretboard", 0, c.now);
    session.startRound();
    c.advance(1500);
    expect(session.answer(true)).toBe(1500);
    session.startRound();
    c.advance(700);
    session.answer(false);
    const done = session.finish();
    expect(done.seconds).toBe(2);
    expect(done.summary).toMatchObject({ rounds: 2, correct: 1, score: 50 });
    expect(session.rounds).toBe(2);
    expect(session.correct).toBe(1);
  });

  it("has no clock when untimed", () => {
    const session = new TrainerSession("interval", 0, clock().now);
    expect(session.remaining()).toBeNull();
    expect(session.over).toBe(false);
  });

  it("counts down and ignores answers after the time is up", () => {
    const c = clock();
    const session = new TrainerSession("chord", 30, c.now);
    c.advance(10_000);
    expect(session.remaining()).toBe(20);
    c.advance(25_000);
    expect(session.remaining()).toBe(0);
    expect(session.over).toBe(true);
    session.answer(true);
    expect(session.rounds).toBe(0);
  });

  it("is over once finished", () => {
    const session = new TrainerSession("interval", 0, clock().now);
    session.finish();
    expect(session.over).toBe(true);
  });
});
