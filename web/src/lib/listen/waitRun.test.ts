import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChromaEvent } from "./chroma";
import type { PitchEvent } from "./engine";
import type { ListenOptions, ListenSession } from "./input";
import type { WaitStep } from "./wait";
import { COMPLETE_HIT_SHARE, WaitRun } from "./waitRun";

const step = (tick: number, midi: number, kind: "note" | "dead" = "note"): WaitStep => ({
  bar: 0,
  position: tick,
  tick,
  kind,
  midis: kind === "dead" ? [] : [midi],
  string: 3,
  fret: 0,
});

const attack = (time: number, midi: number): PitchEvent => ({
  time,
  frequency: 100,
  clarity: 0.95,
  midi,
  cents: 0,
  onset: true,
  onsetTime: time - 0.02,
});

function setup(steps: WaitStep[], hintSeconds = 0, match?: { anyOctave: boolean }) {
  let options!: ListenOptions;
  const expected: (number | null)[] = [];
  const strict: (boolean | undefined)[] = [];
  const chroma: boolean[] = [];
  const stopped = vi.fn(async () => undefined);
  const session: ListenSession = {
    sampleRate: 48000,
    channelCount: 1,
    currentTime: 0,
    setChannel: () => undefined,
    setExpectedMidi: (midi, strictOctave) => {
      expected.push(midi);
      strict.push(strictOctave);
    },
    setChroma: (on) => chroma.push(on),
    stop: stopped,
  };
  const calls = {
    wait: [] as number[],
    hit: [] as number[],
    hint: [] as number[],
    hitFlags: [] as boolean[],
    heard: [] as string[],
  };
  const run = new WaitRun({
    steps,
    hintSeconds,
    match,
    listen: async (given) => {
      options = given;
      return session;
    },
    onWait: (_, index) => calls.wait.push(index),
    onHit: (_, index, hit) => {
      calls.hit.push(index);
      calls.hitFlags.push(hit);
    },
    onHeard: (heard) => calls.heard.push(heard.kind),
    onHint: (_, index) => calls.hint.push(index),
  });
  return {
    run,
    calls,
    expected,
    strict,
    chroma,
    stopped,
    hear: (event: PitchEvent) => options.onPitch(event),
    hearChroma: (event: ChromaEvent) => options.onChroma?.(event),
  };
}

describe("WaitRun", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("tells whether a step was played or skipped, and what was heard on the way", async () => {
    const { run, calls, hear } = setup([step(0, 40), step(960, 41)]);
    await run.start();
    run.reach(0);
    hear({ ...attack(1, 45), cents: 0, onsetTime: 1 });
    hear({ ...attack(1.5, 45), onset: false });
    expect(calls.heard).toEqual(["wrong"]);
    run.skip();
    expect(calls.hitFlags).toEqual([false]);
    expect(run.playedCount).toBe(0);
    run.reach(1);
    hear({ ...attack(3, 41), onsetTime: 3 });
    expect(calls.hitFlags).toEqual([false, true]);
    expect(run.playedCount).toBe(1);
    expect(run.wasPlayed(1)).toBe(true);
  });

  it("asks the detector for strict octaves only when any-octave is off", async () => {
    for (const [anyOctave, want] of [
      [false, true],
      [true, false],
    ] as const) {
      const { run, strict } = setup([step(0, 28)], 0, { anyOctave });
      await run.start();
      run.reach(0);
      expect(strict.at(-1)).toBe(want);
    }
  });

  it("follows a click on the score: drops the wait and stops on the clicked step", async () => {
    const { run, calls, expected } = setup([step(0, 28), step(960, 33), step(1920, 28)]);
    await run.start();
    run.reach(0);
    expect(run.reposition(1920)).toBe(true);
    expect(run.waitingOn).toBe(2);
    expect(calls.wait).toEqual([0, 2]);
    expect(expected.at(-1)).toBe(28);
    // Steps before the click are behind the cursor now.
    expect(run.reach(1)).toBe(false);
  });

  it("lets the song carry on from a click between steps, and stops on the next step", async () => {
    const { run, calls } = setup([step(0, 28), step(960, 33), step(1920, 28)]);
    await run.start();
    run.reach(0);
    expect(run.reposition(1000)).toBe(false);
    expect(run.waitingOn).toBe(-1);
    expect(run.reach(2)).toBe(true);
    expect(calls.wait).toEqual([0, 2]);
  });

  it("clicking the step it is already waiting on starts that wait again", async () => {
    const { run, calls } = setup([step(0, 28), step(960, 33)]);
    await run.start();
    run.reach(1);
    expect(run.reposition(960)).toBe(true);
    expect(calls.wait).toEqual([1, 1]);
  });

  it("stops on a step, tells the detector what to expect, and goes on after the note", async () => {
    const { run, calls, expected, hear } = setup([step(0, 28), step(960, 33)]);
    await run.start();
    hear({ ...attack(1, 0), onset: false, midi: null, frequency: null });
    expect(run.reach(0)).toBe(true);
    expect(calls.wait).toEqual([0]);
    expect(expected.at(-1)).toBe(28);
    hear(attack(1.1, 28));
    expect(calls.hit).toEqual([0]);
    expect(run.hits).toBe(1);
    expect(expected.at(-1)).toBeNull();
    expect(run.waitingOn).toBe(-1);
  });

  it("does not stop twice on a step it has passed, or while already waiting", async () => {
    const { run, hear } = setup([step(0, 28), step(960, 33)]);
    await run.start();
    expect(run.reach(0)).toBe(true);
    expect(run.reach(0)).toBe(false);
    hear(attack(1, 28));
    expect(run.reach(0)).toBe(false);
    expect(run.reach(1)).toBe(true);
    expect(run.reach(7)).toBe(false);
  });

  it("does nothing before the microphone is open", () => {
    const { run } = setup([step(0, 28)]);
    expect(run.reach(0)).toBe(false);
  });

  it("lets the player skip a beat, which is not a hit", async () => {
    const { run, calls } = setup([step(0, 28)]);
    await run.start();
    run.skip();
    expect(run.reach(0)).toBe(true);
    run.skip();
    expect(calls.hit).toEqual([0]);
    expect(run.hits).toBe(0);
  });

  it("shows the hint after the wait, and not once the note is played", async () => {
    const { run, calls, hear } = setup([step(0, 28), step(960, 33)], 5);
    await run.start();
    run.reach(0);
    vi.advanceTimersByTime(4900);
    expect(calls.hint).toEqual([]);
    vi.advanceTimersByTime(200);
    expect(calls.hint).toEqual([0]);
    run.reach(1);
    hear(attack(9, 33));
    vi.advanceTimersByTime(10000);
    expect(calls.hint).toEqual([0]);
  });

  it("starts again from a bar after a seek, and a dead note takes any attack", async () => {
    const { run, calls, hear } = setup([step(0, 28), step(960, 0, "dead"), step(1920, 33)]);
    await run.start();
    run.seek(960);
    expect(run.reach(0)).toBe(false);
    expect(run.reach(1)).toBe(true);
    hear({ ...attack(2, 40), midi: null });
    expect(calls.hit).toEqual([1]);
    run.seek(0);
    expect(run.reach(0)).toBe(true);
    run.seek(99999);
    expect(run.reach(2)).toBe(false);
  });

  it("closes the microphone when stopped", async () => {
    const { run, stopped } = setup([step(0, 28)]);
    await run.start();
    run.stop();
    expect(stopped).toHaveBeenCalledOnce();
    expect(run.reach(0)).toBe(false);
  });

  it("turns the chroma readings on for a chord and off again, and listens to them", async () => {
    const chord: WaitStep = {
      ...step(0, 0),
      kind: "chord",
      midis: [],
      pcs: [0, 4, 7],
    };
    const { run, calls, expected, chroma, hear, hearChroma } = setup([chord, step(960, 28)]);
    await run.start();
    // The clock reads 1 s when the cursor stops on the chord.
    hear({ ...attack(1, 48), onset: false, onsetTime: null });
    run.reach(0);
    expect(chroma.at(-1)).toBe(true);
    expect(expected.at(-1)).toBeNull();
    // A single pitch cannot complete a chord.
    hear(attack(1.1, 48));
    expect(calls.hit).toEqual([]);
    const bins = new Array(12).fill(0);
    for (const pc of [0, 4, 7]) bins[pc] = 1;
    hearChroma({ time: 0.5, bins, span: 0.17, onset: true, onsetTime: 0.3 });
    // The strum was before the cursor stopped, so it does not count; one after it does.
    expect(calls.hit).toEqual([]);
    hearChroma({ time: 1.5, bins, span: 0.17, onset: true, onsetTime: 1.2 });
    expect(calls.hit).toEqual([0]);
    expect(chroma.at(-1)).toBe(false);
    run.reach(1);
    expect(chroma.at(-1)).toBe(false);
    expect(expected.at(-1)).toBe(28);
  });

  describe("completed", () => {
    const five = () => [0, 1, 2, 3, 4].map((n) => step(n * 960, 28 + n));

    // Each note is heard later than the last, as in real playing.
    let clock = 1;
    async function play(run: WaitRun, hear: (e: PitchEvent) => void, indices: number[]) {
      for (const index of indices) {
        run.reach(index);
        clock += 1;
        hear(attack(clock, 28 + index));
      }
    }

    it("is true once every step of the track was played from the first one", async () => {
      const { run, hear } = setup(five());
      await run.start();
      run.seek(0);
      expect(run.completed).toBe(false);
      await play(run, hear, [0, 1, 2, 3]);
      expect(run.completed).toBe(false);
      await play(run, hear, [4]);
      expect(run.completed).toBe(true);
    });

    it("is false for a run that started part way through the song", async () => {
      const { run, hear } = setup(five());
      await run.start();
      run.seek(2 * 960);
      await play(run, hear, [2, 3, 4]);
      expect(run.hits).toBe(3);
      expect(run.completed).toBe(false);
    });

    it("is false after jumping past steps, and a restart from the top begins again", async () => {
      const { run, hear } = setup(five());
      await run.start();
      run.seek(0);
      await play(run, hear, [0, 1]);
      run.seek(4 * 960);
      await play(run, hear, [4]);
      expect(run.completed).toBe(false);
      run.seek(0);
      await play(run, hear, [0, 1, 2, 3, 4]);
      expect(run.completed).toBe(true);
      // Going round again must not count the old pass.
      run.seek(0);
      expect(run.completed).toBe(false);
    });

    it("allows a few skipped steps but not many", async () => {
      expect(COMPLETE_HIT_SHARE).toBe(0.8);
      const { run, hear } = setup(five());
      await run.start();
      run.seek(0);
      await play(run, hear, [0, 1, 2, 3]);
      run.reach(4);
      run.skip();
      expect(run.completed).toBe(true);

      const many = setup(five());
      await many.run.start();
      many.run.seek(0);
      await play(many.run, many.hear, [0, 1, 2]);
      for (const index of [3, 4]) {
        many.run.reach(index);
        many.run.skip();
      }
      expect(many.run.completed).toBe(false);
    });

    it("is false for a track with no steps", async () => {
      const { run } = setup([]);
      await run.start();
      expect(run.completed).toBe(false);
    });
  });
});
