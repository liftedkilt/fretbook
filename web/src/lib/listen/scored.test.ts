import { describe, expect, it } from "vitest";

import type { ScoreDocument } from "../types";
import type { PitchEvent } from "./engine";
import {
  Scorer,
  barAccuracy,
  bleedSuspected,
  buildScoredSteps,
  sectionScores,
  starsFor,
  weakestSpan,
  type ScoredStep,
} from "./scored";

const step = (time: number, midi: number | null, bar = 0): ScoredStep => ({
  bar,
  position: 0,
  tick: 0,
  time,
  kind: midi === null ? "dead" : "note",
  midis: midi === null ? [] : [midi],
  string: 3,
  fret: 0,
});

const identity = (time: number) => time;

/** An attack at `at` whose pitch settles on `midi` right away. */
const attack = (at: number, midi: number | null): PitchEvent => ({
  time: at + 0.03,
  frequency: midi === null ? null : 100,
  clarity: 0.95,
  midi,
  cents: midi === null ? null : 0,
  onset: true,
  onsetTime: at,
});

const reading = (time: number, midi: number | null, cents = 0): PitchEvent => ({
  time,
  frequency: midi === null ? null : 100,
  clarity: 0.9,
  midi,
  cents: midi === null ? null : cents,
  onset: false,
  onsetTime: null,
});

const scorer = (steps: ScoredStep[], to = 10) => new Scorer(steps, 2, { from: 0, to });

describe("Scorer", () => {
  it("grades an attack by how far it is from the due time", () => {
    const s = scorer([step(1, 40), step(2, 41), step(3, 42), step(4, 43)]);
    s.push(attack(1.05, 40), identity);
    s.push(attack(1.8, 41), identity); // 0.2 early
    s.push(attack(3.2, 42), identity); // 0.2 late
    s.push(attack(3.95, 43), identity);
    expect(s.stepGrades).toEqual(["hit", "early", "late", "hit"]);
    expect(s.summary().counts).toMatchObject({ hit: 2, early: 1, late: 1 });
  });

  it("treats the hit window edge as a hit and just beyond it as early or late", () => {
    const s = scorer([step(1, 40), step(2, 40)]);
    s.push(attack(1.1, 40), identity);
    s.push(attack(2.1001, 40), identity);
    expect(s.stepGrades).toEqual(["hit", "late"]);
  });

  it("marks right timing with the wrong pitch as wrong once the pitch has settled", () => {
    const s = scorer([step(1, 40)]);
    s.push(attack(1, 45), identity);
    expect(s.stepGrades).toEqual([null]);
    s.advance(1.5);
    expect(s.stepGrades).toEqual(["wrong"]);
  });

  it("accepts the right note in another octave by default, not when that is off", () => {
    const any = scorer([step(1, 40)]);
    any.push(attack(1, 52), identity);
    expect(any.stepGrades).toEqual(["hit"]);
    const strict = new Scorer(
      [step(1, 40)],
      1,
      { from: 0, to: 10 },
      {
        hitWindow: 0.1,
        outerWindow: 0.3,
        centsTolerance: 40,
        settleSeconds: 0.3,
        anyOctave: false,
      },
    );
    strict.push(attack(1, 52), identity);
    strict.advance(2);
    expect(strict.stepGrades).toEqual(["wrong"]);
  });

  it("waits for a pitch within the tolerance before accepting an attack", () => {
    const s = scorer([step(1, 40)]);
    s.push(attack(1, null), identity);
    s.push(reading(1.1, 40, 80), identity);
    expect(s.stepGrades).toEqual([null]);
    s.push(reading(1.15, 40, 10), identity);
    expect(s.stepGrades).toEqual(["hit"]);
  });

  it("marks notes nobody played as missed once the window has gone by", () => {
    const s = scorer([step(1, 40), step(2, 41)]);
    s.advance(1.25);
    expect(s.stepGrades).toEqual([null, null]);
    s.advance(1.31);
    expect(s.stepGrades).toEqual(["missed", null]);
    expect(s.summary().accuracy).toBe(0);
  });

  it("counts attacks that match nothing as extras without lowering the score", () => {
    const s = scorer([step(1, 40)]);
    s.push(attack(0.2, 40), identity);
    s.push(attack(1, 40), identity);
    const summary = s.summary();
    expect(summary.extras).toBe(1);
    expect(summary.accuracy).toBe(1);
  });

  it("counts an unpitched noise at a note's time as an extra, and the note as missed", () => {
    const s = scorer([step(1, 40)]);
    s.push(attack(1, null), identity);
    expect(s.stepGrades).toEqual([null]);
    s.advance(1.4);
    expect(s.summary().extras).toBe(1);
    expect(s.stepGrades).toEqual(["missed"]);
  });

  it("uses each attack once: a single pluck cannot satisfy two close notes", () => {
    const s = scorer([step(1, 40), step(1.2, 40)]);
    s.push(attack(1.1, 40), identity);
    expect(s.stepGrades.filter((grade) => grade === "hit")).toHaveLength(1);
    s.advance(2);
    expect(s.stepGrades.filter((grade) => grade === "missed")).toHaveLength(1);
  });

  it("keeps the notes after a wrong attack open for their own attacks", () => {
    const s = scorer([step(1, 40), step(1.2, 40), step(1.4, 40), step(2, 40)]);
    s.push(attack(1, 45), identity);
    s.push(attack(1.2, 40), identity);
    expect(s.stepGrades.slice(0, 2)).toEqual(["wrong", "hit"]);
    s.push(attack(1.4, 40), identity);
    expect(s.stepGrades.slice(0, 3)).toEqual(["wrong", "hit", "hit"]);
    expect(s.stepGrades[3]).toBeNull();
  });

  it("does the same when the pitch of the first attack arrives after the next onset", () => {
    const s = scorer([step(1, 40), step(1.2, 40), step(2, 40)]);
    s.push(attack(1, null), identity);
    s.push(attack(1.2, 40), identity);
    expect(s.stepGrades).toEqual([null, "hit", null]);
    expect(s.summary().extras).toBe(1);
  });

  it("lets a dead note accept any attack", () => {
    const s = scorer([step(1, null)]);
    s.push(attack(1.02, null), identity);
    expect(s.stepGrades).toEqual(["hit"]);
  });

  it("accepts any one note of a chord", () => {
    const chord: ScoredStep = { ...step(1, 40), midis: [40, 47, 52] };
    const s = scorer([chord]);
    s.push(attack(1, 47), identity);
    expect(s.stepGrades).toEqual(["hit"]);
  });

  it("keeps a streak over right notes and resets it on a miss", () => {
    const s = scorer([step(1, 40), step(2, 40), step(3, 40), step(4, 40)]);
    s.push(attack(1, 40), identity);
    s.push(attack(2, 40), identity);
    expect(s.summary().streak).toBe(2);
    s.advance(3.5);
    expect(s.summary().streak).toBe(0);
    s.push(attack(4, 40), identity);
    const summary = s.summary();
    expect(summary.streak).toBe(1);
    expect(summary.bestStreak).toBe(2);
  });

  it("only scores the notes inside the pass", () => {
    const s = new Scorer([step(1, 40), step(5, 40), step(9, 40)], 1, { from: 4, to: 6 });
    s.advance(20);
    expect(s.stepGrades).toEqual([null, "missed", null]);
    expect(s.summary().total).toBe(1);
    // An attack long before the pass is not an extra.
    s.push(attack(1, 40), identity);
    expect(s.summary().extras).toBe(0);
  });

  it("finish closes every open note and reports completeness", () => {
    const s = scorer([step(1, 40), step(2, 40)]);
    s.push(attack(1, 40), identity);
    expect(s.complete).toBe(false);
    s.finish();
    expect(s.complete).toBe(true);
    expect(s.stepGrades).toEqual(["hit", "missed"]);
  });

  it("shifts times through the conversion function", () => {
    const s = scorer([step(10, 40)]);
    // Microphone clock runs 100 s behind the song clock.
    s.push(attack(-90.02, 40), (time) => time + 100);
    expect(s.stepGrades).toEqual(["hit"]);
  });

  it("scores per bar", () => {
    const s = scorer([step(1, 40, 0), step(2, 40, 1), step(3, 40, 1)]);
    s.push(attack(1, 40), identity);
    s.push(attack(2, 40), identity);
    s.advance(10);
    const bars = s.summary().bars;
    expect(barAccuracy(bars[0])).toBe(1);
    expect(barAccuracy(bars[1])).toBe(0.5);
    expect(barAccuracy(null)).toBeNull();
  });

  it("tracks attacks far from any note for the bleed check", () => {
    const s = scorer([step(1, 40), step(8, 40)]);
    for (const at of [3, 4, 5, 6]) s.push(attack(at, 40), identity);
    expect(s.restAttacks).toBe(4);
    expect(s.attacks).toBe(4);
    expect(bleedSuspected(s.restAttacks, s.attacks)).toBe(true);
    expect(bleedSuspected(3, 3)).toBe(false);
    expect(bleedSuspected(4, 20)).toBe(false);
  });
});

describe("starsFor", () => {
  it("maps accuracy to one to three stars, and none when nothing was graded", () => {
    expect(starsFor(0.95, 10)).toBe(3);
    expect(starsFor(0.9, 10)).toBe(3);
    expect(starsFor(0.8, 10)).toBe(2);
    expect(starsFor(0.5, 10)).toBe(1);
    expect(starsFor(0.2, 10)).toBe(0);
    expect(starsFor(1, 0)).toBe(0);
  });
});

const document = (sections: (string | null)[]): ScoreDocument =>
  ({
    bars: sections.map((section) => ({
      signature: [4, 4],
      section,
    })),
    tracks: [],
    bpm: 120,
    sync: { points: [], anchors: {} },
  }) as unknown as ScoreDocument;

describe("sectionScores", () => {
  it("groups played bars under the last named section and skips bars without notes", () => {
    const doc = document(["Intro", null, "Verse", null, null]);
    const bars = [
      { credit: 1, total: 2 },
      { credit: 2, total: 2 },
      null,
      { credit: 0, total: 4 },
      null,
    ];
    expect(sectionScores(doc, bars)).toEqual([
      { name: "Intro", from: 0, to: 1, accuracy: 0.75, total: 4 },
      { name: "Verse", from: 2, to: 4, accuracy: 0, total: 4 },
    ]);
  });

  it("puts bars before the first name in an unnamed section", () => {
    const doc = document([null, "Chorus"]);
    const result = sectionScores(doc, [
      { credit: 1, total: 1 },
      { credit: 1, total: 2 },
    ]);
    expect(result.map((section) => section.name)).toEqual([null, "Chorus"]);
  });
});

describe("buildScoredSteps", () => {
  it("returns an empty list for a track with no notes", () => {
    const doc = {
      ...document([null]),
      tracks: [{ id: "t", tuning_midi: [40], capo: 0, bars: [{ voices: [] }] }],
    } as unknown as ScoreDocument;
    expect(buildScoredSteps(doc, doc.tracks[0], false)).toEqual([]);
  });
});

describe("weakestSpan", () => {
  it("finds the run of bars that lost the most, clipped at the end", () => {
    const bars = [
      { credit: 2, total: 2 },
      { credit: 0, total: 2 },
      { credit: 1, total: 2 },
      null,
      { credit: 2, total: 2 },
    ];
    expect(weakestSpan(bars, 2)).toEqual({ from: 1, to: 2 });
    expect(weakestSpan(bars, 10)).toEqual({ from: 0, to: 4 });
  });

  it("returns null when nothing was lost", () => {
    expect(weakestSpan([{ credit: 1, total: 1 }, null])).toBeNull();
    expect(weakestSpan([])).toBeNull();
  });
});
