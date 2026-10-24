import { describe, expect, it } from "vitest";

import type { ChromaEvent } from "../listen/chroma";
import { PitchEngine } from "../listen/engine";
import { renderStrum } from "../listen/harness/synth";
import { CHORD_QUALITIES, chordPool, type ChordQuestion } from "./ear";
import {
  ChordAnswerMatcher,
  chordFit,
  identifyChord,
  questionPitchClasses,
  type ChordVerdict,
} from "./chordPlay";

const sampleRate = 48000;

function question(qualityId: string, root: number): ChordQuestion {
  const quality = CHORD_QUALITIES.find((q) => q.id === qualityId)!;
  return { root, quality, notes: quality.tones.map((tone) => root + tone) };
}

/** A guitar-ish voicing: the root an octave down as well, and the chord above it. */
const voicing = (q: ChordQuestion) => [q.root - 12, ...q.notes, q.root + 12];

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

const strum = (midis: number[], start = 0.5) =>
  renderStrum(midis, start, start + 2, { sampleRate, instrument: "guitar" });

/** The verdict the matcher gives for a strum of `played` when `asked` is the question. */
function judge(asked: ChordQuestion, played: number[], level: "easy" | "all" = "all") {
  const matcher = new ChordAnswerMatcher();
  matcher.listen(asked, chordPool(level));
  for (const event of chromaOf(strum(played))) {
    const verdict = matcher.push(event);
    if (verdict) return { verdict, at: event.time };
  }
  return { verdict: null as ChordVerdict | null, at: null };
}

describe("chordFit", () => {
  it("is 1 for exactly the chord and falls with a missing or extra note", () => {
    const bins = new Array(12).fill(0);
    for (const pc of [0, 4, 7]) bins[pc] = 1;
    expect(chordFit(bins, [0, 4, 7])).toBeCloseTo(1);
    expect(chordFit(bins, [0, 4, 7, 11])).toBeLessThan(0.9);
    expect(chordFit(bins, [0, 3, 7])).toBeLessThan(0.7);
    expect(chordFit(new Array(12).fill(0), [0, 4, 7])).toBe(0);
  });
});

describe("identifyChord", () => {
  it("tells apart chords that share three of their notes", () => {
    const bins = new Array(12).fill(0);
    for (const pc of [0, 4, 7]) bins[pc] = 1;
    const asked = question("maj7", 0);
    const result = identifyChord(bins, CHORD_QUALITIES, asked);
    expect(result.best?.quality.id).toBe("major");
    expect(result.expected).toBe(false);
    expect(identifyChord(bins, CHORD_QUALITIES, question("major", 0)).expected).toBe(true);
  });

  it("treats an augmented triad on any of its notes as the same chord", () => {
    const bins = new Array(12).fill(0);
    for (const pc of [0, 4, 8]) bins[pc] = 1;
    expect(identifyChord(bins, CHORD_QUALITIES, question("aug", 4)).expected).toBe(true);
  });

  it("hears nothing in silence or a single note", () => {
    expect(identifyChord(new Array(12).fill(0), CHORD_QUALITIES, question("major", 0)).best).toBe(
      null,
    );
    const single = new Array(12).fill(0);
    single[0] = 1;
    expect(identifyChord(single, CHORD_QUALITIES, question("major", 0)).best).toBeNull();
  });

  it("lists the question's pitch classes", () => {
    expect(questionPitchClasses(question("dom7", 10))).toEqual([10, 2, 5, 8]);
  });
});

describe("ChordAnswerMatcher on strummed audio", () => {
  it("accepts every quality played on a few roots", () => {
    for (const quality of CHORD_QUALITIES) {
      for (const root of [48, 55]) {
        const asked = question(quality.id, root);
        const { verdict, at } = judge(asked, voicing(asked));
        expect(verdict, `${quality.id} on ${root}`).toBe("right");
        expect(at!).toBeGreaterThan(0.5);
      }
    }
  });

  it("calls a different quality on the same root wrong", () => {
    const pairs: [string, string][] = [
      ["major", "minor"],
      ["minor", "major"],
      ["major", "dom7"],
      ["dom7", "major"],
      ["dom7", "maj7"],
      ["maj7", "major"],
      ["min7", "minor"],
      ["sus4", "major"],
      ["dim", "minor"],
    ];
    for (const [asked, played] of pairs) {
      const q = question(asked, 50);
      const { verdict } = judge(q, voicing(question(played, 50)));
      expect(verdict, `asked ${asked}, played ${played}`).toBe("wrong");
    }
  });

  it("calls the right quality on the wrong root wrong", () => {
    const { verdict } = judge(question("major", 48), voicing(question("major", 50)));
    expect(verdict).toBe("wrong");
  });

  it("does nothing until something is played", () => {
    const matcher = new ChordAnswerMatcher();
    matcher.listen(question("major", 48), chordPool("all"));
    const quiet = new Float32Array(sampleRate * 2);
    for (const event of chromaOf(quiet)) expect(matcher.push(event)).toBeNull();
  });

  it("ignores a strum from before it started listening", () => {
    const asked = question("major", 48);
    const events = chromaOf(strum(voicing(asked)));
    const matcher = new ChordAnswerMatcher();
    for (const event of events) if (event.time < 2) matcher.tick(event);
    matcher.listen(asked, chordPool("all"));
    // Readings that arrive after listening starts only hold the old strum's tail.
    const verdicts = events.filter((event) => event.time >= 2).map((e) => matcher.push(e));
    expect(verdicts.every((verdict) => verdict === null)).toBe(true);
  });

  it("stops after giving a verdict", () => {
    const asked = question("major", 48);
    const matcher = new ChordAnswerMatcher();
    matcher.listen(asked, chordPool("all"));
    const verdicts = chromaOf(strum(voicing(asked))).map((e) => matcher.push(e));
    expect(verdicts.filter((verdict) => verdict !== null)).toEqual(["right"]);
  });

  it("falls back to wrong when a strum never settles", () => {
    const matcher = new ChordAnswerMatcher({
      settleSeconds: 0.5,
      earlySeconds: 0.08,
      minFit: 0.7,
      tieMargin: 0.02,
      noiseFloor: 0.2,
      agree: 2,
      disagree: 1000,
    });
    const asked = question("major", 48);
    matcher.listen(asked, chordPool("all"));
    const verdicts = chromaOf(strum(voicing(question("minor", 48)))).map((e) => matcher.push(e));
    expect(verdicts.find((verdict) => verdict !== null)).toBe("wrong");
  });
});
