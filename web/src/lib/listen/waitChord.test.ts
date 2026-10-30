import { describe, expect, it } from "vitest";

import type { Beat, ScoreDocument } from "../types";
import type { ChromaEvent } from "./chroma";
import { PitchEngine } from "./engine";
import { renderStrum } from "./harness/synth";
import { buildWaitSteps, WaitMatcher, type WaitStep } from "./wait";

const sampleRate = 48000;
const C = [48, 52, 55, 60, 64];
const G = [43, 47, 50, 55, 59, 67];
const D = [50, 57, 62, 66];
const AM = [45, 52, 57, 60, 64];
const pcs = (midis: number[]) => [...new Set(midis.map((midi) => midi % 12))];

const chordStep = (midis: number[]): WaitStep => ({
  bar: 0,
  position: 0,
  tick: 0,
  kind: "chord",
  midis,
  pcs: pcs(midis),
  string: 0,
  fret: 0,
});

/** What the engine makes of a recording, as the readings the matcher sees. */
function chromaOf(audio: Float32Array): ChromaEvent[] {
  const engine = new PitchEngine({ sampleRate });
  engine.setChroma(true);
  const events: ChromaEvent[] = [];
  for (let at = 0; at < audio.length; at += 128) {
    engine.process(audio.subarray(at, Math.min(audio.length, at + 128)), at / sampleRate);
    events.push(...engine.takeChroma());
  }
  return events;
}

/** Seconds into the recording at which the matcher accepted the chord, or null. */
function hearsAt(audio: Float32Array, wanted: number[], waitFrom = 0): number | null {
  const matcher = new WaitMatcher();
  matcher.wait(chordStep(wanted));
  for (const event of chromaOf(audio)) {
    if (event.time < waitFrom) continue;
    if (matcher.pushChroma(event)) return event.time;
  }
  return null;
}

const strum = (midis: number[], start = 0.5) =>
  renderStrum(midis, start, start + 2, { sampleRate, instrument: "guitar" });

describe("WaitMatcher on chords", () => {
  it("does not accept the root alone as the chord", () => {
    // A pure sine, as in the report: a real string's overtones would add other chord tones.
    const sine = (midi: number) => {
      const audio = new Float32Array(sampleRate * 2.5);
      const hz = 440 * 2 ** ((midi - 69) / 12);
      for (let i = Math.round(0.5 * sampleRate); i < audio.length; i++) {
        audio[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / sampleRate);
      }
      return audio;
    };
    for (const [root, wanted] of [
      [48, C],
      [60, C],
      [43, G],
    ] as const) {
      expect(hearsAt(sine(root), [...wanted])).toBeNull();
    }
  });

  it("still accepts the chord with one string missing", () => {
    expect(hearsAt(strum([48, 55, 60, 64]), C)).not.toBeNull();
  });

  it("accepts the right chord shortly after the strum", () => {
    const at = hearsAt(strum(C), C);
    expect(at).not.toBeNull();
    expect(at!).toBeGreaterThan(0.5);
    expect(at!).toBeLessThan(1.2);
  });

  it("accepts it strummed up as well as down, and with a string missing", () => {
    const up = renderStrum(C, 0.5, 2.5, { sampleRate, instrument: "guitar", up: true });
    expect(hearsAt(up, C)).not.toBeNull();
    expect(hearsAt(strum(C.slice(1)), C)).not.toBeNull();
  });

  it("is lenient about one wrong string", () => {
    expect(hearsAt(strum([48, 52, 54, 60, 64]), C)).not.toBeNull();
  });

  it("does not accept a different chord, near or far", () => {
    expect(hearsAt(strum(D), C)).toBeNull();
    expect(hearsAt(strum(G), C)).toBeNull();
    expect(hearsAt(strum(AM), C)).toBeNull();
    expect(hearsAt(strum(C), AM)).toBeNull();
  });

  it("counts a wrong strum, then accepts the right one", () => {
    const wrong = strum(D, 0.5);
    const right = strum(C, 2.6);
    const audio = new Float32Array(Math.max(wrong.length, right.length));
    audio.set(wrong);
    right.forEach((value, i) => (audio[i] += value));
    const matcher = new WaitMatcher();
    matcher.wait(chordStep(C));
    let hit: number | null = null;
    for (const event of chromaOf(audio)) {
      if (matcher.pushChroma(event)) {
        hit = event.time;
        break;
      }
    }
    expect(matcher.wrong).toBeGreaterThanOrEqual(1);
    expect(hit).toBeGreaterThan(2.6);
  });

  it("needs a new strum: a chord already ringing does not count", () => {
    // The chord rings from 0.5 s; the player only starts waiting at 1.6 s.
    expect(hearsAt(strum(C), C, 1.6)).toBeNull();
  });

  it("ignores the single-pitch readings, which cannot judge a chord", () => {
    const matcher = new WaitMatcher();
    matcher.wait(chordStep(C));
    const reading = {
      time: 1,
      frequency: 130,
      clarity: 0.95,
      midi: 48,
      cents: 0,
      onset: true,
      onsetTime: 0.99,
    };
    expect(matcher.push(reading)).toBe(false);
  });

  it("does nothing for a chord when not waiting or when the step is a note", () => {
    const matcher = new WaitMatcher();
    const reading: ChromaEvent = {
      time: 1,
      bins: new Array(12).fill(1),
      span: 0.17,
      onset: true,
      onsetTime: 1,
    };
    expect(matcher.pushChroma(reading)).toBe(false);
    matcher.wait({ ...chordStep([48]), kind: "note" });
    expect(matcher.pushChroma(reading)).toBe(false);
  });
});

describe("WaitMatcher on tab dyads", () => {
  // Open B with E on the D string: the double-stop from the report.
  const DYAD = [52, 59];
  const dyadStep = (): WaitStep => ({ ...chordStep(DYAD), string: 1 });
  const noOnsets = (audio: Float32Array) => chromaOf(audio).map((e) => ({ ...e, onset: false }));
  /** Two strings plucked together, each with its own level (the synth's strings are monophonic). */
  const pluck = (levels: [number, number][], start = 0.5) => {
    const out = new Float32Array(Math.ceil((start + 2) * sampleRate));
    levels.forEach(([midi, gain], index) => {
      const string = renderStrum([midi], start, start + 2, {
        sampleRate,
        instrument: "guitar",
        seed: 1 + index,
      });
      string.forEach((value, i) => (out[i] += value * gain));
    });
    return out;
  };
  const dyad = (a: number, b: number) =>
    pluck([
      [52, a],
      [59, b],
    ]);
  const accepts = (events: ChromaEvent[], from = 0) => {
    const matcher = new WaitMatcher();
    matcher.wait(dyadStep());
    return events.some((event) => event.time >= from && matcher.pushChroma(event));
  };

  it("accepts a clean two-string pluck, balanced or not", () => {
    for (const [a, b] of [
      [0.8, 0.8],
      [0.8, 0.3],
      [0.3, 0.8],
    ]) {
      expect(accepts(chromaOf(dyad(a, b)))).toBe(true);
    }
  });

  it("accepts a soft pluck whose attack the onset detector missed", () => {
    expect(accepts(noOnsets(dyad(0.5, 0.5)))).toBe(true);
  });

  it("does not accept a dyad that was already ringing when the wait began", () => {
    expect(accepts(noOnsets(dyad(0.8, 0.8)), 1.6)).toBe(false);
  });

  it("does not accept one string of the dyad, with or without an attack", () => {
    const lone = pluck([[59, 1]]);
    expect(accepts(chromaOf(lone))).toBe(false);
    expect(accepts(noOnsets(lone))).toBe(false);
  });

  it("does not accept a different dyad", () => {
    const other = pluck([
      [50, 1],
      [57, 1],
    ]);
    expect(accepts(noOnsets(other))).toBe(false);
  });
});

function beat(position: number, notes: { string: number; fret: number }[]): Beat {
  return { position, duration: 960, notes };
}

function guitarDocument(beats: Beat[]): ScoreDocument {
  return {
    version: 1,
    bpm: 120,
    bars: [{ signature: [4, 4], repeat_start: false, repeat_end: 0 }],
    tracks: [
      {
        id: "guitar",
        name: "Guitar",
        instrument: "guitar",
        capo: 0,
        // e B G D A E, highest string first.
        tuning_midi: [64, 59, 55, 50, 45, 40],
        preferred: true,
        bars: [{ voices: [{ beats }] }],
      },
    ],
    sync: { video_id: null, points: [], anchors: {} },
  };
}

describe("buildWaitSteps with chords", () => {
  const chord = beat(0, [
    { string: 4, fret: 3 },
    { string: 3, fret: 2 },
    { string: 2, fret: 0 },
  ]);
  const octave = beat(960, [
    { string: 5, fret: 5 },
    { string: 3, fret: 7 },
  ]);
  const single = beat(1920, [{ string: 4, fret: 3 }]);
  const document = guitarDocument([chord, octave, single]);

  it("makes a chord step from a beat of different pitch classes", () => {
    const [first] = buildWaitSteps(document, document.tracks[0]);
    expect(first.kind).toBe("chord");
    // C3 (A string, fret 3), E3 (D string, fret 2), G3 (open G).
    expect(first.pcs).toEqual([0, 4, 7]);
    expect(first.midis).toEqual([48, 52, 55]);
  });

  it("leaves an octave double and a single note as notes", () => {
    const steps = buildWaitSteps(document, document.tracks[0]);
    expect(steps.map((step) => step.kind)).toEqual(["chord", "note", "note"]);
    expect(steps[1].pcs).toBeUndefined();
  });

  it("keeps the old note-by-note check when chords are off", () => {
    const steps = buildWaitSteps(document, document.tracks[0], { chords: false });
    expect(steps.map((step) => step.kind)).toEqual(["note", "note", "note"]);
    expect(steps[0].pcs).toBeUndefined();
  });
});
