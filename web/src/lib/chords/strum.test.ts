import { describe, expect, it, vi } from "vitest";

import { midiFrequency, playStrum, STRUM_GAP, strumNotes } from "./strum";
import { physicalTuning, type Voicing } from "./voicings";

const guitar = physicalTuning([64, 59, 55, 50, 45, 40]);
const cMajor: Voicing = {
  frets: [null, 3, 2, 0, 1, 0],
  baseFret: 1,
  barre: null,
  source: "generated",
};

describe("strumNotes", () => {
  it("strums the sounding strings low to high", () => {
    const notes = strumNotes(cMajor, guitar);
    expect(notes.map((note) => note.midi)).toEqual([48, 52, 55, 60, 64]);
    expect(notes.map((note) => note.delay)).toEqual([0, 1, 2, 3, 4].map((n) => n * STRUM_GAP));
  });

  it("sounds higher with a capo", () => {
    expect(strumNotes(cMajor, guitar, 2).map((note) => note.midi)).toEqual([50, 54, 57, 62, 66]);
    expect(strumNotes(cMajor, guitar, -1)[0].midi).toBe(48);
  });
});

describe("playStrum", () => {
  it("converts MIDI to hertz", () => {
    expect(midiFrequency(69)).toBe(440);
    expect(midiFrequency(57)).toBeCloseTo(220);
  });

  function fakeContext() {
    const param = () => ({
      value: 0,
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    });
    const node = () => ({ connect: vi.fn(), gain: param(), frequency: param(), type: "" });
    const oscillators: { start: ReturnType<typeof vi.fn> }[] = [];
    return {
      oscillators,
      context: {
        currentTime: 0,
        destination: {},
        resume: vi.fn(),
        createGain: vi.fn(node),
        createBiquadFilter: vi.fn(node),
        createOscillator: vi.fn(() => {
          const oscillator = { ...node(), start: vi.fn(), stop: vi.fn() };
          oscillators.push(oscillator);
          return oscillator;
        }),
      } as unknown as AudioContext,
    };
  }

  it("starts two partials per note, reusing one context", () => {
    const { context, oscillators } = fakeContext();
    const make = vi.fn(() => context);
    playStrum(strumNotes(cMajor, guitar), make);
    expect(oscillators).toHaveLength(10);
    playStrum(strumNotes(cMajor, guitar), make);
    expect(make).toHaveBeenCalledTimes(1);
    expect(oscillators).toHaveLength(20);
  });
});
