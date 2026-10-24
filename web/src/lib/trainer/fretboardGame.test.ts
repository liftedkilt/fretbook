import { describe, expect, it } from "vitest";
import {
  StableNote,
  accuracy,
  answerFrets,
  checkPlayed,
  checkTap,
  meanMs,
  nextQuestion,
  noteName,
  randomInt,
  recordAnswer,
  weakStringWeights,
} from "./fretboardGame";

const STANDARD = [64, 59, 55, 50, 45, 40];

function sequence(...values: number[]) {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("noteName", () => {
  it("spells with sharps or flats and wraps", () => {
    expect(noteName(1)).toBe("C#");
    expect(noteName(1, "flats")).toBe("Db");
    expect(noteName(-1)).toBe("B");
    expect(noteName(14)).toBe("D");
  });
});

describe("randomInt", () => {
  it("stays inside the range even for a random of 1", () => {
    expect(randomInt(() => 0.999999, 12)).toBe(11);
    expect(randomInt(() => 1, 12)).toBe(11);
    expect(randomInt(() => 0, 12)).toBe(0);
  });
});

describe("nextQuestion", () => {
  it("picks from the allowed strings only", () => {
    for (let i = 0; i < 20; i += 1) {
      const q = nextQuestion(Math.random, 6, { strings: [2, 3] });
      expect([2, 3]).toContain(q.string);
      expect(q.pitchClass).toBeGreaterThanOrEqual(0);
      expect(q.pitchClass).toBeLessThan(12);
    }
  });

  it("falls back to every string when the filter matches none", () => {
    const q = nextQuestion(() => 0, 6, { strings: [9] });
    expect(q.string).toBe(0);
  });

  it("does not repeat the previous question", () => {
    const q = nextQuestion(sequence(0, 0, 0.5, 0.5), 6, { previous: { pitchClass: 0, string: 0 } });
    expect(q).not.toEqual({ pitchClass: 0, string: 0 });
  });

  it("gives up avoiding the repeat after a few tries", () => {
    const q = nextQuestion(() => 0, 6, { previous: { pitchClass: 0, string: 0 } });
    expect(q).toEqual({ pitchClass: 0, string: 0 });
  });

  it("favours heavily weighted strings", () => {
    // random 0.99 lands in the last, heaviest slot.
    const q = nextQuestion(sequence(0.99, 0.5), 3, { weights: [0.1, 0.1, 10] });
    expect(q.string).toBe(2);
  });
});

describe("answers", () => {
  const question = { pitchClass: 7, string: 0 }; // G on the high E string

  it("lists the frets where the note sounds", () => {
    expect(answerFrets(STANDARD, question, 12)).toEqual([3]);
    expect(answerFrets(STANDARD, { pitchClass: 4, string: 0 }, 12)).toEqual([0, 12]);
  });

  it("accepts a tap on the right string and note only", () => {
    expect(checkTap(STANDARD, question, { string: 0, fret: 3 })).toBe(true);
    expect(checkTap(STANDARD, question, { string: 0, fret: 4 })).toBe(false);
    // G is also open on the third string, but the question asked for string 1.
    expect(checkTap(STANDARD, question, { string: 2, fret: 0 })).toBe(false);
    expect(checkTap(STANDARD, question, { string: 9, fret: 0 })).toBe(false);
  });

  it("accepts a played note in the string's range", () => {
    expect(checkPlayed(STANDARD, question, 67, 12)).toBe(true);
    expect(checkPlayed(STANDARD, question, 55, 12)).toBe(false); // right note, below the string
    expect(checkPlayed(STANDARD, question, 79, 12)).toBe(false); // an octave above the 12th fret
    expect(checkPlayed(STANDARD, question, 66, 12)).toBe(false);
    expect(checkPlayed(STANDARD, { pitchClass: 7, string: 9 }, 67, 12)).toBe(false);
  });
});

describe("StableNote", () => {
  it("reports a note once it has been read three times in a row", () => {
    const stable = new StableNote(3);
    expect([60, 60, 60, 60].map((m) => stable.push(m))).toEqual([null, null, 60, null]);
  });

  it("restarts the count when the pitch changes and again after silence", () => {
    const stable = new StableNote(2);
    expect(stable.push(60)).toBeNull();
    expect(stable.push(62)).toBeNull();
    expect(stable.push(62)).toBe(62);
    expect(stable.push(null)).toBeNull();
    expect(stable.push(62)).toBeNull();
    expect(stable.push(62)).toBe(62);
    stable.reset();
    expect(stable.push(62)).toBeNull();
  });
});

describe("string statistics", () => {
  it("records answers without mutating the input", () => {
    const first = recordAnswer({}, 2, true, 800);
    const second = recordAnswer(first, 2, false, 5000);
    expect(first[2]).toEqual({ asked: 1, correct: 1, totalMs: 800 });
    expect(second[2]).toEqual({ asked: 2, correct: 1, totalMs: 800 });
    expect(accuracy(second[2])).toBe(0.5);
    expect(meanMs(second[2])).toBe(800);
  });

  it("has no accuracy or mean without data", () => {
    expect(accuracy(undefined)).toBeNull();
    expect(meanMs({ asked: 3, correct: 0, totalMs: 0 })).toBeNull();
  });

  it("weights weak strings up and untried ones in the middle", () => {
    let stats = recordAnswer({}, 0, true, 500);
    stats = recordAnswer(stats, 1, false, 500);
    expect(weakStringWeights(stats, 3)).toEqual([1, 4, 1.5]);
  });
});
