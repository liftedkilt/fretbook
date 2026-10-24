import { describe, expect, it } from "vitest";
import {
  CHORD_QUALITIES,
  INTERVALS,
  checkChord,
  checkInterval,
  checkPlayedTarget,
  chordPool,
  intervalPool,
  nextChord,
  nextInterval,
  summarize,
} from "./ear";

describe("intervals", () => {
  it("has twelve intervals one semitone apart and a smaller easy set", () => {
    expect(INTERVALS.map((i) => i.semitones)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(intervalPool("all")).toHaveLength(12);
    expect(intervalPool("easy").map((i) => i.id)).toEqual(["m3", "M3", "P4", "P5", "P8"]);
  });

  it("builds the second note above or below the first", () => {
    const up = nextInterval(() => 0, "easy", ["up"]);
    expect(up.target - up.root).toBe(up.interval.semitones);
    const down = nextInterval(() => 0, "easy", ["down"]);
    expect(down.root - down.target).toBe(down.interval.semitones);
  });

  it("avoids repeating the previous interval and direction", () => {
    let i = 0;
    const rng = () => [0, 0, 0, 0.5, 0, 0][i++ % 6];
    const first = nextInterval(() => 0, "easy");
    const second = nextInterval(rng, "easy", ["up"], first);
    expect(second.interval.id).not.toBe(first.interval.id);
  });

  it("settles for a repeat when there is no choice", () => {
    const first = nextInterval(() => 0, "easy", ["up"]);
    const again = nextInterval(() => 0, "easy", ["up"], first);
    expect(again.interval.id).toBe(first.interval.id);
  });

  it("checks a button answer by id", () => {
    const q = nextInterval(() => 0, "easy");
    expect(checkInterval(q, q.interval.id)).toBe(true);
    expect(checkInterval(q, "TT")).toBe(false);
  });

  it("accepts the target in any octave when played back", () => {
    const q = nextInterval(() => 0, "easy", ["up"]);
    expect(checkPlayedTarget(q, q.target)).toBe(true);
    expect(checkPlayedTarget(q, q.target - 12)).toBe(true);
    expect(checkPlayedTarget(q, q.target + 1)).toBe(false);
  });
});

describe("chords", () => {
  it("builds the notes from the root and quality", () => {
    const q = nextChord(() => 0, "all");
    expect(q.notes).toEqual(q.quality.tones.map((tone) => q.root + tone));
  });

  it("has a smaller easy set of the plainest qualities", () => {
    expect(chordPool("easy").map((c) => c.id)).toEqual(["major", "minor", "dom7", "maj7"]);
    expect(chordPool("all")).toHaveLength(CHORD_QUALITIES.length);
  });

  it("avoids repeating the previous quality and checks answers", () => {
    const first = nextChord(() => 0, "easy");
    const second = nextChord(() => (first.quality.id === "major" ? 0.3 : 0), "easy", first);
    expect(second.quality.id).not.toBe(first.quality.id);
    expect(checkChord(first, first.quality.id)).toBe(true);
    expect(checkChord(first, "dim")).toBe(false);
  });

  it("settles for a repeat when the pool is a single choice", () => {
    const first = nextChord(() => 0, "easy");
    const again = nextChord(() => 0, "easy", first);
    expect(again.quality.id).toBe(first.quality.id);
  });
});

describe("summarize", () => {
  it("scores, averages the correct answers' times and finds the best streak", () => {
    const summary = summarize([
      { correct: true, ms: 1000 },
      { correct: true, ms: 2000 },
      { correct: false, ms: 9000 },
      { correct: true, ms: 3000 },
    ]);
    expect(summary).toEqual({ rounds: 4, correct: 3, score: 75, meanMs: 2000, bestStreak: 2 });
  });

  it("has no score with no rounds", () => {
    expect(summarize([])).toEqual({
      rounds: 0,
      correct: 0,
      score: null,
      meanMs: null,
      bestStreak: 0,
    });
  });
});
