import { describe, expect, it } from "vitest";

import { chordPitchClasses, notePitchClass, pitchClassName } from "./chordTones";

const sorted = (name: string) =>
  chordPitchClasses(name)
    ?.slice()
    .sort((a, b) => a - b);

describe("notePitchClass", () => {
  it("reads sharps and flats", () => {
    expect(notePitchClass("C")).toBe(0);
    expect(notePitchClass("F#")).toBe(6);
    expect(notePitchClass("Bb")).toBe(10);
    expect(notePitchClass("E♭")).toBe(3);
    expect(notePitchClass("Cb")).toBe(11);
    expect(notePitchClass("H")).toBeNull();
    expect(notePitchClass("Am")).toBeNull();
  });

  it("names a pitch class", () => {
    expect(pitchClassName(0)).toBe("C");
    expect(pitchClassName(13)).toBe("C#");
    expect(pitchClassName(-1)).toBe("B");
  });
});

describe("chordPitchClasses", () => {
  it("spells triads", () => {
    expect(sorted("C")).toEqual([0, 4, 7]);
    expect(sorted("Am")).toEqual([0, 4, 9]);
    expect(sorted("F#m")).toEqual([1, 6, 9]);
    expect(sorted("Bdim")).toEqual([2, 5, 11]);
    expect(sorted("Caug")).toEqual([0, 4, 8]);
    expect(sorted("C+")).toEqual([0, 4, 8]);
    expect(sorted("Cmaj")).toEqual([0, 4, 7]);
  });

  it("lists the root first", () => {
    expect(chordPitchClasses("Am")?.[0]).toBe(9);
    expect(chordPitchClasses("Bb")?.[0]).toBe(10);
  });

  it("spells sevenths, sixths and ninths", () => {
    expect(sorted("G7")).toEqual([2, 5, 7, 11]);
    expect(sorted("Cmaj7")).toEqual([0, 4, 7, 11]);
    expect(sorted("CM7")).toEqual([0, 4, 7, 11]);
    expect(sorted("Am7")).toEqual([0, 4, 7, 9]);
    expect(sorted("Bm7b5")).toEqual([2, 5, 9, 11]);
    expect(sorted("Bø")).toEqual([2, 5, 9, 11]);
    expect(sorted("Cdim7")).toEqual([0, 3, 6, 9]);
    expect(sorted("C6")).toEqual([0, 4, 7, 9]);
    expect(sorted("C9")).toEqual([0, 2, 4, 7, 10]);
    expect(sorted("Cmaj9")).toEqual([0, 2, 4, 7, 11]);
    expect(sorted("Cadd9")).toEqual([0, 2, 4, 7]);
    expect(sorted("Cmmaj7")).toEqual([0, 3, 7, 11]);
  });

  it("spells suspended, power and altered chords", () => {
    expect(sorted("Dsus4")).toEqual([2, 7, 9]);
    expect(sorted("Dsus2")).toEqual([2, 4, 9]);
    expect(sorted("Dsus")).toEqual([2, 7, 9]);
    expect(sorted("D7sus4")).toEqual([0, 2, 7, 9]);
    expect(sorted("E5")).toEqual([4, 11]);
    expect(sorted("C7b9")).toEqual([0, 1, 4, 7, 10]);
    expect(sorted("C7(#5)")).toEqual([0, 4, 8, 10]);
  });

  it("adds the slash bass", () => {
    expect(sorted("C/G")).toEqual([0, 4, 7]);
    expect(sorted("C/B")).toEqual([0, 4, 7, 11]);
    expect(chordPitchClasses("C/B")?.at(-1)).toBe(11);
  });

  it("returns null for what is not a chord", () => {
    for (const name of ["N.C.", "%", "x", "", "Cfoo", "C/H", "C14"])
      expect(chordPitchClasses(name)).toBeNull();
  });
});
