import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  lessonResult,
  lessonSongPath,
  MAX_PASS_BPM,
  parseLessonParam,
  recallLessonSong,
  rememberLessonSong,
  withLesson,
} from "./lessonRun";

describe("parseLessonParam", () => {
  it("reads a course and lesson id pair", () => {
    expect(parseLessonParam("?lesson=guitar-first-steps/03-a-steady-strum")).toEqual({
      course: "guitar-first-steps",
      lesson: "03-a-steady-strum",
    });
    expect(parseLessonParam("?loop=riff&lesson=a/b")).toEqual({ course: "a", lesson: "b" });
  });

  it("ignores anything that is not a lesson address", () => {
    for (const search of [
      "",
      "?loop=riff",
      "?lesson=",
      "?lesson=a",
      "?lesson=a/b/c",
      "?lesson=A/b",
      "?lesson=a/../b",
      "?lesson=%2F/b",
    ]) {
      expect(parseLessonParam(search)).toBeNull();
    }
  });

  it("round-trips through lessonSongPath", () => {
    const ref = { course: "c-1", lesson: "l-2" };
    const path = lessonSongPath("abc123", ref);
    expect(path).toBe("/songs/abc123?lesson=c-1/l-2");
    expect(parseLessonParam(path.slice(path.indexOf("?")))).toEqual(ref);
  });
});

const score = { type: "score" as const, song: "" };
const wait = { type: "wait" as const, song: "" };
const scored = {
  kind: "scored" as const,
  accuracy: 86.04,
  songBpm: 100,
  rate: 0.8,
  wholeSong: true,
};

describe("lessonResult", () => {
  it("reports the score and the tempo (song tempo times playback speed) of a whole-song scored run", () => {
    expect(lessonResult(score, scored)).toEqual({
      score: 86,
      bpm: 80,
      completed: false,
      wait_completed: false,
    });
  });

  it("leaves the tempo out when it is unknown or out of range", () => {
    expect(lessonResult(score, { ...scored, songBpm: 0 })?.bpm).toBeUndefined();
    expect(
      lessonResult(score, { ...scored, songBpm: MAX_PASS_BPM, rate: 1.5 })?.bpm,
    ).toBeUndefined();
    expect(lessonResult(score, { ...scored, songBpm: MAX_PASS_BPM, rate: 1 })?.bpm).toBe(
      MAX_PASS_BPM,
    );
  });

  it("keeps the score inside 0 to 100", () => {
    expect(lessonResult(score, { ...scored, accuracy: 100.04 })?.score).toBe(100);
    expect(lessonResult(score, { ...scored, accuracy: -1 })?.score).toBe(0);
  });

  it("does not report a run of part of the song", () => {
    expect(lessonResult(score, { ...scored, wholeSong: false })).toBeNull();
  });

  it("reports a finished wait run to a wait lesson only", () => {
    expect(lessonResult(wait, { kind: "wait" })).toEqual({
      wait_completed: true,
      completed: false,
    });
    expect(lessonResult(score, { kind: "wait" })).toBeNull();
    expect(lessonResult(wait, scored)).toBeNull();
  });

  it("reports nothing for a lesson with no pass condition or one checked against a song", () => {
    expect(lessonResult(null, scored)).toBeNull();
    expect(lessonResult({ type: "score", song: "abc" }, scored)).toBeNull();
    expect(lessonResult({ type: "wait", song: "abc" }, { kind: "wait" })).toBeNull();
  });
});

describe("withLesson", () => {
  const ref = { course: "a", lesson: "b" };

  it("attaches the lesson to a song page and leaves other paths alone", () => {
    expect(withLesson("/songs/abc", ref)).toBe("/songs/abc?lesson=a/b");
    expect(withLesson("/songs/abc/edit", ref)).toBe("/songs/abc/edit");
    expect(withLesson("/lessons/a/b", ref)).toBe("/lessons/a/b");
  });
});

describe("the remembered song", () => {
  const ref = { course: "a", lesson: "b" };

  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is kept per user and per lesson", () => {
    rememberLessonSong("u1", ref, "s1");
    expect(recallLessonSong("u1", ref)).toBe("s1");
    expect(recallLessonSong("u2", ref)).toBe("");
    expect(recallLessonSong("u1", { course: "a", lesson: "c" })).toBe("");
    expect(recallLessonSong(null, ref)).toBe("");
  });

  it("is forgotten when the pick is cleared", () => {
    rememberLessonSong("u1", ref, "s1");
    rememberLessonSong("u1", ref, "");
    expect(recallLessonSong("u1", ref)).toBe("");
  });

  it("copes with storage that throws", () => {
    const fail = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", { getItem: fail, setItem: fail, removeItem: fail });
    expect(recallLessonSong("u1", ref)).toBe("");
    expect(() => rememberLessonSong("u1", ref, "s1")).not.toThrow();
  });
});
