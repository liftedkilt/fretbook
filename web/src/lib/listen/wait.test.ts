import { describe, expect, it } from "vitest";

import type { Beat, Note, ScoreDocument } from "../types";
import type { PitchEvent } from "./engine";
import { runEngine } from "./harness/evaluate";
import { renderNotes } from "./harness/synth";
import {
  buildWaitSteps,
  DEFAULT_WAIT_OPTIONS,
  pitchMatches,
  stepIndexAt,
  WaitMatcher,
  type WaitStep,
} from "./wait";

const WHOLE = 3840;

function beat(position: number, notes: Partial<Note>[], extra: Partial<Beat> = {}): Beat {
  return {
    position,
    duration: 960,
    notes: notes.map((note) => ({ string: 0, fret: 0, ...note })),
    ...extra,
  };
}

function documentWith(
  bars: Beat[][][],
  options: { capo?: number; repeat?: boolean } = {},
): ScoreDocument {
  return {
    version: 1,
    bpm: 120,
    bars: bars.map((_, index) => ({
      signature: [4, 4],
      repeat_start: options.repeat && index === 0,
      repeat_end: options.repeat && index === bars.length - 1 ? 2 : 0,
    })),
    tracks: [
      {
        id: "bass",
        name: "Bass",
        instrument: "bass",
        capo: options.capo ?? 0,
        // G D A E, highest string first.
        tuning_midi: [43, 38, 33, 28],
        preferred: true,
        bars: bars.map((voices) => ({ voices: voices.map((beats) => ({ beats })) })),
      },
    ],
    sync: { video_id: null, points: [], anchors: {} },
  };
}

function steps(doc: ScoreDocument): WaitStep[] {
  return buildWaitSteps(doc, doc.tracks[0]);
}

describe("buildWaitSteps", () => {
  it("turns string, fret and capo into pitches, one step per played beat", () => {
    const doc = documentWith(
      [[[beat(0, [{ string: 3, fret: 0 }]), beat(960, [{ string: 2, fret: 2 }])]]],
      {
        capo: 2,
      },
    );
    const result = steps(doc);
    expect(result.map((step) => step.midis)).toEqual([[30], [37]]);
    expect(result.map((step) => step.tick)).toEqual([0, 960]);
  });

  it("skips rests, tied notes and grace notes, and keeps dead notes", () => {
    const doc = documentWith([
      [
        [
          beat(0, []),
          beat(960, [{ string: 3, fret: 3, tie: true }]),
          beat(1440, [{ string: 3, fret: 5 }], { grace: "before_beat" }),
          beat(1920, [{ string: 3, fret: 0, dead: true }]),
          beat(2880, [{ string: 3, fret: 3 }]),
        ],
      ],
    ]);
    const result = steps(doc);
    expect(result.map((step) => [step.kind, step.position])).toEqual([
      ["dead", 1920],
      ["note", 2880],
    ]);
    expect(result[0].midis).toEqual([]);
  });

  it("merges voices that land on the same beat", () => {
    const doc = documentWith([
      [
        [beat(0, [{ string: 3, fret: 0, dead: true }])],
        [beat(0, [{ string: 2, fret: 0 }]), beat(960, [{ string: 1, fret: 0 }])],
      ],
    ]);
    const result = steps(doc);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ kind: "note", midis: [33], position: 0 });
  });

  it("walks the bars as they are played, repeats included", () => {
    const doc = documentWith(
      [[[beat(0, [{ string: 3, fret: 0 }])]], [[beat(0, [{ string: 3, fret: 1 }])]]],
      { repeat: true },
    );
    const result = steps(doc);
    expect(result.map((step) => [step.bar, step.tick, step.midis[0]])).toEqual([
      [0, 0, 28],
      [1, WHOLE, 29],
      [2, 2 * WHOLE, 28],
      [3, 3 * WHOLE, 29],
    ]);
  });

  it("finds a step by its played bar and position", () => {
    const doc = documentWith([
      [[beat(0, [{ fret: 1 }]), beat(960, [{ fret: 2 }])]],
      [[beat(1920, [{ fret: 3 }])]],
    ]);
    const result = steps(doc);
    expect(stepIndexAt(result, 0, 960)).toBe(1);
    expect(stepIndexAt(result, 1, 1920)).toBe(2);
    expect(stepIndexAt(result, 1, 0)).toBe(-1);
    expect(stepIndexAt(result, 5, 0)).toBe(-1);
  });
});

describe("pitchMatches", () => {
  it("accepts any octave unless told to be exact", () => {
    expect(pitchMatches(40, 28, true)).toBe(true);
    expect(pitchMatches(16, 28, true)).toBe(true);
    expect(pitchMatches(41, 28, true)).toBe(false);
    expect(pitchMatches(40, 28, false)).toBe(false);
    expect(pitchMatches(28, 28, false)).toBe(true);
  });
});

function event(time: number, midi: number | null, extra: Partial<PitchEvent> = {}): PitchEvent {
  return {
    time,
    frequency: midi === null ? null : 440,
    clarity: midi === null ? 0 : 0.95,
    midi,
    cents: midi === null ? null : 0,
    onset: false,
    onsetTime: null,
    ...extra,
  };
}

const note = (midi: number): WaitStep => ({
  bar: 0,
  position: 0,
  tick: 0,
  kind: "note",
  midis: [midi],
  string: 3,
  fret: 0,
});

function feed(matcher: WaitMatcher, events: PitchEvent[]): number {
  return events.findIndex((item) => matcher.push(item));
}

describe("WaitMatcher", () => {
  it("waits for an attack and then the right pitch", () => {
    const matcher = new WaitMatcher();
    matcher.push(event(1, null));
    matcher.wait(note(28));
    const hit = feed(matcher, [
      event(1.02, null),
      event(1.04, 28),
      event(1.1, 28, { onset: true, onsetTime: 1.08 }),
      event(1.12, 28),
    ]);
    expect(hit).toBe(2);
  });

  it("ignores a sustained note without a new attack", () => {
    const matcher = new WaitMatcher();
    matcher.push(event(1, 28));
    matcher.wait(note(28));
    const events = Array.from({ length: 20 }, (_, i) => event(1.02 + i * 0.02, 28));
    expect(feed(matcher, events)).toBe(-1);
  });

  it("ignores an attack from before the cursor stopped, but not one a moment early", () => {
    const matcher = new WaitMatcher();
    matcher.push(event(5, 28));
    matcher.wait(note(28));
    expect(feed(matcher, [event(5.02, 28, { onset: true, onsetTime: 4.7 })])).toBe(-1);
    matcher.wait(note(28));
    expect(feed(matcher, [event(5.04, 28, { onset: true, onsetTime: 4.99 })])).toBe(0);
  });

  it("does not count the same attack for the next beat", () => {
    const matcher = new WaitMatcher();
    matcher.push(event(1, null));
    matcher.wait(note(28));
    expect(matcher.push(event(1.1, 28, { onset: true, onsetTime: 1.08 }))).toBe(true);
    matcher.wait(note(28));
    const ringing = Array.from({ length: 10 }, (_, i) => event(1.12 + i * 0.02, 28));
    expect(feed(matcher, ringing)).toBe(-1);
  });

  it("waits through wrong notes and counts them", () => {
    const matcher = new WaitMatcher();
    matcher.push(event(1, null));
    matcher.wait(note(28));
    const events = [
      event(1.1, 31, { onset: true, onsetTime: 1.08 }),
      event(1.2, 31),
      event(1.3, 31),
      event(1.45, 31),
      event(1.6, 31),
      event(2, 28, { onset: true, onsetTime: 1.98 }),
    ];
    expect(feed(matcher, events)).toBe(5);
    expect(matcher.wrong).toBe(1);
  });

  it("accepts the pitch settling after the attack", () => {
    const matcher = new WaitMatcher();
    matcher.push(event(1, null));
    matcher.wait(note(28));
    const events = [event(1.1, null, { onset: true, onsetTime: 1.08 }), event(1.14, 40)];
    expect(feed(matcher, events)).toBe(1);
  });

  it("is strict about the octave when asked, and about cents", () => {
    const strict = new WaitMatcher({
      ...DEFAULT_WAIT_OPTIONS,
      anyOctave: false,
      centsTolerance: 20,
    });
    strict.push(event(1, null));
    strict.wait(note(28));
    expect(strict.push(event(1.1, 40, { onset: true, onsetTime: 1.08 }))).toBe(false);
    strict.wait(note(28));
    expect(strict.push(event(2.1, 28, { onset: true, onsetTime: 2.08, cents: 35 }))).toBe(false);
    expect(strict.push(event(2.14, 28, { cents: -10 }))).toBe(true);
  });

  it("accepts any attack for a dead note, and any note of a chord", () => {
    const matcher = new WaitMatcher();
    matcher.push(event(1, null));
    matcher.wait({ ...note(0), kind: "dead", midis: [] });
    expect(matcher.push(event(1.1, null, { onset: true, onsetTime: 1.08 }))).toBe(true);
    matcher.wait({ ...note(28), midis: [28, 35] });
    expect(matcher.push(event(2, 35, { onset: true, onsetTime: 1.98 }))).toBe(true);
  });

  it("does nothing when it is not waiting", () => {
    const matcher = new WaitMatcher();
    expect(matcher.push(event(1, 28, { onset: true, onsetTime: 1 }))).toBe(false);
    expect(matcher.waiting).toBeNull();
  });
});

describe("WaitMatcher with the pitch engine", () => {
  const sampleRate = 48000;

  it("hears a rendered bass line step by step, and not the wrong note", () => {
    const line = [
      { midi: 28, start: 0.3, duration: 0.5 },
      { midi: 31, start: 1.0, duration: 0.5 },
      { midi: 33, start: 1.7, duration: 0.5 },
    ];
    const samples = renderNotes(line, 2.6, { sampleRate, instrument: "bass", seed: 4 });
    const expected = (time: number) => (time < 0.9 ? 28 : time < 1.6 ? 31 : 33);
    const events = runEngine(samples, sampleRate, 128, expected);

    const matcher = new WaitMatcher();
    // The player wants E1, then A1: the G1 in the middle is a wrong note.
    const wanted = [28, 33];
    let index = 0;
    matcher.wait(note(wanted[index]));
    const hitTimes: number[] = [];
    for (const item of events) {
      if (matcher.push(item)) {
        hitTimes.push(item.time);
        index += 1;
        if (index === wanted.length) break;
        matcher.wait(note(wanted[index]));
      }
    }
    expect(hitTimes).toHaveLength(2);
    expect(hitTimes[0]).toBeGreaterThan(0.3);
    expect(hitTimes[0]).toBeLessThan(0.7);
    expect(hitTimes[1]).toBeGreaterThan(1.7);
  });
});
