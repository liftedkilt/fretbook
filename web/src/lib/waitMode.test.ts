import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { PitchEvent } from "./listen";
import { runEngine } from "./listen/harness/evaluate";
import { decodeWav } from "./listen/harness/wav";
import type { Beat, Note, ScoreDocument } from "./types";
import {
  WaitController,
  barStartTicks,
  buildSteps,
  defaultWaitOptions,
  loadWaitOptions,
  parseWaitOptions,
  saveWaitOptions,
  notePitch,
  pitchMatches,
  type WaitHost,
  type WaitState,
  type WaitStep,
} from "./waitMode";

const QUARTER = 960;

function beat(position: number, notes: Partial<Note>[], extra: Partial<Beat> = {}): Beat {
  return {
    position,
    duration: QUARTER,
    notes: notes.map((note) => ({ string: 3, fret: 0, ...note })),
    ...extra,
  };
}

function doc(bars: Beat[][], extra: { capo?: number; barFields?: object[] } = {}): ScoreDocument {
  return {
    version: 1,
    bpm: 120,
    bars: bars.map((_, index) => ({ signature: [4, 4], ...(extra.barFields?.[index] ?? {}) })),
    tracks: [
      {
        id: "t",
        name: "Bass",
        instrument: "bass",
        capo: extra.capo ?? 0,
        // Highest string first: G D A E.
        tuning_midi: [43, 38, 33, 28],
        preferred: true,
        bars: bars.map((beats) => ({ voices: [{ beats }] })),
      },
    ],
    sync: { video_id: null, points: [], anchors: {} },
  } as ScoreDocument;
}

describe("buildSteps", () => {
  it("maps string, fret and capo to MIDI pitches and ticks", () => {
    const score = doc(
      [
        [beat(0, [{ string: 3, fret: 0 }]), beat(QUARTER, [{ string: 2, fret: 5 }])],
        [beat(0, [{ string: 0, fret: 3 }])],
      ],
      { capo: 2 },
    );
    const steps = buildSteps(score, "t");
    expect(steps.map((step) => step.pitches)).toEqual([[30], [40], [48]]);
    expect(steps.map((step) => step.tick)).toEqual([0, QUARTER, 4 * QUARTER]);
    expect(steps.map((step) => step.bar)).toEqual([0, 0, 1]);
    expect(notePitch([40], 0, 0, 5)).toBe(45);
    expect(notePitch([], 0, 2, 1)).toBe(1);
  });

  it("skips rests, tied notes, grace notes and unknown tracks", () => {
    const score = doc([
      [
        beat(0, [{ fret: 0 }]),
        beat(QUARTER, []),
        beat(2 * QUARTER, [{ fret: 0, tie: true }]),
        beat(3 * QUARTER, [{ fret: 2 }], { grace: "before_beat" }),
      ],
    ]);
    expect(buildSteps(score, "t")).toHaveLength(1);
    expect(buildSteps(score, "nope")).toEqual([]);
  });

  it("accepts any attack for a dead note and any chord tone for a chord", () => {
    const score = doc([
      [
        beat(0, [{ fret: 3, dead: true }]),
        beat(QUARTER, [
          { string: 3, fret: 5 },
          { string: 2, fret: 5 },
          { string: 1, fret: 5 },
        ]),
        beat(2 * QUARTER, [
          { string: 2, fret: 0, tie: true },
          { string: 3, fret: 1 },
        ]),
      ],
    ]);
    const steps = buildSteps(score, "t");
    expect(steps[0].pitches).toEqual([]);
    expect(steps[1].pitches).toEqual([33, 38, 43]);
    expect(steps[1]).toMatchObject({ string: 3, fret: 5 });
    expect(steps[2].pitches).toEqual([29]);
  });

  it("follows repeats in played order", () => {
    const score = doc([[beat(0, [{ fret: 0 }])], [beat(0, [{ fret: 2 }])]], {
      barFields: [{ repeat_start: true }, { repeat_end: 2 }],
    });
    const steps = buildSteps(score, "t");
    expect(steps.map((step) => step.pitches[0])).toEqual([28, 30, 28, 30]);
    expect(steps.map((step) => step.tick)).toEqual([0, 4 * QUARTER, 8 * QUARTER, 12 * QUARTER]);
    expect(barStartTicks(score)).toEqual([0, 4, 8, 12, 16].map((n) => n * QUARTER));
  });
});

describe("wait options", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps valid stored fields and defaults the rest", () => {
    expect(parseWaitOptions(null)).toEqual(defaultWaitOptions());
    expect(
      parseWaitOptions({ octave: "exact", toleranceCents: 99, hintAfter: 8, backing: false }),
    ).toEqual({ octave: "exact", toleranceCents: 50, hintAfter: 8, backing: false });
    expect(parseWaitOptions({ octave: "x", hintAfter: 3, backing: "no" })).toEqual(
      defaultWaitOptions(),
    );
  });

  it("round-trips through local storage", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
    const options = { ...defaultWaitOptions(), octave: "exact" as const, hintAfter: 15 };
    saveWaitOptions(options);
    expect(loadWaitOptions()).toEqual(options);
    store.set("fretbook.wait", "{not json");
    expect(loadWaitOptions()).toEqual(defaultWaitOptions());
    vi.unstubAllGlobals();
    // No storage at all (private mode, or a test): defaults, and saving does not throw.
    expect(loadWaitOptions()).toEqual(defaultWaitOptions());
    expect(() => saveWaitOptions(options)).not.toThrow();
  });
});

describe("pitchMatches", () => {
  const options = { octave: "any" as const, toleranceCents: 45 };
  it("folds octaves unless asked for the exact one", () => {
    expect(pitchMatches({ midi: 40, cents: 5 }, 28, options)).toBe(true);
    expect(pitchMatches({ midi: 40, cents: 5 }, 28, { ...options, octave: "exact" })).toBe(false);
    expect(pitchMatches({ midi: 28, cents: -10 }, 28, { ...options, octave: "exact" })).toBe(true);
  });
  it("rejects other notes and out of tune readings", () => {
    expect(pitchMatches({ midi: 29, cents: 0 }, 28, options)).toBe(false);
    expect(pitchMatches({ midi: 28, cents: 49 }, 28, { ...options, toleranceCents: 20 })).toBe(
      false,
    );
    expect(pitchMatches({ midi: 27, cents: 40 }, 28, options)).toBe(false);
  });
});

/** Records what the controller asks of the synth, with a clock the test can move. */
class FakeHost implements WaitHost {
  calls: string[] = [];
  expected: (number | null)[] = [];
  states: WaitState[] = [];
  wall = 0;
  pause() {
    this.calls.push("pause");
  }
  play() {
    this.calls.push("play");
  }
  seek(tick: number) {
    this.calls.push(`seek ${tick}`);
  }
  expect(midi: number | null) {
    this.expected.push(midi);
  }
  changed(state: WaitState) {
    this.states.push(state);
  }
  now() {
    return this.wall;
  }
}

function step(tick: number, pitches: number[], bar = 0): WaitStep {
  return { tick, bar, pitches, string: 3, fret: 0 };
}

/** A pluck: an onset event, then steady readings of the note for a while. */
function pluck(time: number, midi: number | null, cents = 0, readings = 4): PitchEvent[] {
  const events: PitchEvent[] = [];
  for (let i = 0; i < readings; i++) {
    const at = time + i * 0.02;
    events.push({
      time: at,
      frequency: midi === null ? null : 440,
      clarity: 0.95,
      midi,
      cents: midi === null ? null : cents,
      onset: i === 0,
      onsetTime: i === 0 ? time - 0.01 : null,
    });
  }
  return events;
}

function silence(time: number): PitchEvent {
  return {
    time,
    frequency: null,
    clarity: 0,
    midi: null,
    cents: null,
    onset: false,
    onsetTime: null,
  };
}

function feed(controller: WaitController, events: PitchEvent[]) {
  for (const event of events) controller.onPitch(event);
}

describe("WaitController", () => {
  const steps = [step(0, [28]), step(960, [33]), step(1920, [28]), step(2880, [])];

  function begin(from = 0, range: { start: number; end: number } | null = null) {
    const host = new FakeHost();
    const controller = new WaitController(host, defaultWaitOptions());
    controller.start(steps, from, range);
    controller.setRunning(true);
    return { host, controller };
  }

  it("pauses at the beat and resumes when the right note is played", () => {
    const { host, controller } = begin();
    feed(controller, [silence(1)]);
    controller.onTick(0);
    expect(host.calls).toEqual(["pause", "seek 0"]);
    expect(controller.state.phase).toBe("waiting");
    feed(controller, [silence(1.2), ...pluck(1.4, 28)]);
    expect(host.calls).toEqual(["pause", "seek 0", "play"]);
    expect(controller.state).toMatchObject({ phase: "playing", index: 1, hits: 1 });
    expect(host.expected.at(-1)).toBe(33);
  });

  it("waits through wrong notes, then accepts the right one in another octave", () => {
    const { host, controller } = begin();
    feed(controller, [silence(1)]);
    controller.onTick(0);
    feed(controller, pluck(1.2, 30));
    feed(controller, pluck(1.6, 29, 20));
    expect(controller.state).toMatchObject({ phase: "waiting", index: 0 });
    feed(controller, pluck(2.0, 40));
    expect(controller.state).toMatchObject({ phase: "playing", index: 1 });
    expect(host.calls.at(-1)).toBe("play");
  });

  it("is strict about the octave when configured", () => {
    const { controller } = begin();
    controller.setOptions({ ...defaultWaitOptions(), octave: "exact" });
    feed(controller, [silence(1)]);
    controller.onTick(0);
    feed(controller, pluck(1.2, 40));
    expect(controller.state.phase).toBe("waiting");
    feed(controller, pluck(1.8, 28));
    expect(controller.state.phase).toBe("playing");
  });

  it("does not pause when the note was played just before the cursor got there", () => {
    const { host, controller } = begin();
    feed(controller, [...pluck(1.0, 28), silence(1.1)]);
    controller.onTick(0);
    expect(host.calls).toEqual([]);
    expect(controller.state).toMatchObject({ phase: "playing", index: 1, hits: 1 });
  });

  it("ignores an attack that came long before the beat", () => {
    const { host, controller } = begin();
    feed(controller, [...pluck(0.2, 28), silence(1.0), silence(1.1)]);
    controller.onTick(0);
    expect(host.calls).toEqual(["pause", "seek 0"]);
  });

  it("needs a fresh attack for each note, even when the pitch repeats", () => {
    const { controller } = begin();
    controller.start([step(0, [28]), step(960, [28])], 0);
    controller.setRunning(true);
    feed(controller, [silence(1)]);
    controller.onTick(0);
    feed(controller, pluck(1.2, 28, 0, 10));
    expect(controller.state.index).toBe(1);
    controller.onTick(960);
    expect(controller.state).toMatchObject({ phase: "waiting", index: 1 });
    // The ring of the first note does not count.
    feed(controller, [silence(1.5), silence(1.6)]);
    expect(controller.state.phase).toBe("waiting");
    feed(controller, pluck(1.8, 28));
    expect(controller.state.phase).toBe("done");
  });

  it("accepts any attack for a dead note", () => {
    const { controller } = begin(2880);
    feed(controller, [silence(1)]);
    controller.onTick(2880);
    expect(controller.state.phase).toBe("waiting");
    feed(controller, [{ ...silence(1.5), onset: true, onsetTime: 1.49 }, silence(1.6)]);
    expect(controller.state.phase).toBe("done");
  });

  it("shows the hint after the configured time and skips on request", () => {
    const { host, controller } = begin();
    controller.onTick(0);
    controller.poll();
    expect(controller.state.hint).toBe(false);
    host.wall = 4000;
    controller.poll();
    expect(controller.state.hint).toBe(true);
    controller.skip();
    expect(controller.state).toMatchObject({ phase: "playing", index: 1, hint: false, hits: 0 });
    expect(host.calls.at(-1)).toBe("play");
  });

  it("finishes after the last note and stops the synth", () => {
    const { host, controller } = begin(2880);
    controller.onTick(2880);
    controller.skip();
    expect(controller.state.phase).toBe("done");
    expect(controller.state.step).toBeNull();
    expect(host.calls.at(-1)).toBe("pause");
    expect(host.expected.at(-1)).toBeNull();
    controller.onTick(3000);
    controller.stop();
    expect(controller.state.phase).toBe("idle");
  });

  it("starts from any bar and follows a jump of the cursor", () => {
    const { host, controller } = begin(1500);
    expect(controller.state).toMatchObject({ index: 2, phase: "playing" });
    controller.onTick(1900);
    controller.onTick(1925);
    expect(controller.state.phase).toBe("waiting");
    expect(host.calls).toContain("seek 1920");
    // Seek events report old positions and are ignored.
    controller.onTick(0, true);
    expect(controller.state).toMatchObject({ phase: "waiting", index: 2 });
    // The player skips on, then clicks back to the start of the song.
    controller.skip();
    controller.onTick(2000);
    controller.onTick(10);
    expect(controller.state).toMatchObject({ phase: "waiting", index: 0 });
    // A long leap forward lands on the notes there.
    controller.skip();
    controller.onTick(100);
    controller.onTick(2100);
    expect(controller.state).toMatchObject({ phase: "playing", index: 3 });
  });

  it("wraps around a loop range", () => {
    const { host, controller } = begin(0, { start: 0, end: 1920 });
    feed(controller, [silence(1)]);
    controller.onTick(0);
    feed(controller, pluck(1.2, 28));
    controller.onTick(960);
    feed(controller, pluck(1.8, 33));
    expect(controller.state).toMatchObject({ phase: "playing", index: 0 });
    expect(host.calls.slice(-2)).toEqual(["seek 0", "play"]);
    // A jump from outside the loop lands at its start.
    controller.reposition(5000);
    expect(controller.state.index).toBe(0);
  });

  it("does not wait while the synth is stopped", () => {
    const { host, controller } = begin();
    controller.setRunning(false);
    controller.onTick(0);
    expect(host.calls).toEqual([]);
    expect(controller.state.phase).toBe("playing");
  });

  it("ignores events when idle or done, and keeps going on an empty track", () => {
    const host = new FakeHost();
    const controller = new WaitController(host);
    controller.onTick(0);
    controller.onPitch(silence(1));
    controller.skip();
    controller.poll();
    controller.start([], 0);
    expect(controller.state.phase).toBe("done");
    controller.retarget(steps, 0);
    expect(controller.state.phase).toBe("playing");
  });
});

describe("with the pitch engine on a recording", () => {
  const dir = new URL("./listen/fixtures/", import.meta.url);
  const wav = decodeWav(readFileSync(fileURLToPath(new URL("bass-riff.wav", dir))));
  const truth = JSON.parse(readFileSync(fileURLToPath(new URL("bass-riff.json", dir)), "utf8")) as {
    notes: { midi: number; start: number }[];
  };

  it("hits every note of the riff in order, as if the player were playing it", () => {
    const steps = truth.notes.map((note, i) => step(i * 960, [note.midi], i));
    const host = new FakeHost();
    const controller = new WaitController(host);
    controller.start(steps, 0);
    controller.setRunning(true);
    const events = runEngine(wav.samples, wav.sampleRate);
    // A synth that runs at the written tempo: the cursor reaches note i at its true start time.
    let next = 0;
    for (const event of events) {
      controller.onPitch(event);
      while (next < truth.notes.length && truth.notes[next].start <= event.time) {
        controller.onTick(next * 960);
        next += 1;
      }
    }
    expect(controller.state.hits).toBe(truth.notes.length);
    expect(controller.state.phase).toBe("done");
  }, 30_000);

  it("stays on the first note when the player plays another one", () => {
    const steps = [step(0, [truth.notes[0].midi + 2])];
    const controller = new WaitController(new FakeHost());
    controller.start(steps, 0);
    controller.setRunning(true);
    const events = runEngine(wav.samples, wav.sampleRate);
    controller.onTick(0);
    for (const event of events) controller.onPitch(event);
    expect(controller.state.phase).toBe("waiting");
  }, 30_000);
});
