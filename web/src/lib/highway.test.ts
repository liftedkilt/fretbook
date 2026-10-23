import { describe, expect, it, vi } from "vitest";

import {
  buildHighwayTimeline,
  buildTechniqueGlyphs,
  computeHighwayLayout,
  drawHighway,
  formatBendSemitones,
  gemKey,
  highwayStarts,
  identifyChord,
  laneY,
  resolveGemState,
  stringColor,
  timeAtBarPosition,
  timeToX,
  visibleWindow,
  xToTime,
  type GemState,
  type HighwayCanvasContext,
} from "./highway";
import type { ScoreDocument, Track } from "./types";

function makeScore(): { document: ScoreDocument; track: Track } {
  const track: Track = {
    id: "t1",
    name: "Lead Guitar",
    instrument: "electric-guitar",
    capo: 0,
    tuning_midi: [64, 59, 55, 50, 45, 40],
    preferred: true,
    bars: [
      {
        voices: [
          {
            beats: [
              {
                position: 0,
                duration: 960,
                notes: [
                  {
                    string: 5,
                    fret: 0,
                    palm_mute: true,
                    hammer: true,
                  },
                ],
              },
              {
                position: 960,
                duration: 960,
                notes: [
                  {
                    string: 5,
                    fret: 2,
                    slide: "shift",
                  },
                ],
              },
              {
                position: 1920,
                duration: 960,
                notes: [
                  {
                    string: 5,
                    fret: 5,
                    vibrato: true,
                    bend: 2,
                  },
                ],
              },
              {
                position: 2880,
                duration: 960,
                notes: [
                  {
                    string: 5,
                    fret: 5,
                    tie: true,
                    vibrato: true,
                    bend: 3,
                  },
                ],
              },
            ],
          },
          {
            // Second voice on beat 0 to verify voice merging, plus a grace note.
            beats: [
              {
                position: 0,
                duration: 240,
                grace: "before_beat",
                notes: [{ string: 0, fret: 1 }],
              },
              {
                position: 0,
                duration: 960,
                notes: [{ string: 4, fret: 2 }],
              },
            ],
          },
        ],
      },
      {
        voices: [
          {
            beats: [
              {
                position: 0,
                duration: 1920,
                notes: [
                  { string: 5, fret: 3 },
                  { string: 4, fret: 2 },
                  { string: 3, fret: 0 },
                  { string: 2, fret: 0 },
                  { string: 1, fret: 0 },
                  { string: 0, fret: 3 },
                ],
              },
              {
                position: 1920,
                duration: 960,
                notes: [{ string: 3, fret: 0, dead: true }],
              },
              {
                position: 2880,
                duration: 960,
                notes: [
                  {
                    string: 2,
                    fret: 7,
                    ghost: true,
                    staccato: true,
                    harmonic: "natural",
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const document: ScoreDocument = {
    version: 1,
    bpm: 120,
    bars: [
      { signature: [4, 4], section: "Intro" },
      { signature: [4, 4], section: "Chorus" },
    ],
    tracks: [track],
    sync: {
      video_id: null,
      points: [0, 2.5],
      anchors: { "0": 0.5, "1": 3.0, "2": 5.5 },
      keyed_by: "played",
    },
  };

  return { document, track };
}

function makeMockCtx(withRoundRect = true): {
  ctx: HighwayCanvasContext;
  texts: string[];
  calls: string[];
} {
  const texts: string[] = [];
  const calls: string[] = [];
  const ctx: HighwayCanvasContext = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    globalAlpha: 1,
    shadowColor: "",
    shadowBlur: 0,
    save: vi.fn(() => calls.push("save")),
    restore: vi.fn(() => calls.push("restore")),
    clearRect: vi.fn(() => calls.push("clearRect")),
    fillRect: vi.fn(() => calls.push("fillRect")),
    strokeRect: vi.fn(() => calls.push("strokeRect")),
    beginPath: vi.fn(() => calls.push("beginPath")),
    closePath: vi.fn(() => calls.push("closePath")),
    moveTo: vi.fn(() => calls.push("moveTo")),
    lineTo: vi.fn(() => calls.push("lineTo")),
    quadraticCurveTo: vi.fn(() => calls.push("quadraticCurveTo")),
    arc: vi.fn(() => calls.push("arc")),
    fill: vi.fn(() => calls.push("fill")),
    stroke: vi.fn(() => calls.push("stroke")),
    fillText: vi.fn((text: string) => {
      texts.push(text);
      calls.push(`fillText:${text}`);
    }),
    setLineDash: vi.fn(() => calls.push("setLineDash")),
  };
  if (withRoundRect) {
    ctx.roundRect = vi.fn(() => calls.push("roundRect"));
  }
  return { ctx, texts, calls };
}

describe("highway timing and helpers", () => {
  it("computes bar starts for synth and synced audio", () => {
    const { document } = makeScore();
    // 120 BPM in 4/4 is 2 seconds per bar for the synth.
    expect(highwayStarts(document, false)).toEqual([0, 2, 4]);
    // With audio, sync anchors pin the bars.
    expect(highwayStarts(document, true)).toEqual([0.5, 3.0, 5.5]);
    // Empty score fallback.
    expect(highwayStarts({ ...document, bars: [], tracks: [] }, false)).toEqual([0]);
  });

  it("maps bar and tick position to seconds", () => {
    const starts = [1, 3, 5];
    expect(timeAtBarPosition([], 0, 0, 3840)).toBe(0);
    expect(timeAtBarPosition(starts, -1, 0, 3840)).toBe(1);
    expect(timeAtBarPosition(starts, 0, 1920, 3840)).toBe(2);
    expect(timeAtBarPosition(starts, 1, 960, 3840)).toBe(3.5);
    expect(timeAtBarPosition(starts, 5, 0, 3840)).toBe(5);
    expect(timeAtBarPosition(starts, 0, 960, 0)).toBe(1);
  });

  it("formats bends and builds technique glyphs", () => {
    expect(formatBendSemitones(1)).toBe("½");
    expect(formatBendSemitones(2)).toBe("1");
    expect(formatBendSemitones(3)).toBe("1½");
    expect(formatBendSemitones(4)).toBe("2");

    expect(
      buildTechniqueGlyphs(
        {
          fret: 5,
          hammer: true,
          slide: "shift",
          bend: 2,
          palm_mute: true,
          vibrato: true,
          harmonic: "natural",
        },
        7,
      ),
    ).toEqual([
      { kind: "hammer", label: "H" },
      { kind: "slide", label: "/" },
      { kind: "bend", label: "⤴1" },
      { kind: "palm_mute", label: "PM" },
      { kind: "vibrato", label: "~" },
      { kind: "harmonic", label: "◇" },
    ]);

    // Pull-off and downward slide when targetFret < fret.
    expect(buildTechniqueGlyphs({ fret: 7, hammer: true, slide: "legato" }, 5)).toEqual([
      { kind: "pull", label: "P" },
      { kind: "slide", label: "\\" },
    ]);

    // Standalone hammer without a target fret.
    expect(buildTechniqueGlyphs({ fret: 3, hammer: true }, null)).toEqual([
      { kind: "hammer", label: "H/P" },
    ]);
  });

  it("identifies common chords and inversions from MIDI notes", () => {
    expect(identifyChord([40])).toBe("");
    // Octaves: E2 + E3 -> "E"
    expect(identifyChord([40, 52])).toBe("E");
    // Power chord: E2 (40) + B2 (47) -> "E5"
    expect(identifyChord([40, 47])).toBe("E5");
    // Major triad: G2 (43) + B2 (47) + D3 (50) -> "G"
    expect(identifyChord([43, 47, 50])).toBe("G");
    // Minor triad: A2 (45) + E3 (52) + A3 (57) + C4 (60) -> "Am"
    expect(identifyChord([45, 52, 57, 60])).toBe("Am");
    // Dominant 7th: G (43), B (47), D (50), F (53) -> "G7"
    expect(identifyChord([43, 47, 50, 53])).toBe("G7");
    // Slash inversion: C triad with G in the bass -> "C/G"
    expect(identifyChord([43, 48, 52])).toBe("C/G");
    // Unmatched cluster falls back to bass note name.
    expect(identifyChord([40, 41, 42])).toBe("E");
  });

  it("builds a timeline with sustain tails, ties, connectors, and chords", () => {
    const { document, track } = makeScore();
    const timeline = buildHighwayTimeline(document, track, false);

    expect(timeline.stringNames).toEqual(["E", "B", "G", "D", "A", "E"]);
    expect(timeline.bars).toHaveLength(2);
    expect(timeline.bars[0].section).toBe("Intro");
    expect(timeline.bars[0].beats).toHaveLength(4);
    expect(timeline.bars[0].beats[0].isDownbeat).toBe(true);
    expect(timeline.bars[0].beats[1].isDownbeat).toBe(false);

    // Bar 0 beat 0 has E2 + B2 (E5 power chord); Bar 1 beat 0 has G major chord.
    expect(timeline.chords.map((c) => c.name)).toEqual(["E5", "G"]);

    // Tied note on bar 0 beat 3 (position 2880) extends the sustain of beat 2 (position 1920)
    // instead of adding a duplicate gem.
    const bar0String5 = timeline.gems.filter((g) => g.bar === 0 && g.string === 5);
    expect(bar0String5).toHaveLength(3);
    expect(bar0String5[0].targetFret).toBe(2);
    expect(bar0String5[0].techniques.map((t) => t.label)).toContain("H");
    expect(bar0String5[1].targetFret).toBe(5);
    expect(bar0String5[1].techniques.map((t) => t.label)).toContain("/");
    // Beat 2 + tied Beat 3 lasts 1920 ticks (1.0s at 120 BPM, from 1.0s to 2.0s).
    expect(bar0String5[2].time).toBeCloseTo(1.0);
    expect(bar0String5[2].endTime).toBeCloseTo(2.0);
    expect(bar0String5[2].bend).toBe(3);

    // Dead note has "X" and zero sustain; ghost staccato note has "(7)" and half sustain.
    const deadGem = timeline.gems.find((g) => g.dead);
    expect(deadGem?.label).toBe("X");
    expect(deadGem?.endTime).toBe(deadGem?.time);

    const ghostGem = timeline.gems.find((g) => g.ghost);
    expect(ghostGem?.label).toBe("(7)");
    expect(ghostGem?.staccato).toBe(true);
    expect((ghostGem?.endTime ?? 0) - (ghostGem?.time ?? 0)).toBeCloseTo(0.25);
  });

  it("resolves gem state for wait mode and scored play", () => {
    const gem = { bar: 1, position: 960, string: 2 };
    expect(resolveGemState(gem)).toBe("default");
    expect(resolveGemState(gem, undefined, { bar: 1, position: 960 })).toBe("waiting");

    const recordGrades: Record<string, GemState> = {
      [gemKey(1, 960)]: "hit",
      [gemKey(1, 960, 2)]: "missed",
    };
    expect(resolveGemState(gem, recordGrades)).toBe("missed");
    expect(resolveGemState({ bar: 1, position: 960, string: 3 }, recordGrades)).toBe("hit");

    const mapGrades = new Map<string, GemState>([[gemKey(1, 960), "early"]]);
    expect(resolveGemState(gem, mapGrades)).toBe("early");
    const mapByNote = new Map<string, GemState>([[gemKey(1, 960, 2), "late"]]);
    expect(resolveGemState(gem, mapByNote)).toBe("late");
  });

  it("slices the visible window and tracks current and upcoming sections", () => {
    const { document, track } = makeScore();
    const timeline = buildHighwayTimeline(document, track, false);
    const win = visibleWindow(timeline, 0.5, 0.2, 1.0);
    expect(win.bars).toHaveLength(1);
    expect(win.currentSection).toBe("Intro");
    expect(win.upcomingSection).toEqual({ name: "Chorus", bar: 1, time: 2 });

    const later = visibleWindow(timeline, 2.5, 0.2, 2.0);
    expect(later.currentSection).toBe("Chorus");
    expect(later.upcomingSection).toBeNull();
  });

  it("computes layout coordinates and inverses", () => {
    const layout = computeHighwayLayout(1000, 300, 4, 0.5, 4.0);
    const x = timeToX(layout, 2.5, 1.0);
    expect(xToTime(layout, x, 1.0)).toBeCloseTo(2.5);
    expect(laneY(layout, 0)).toBe(layout.topY);
    expect(laneY(layout, 3)).toBeCloseTo(layout.bottomY);
    expect(stringColor(0)).toBe("#b56bff");
  });
});

describe("drawHighway", () => {
  it("draws lanes, gems, fret numbers, techniques, chords, sections, and hit/missed states", () => {
    const { document, track } = makeScore();
    const timeline = buildHighwayTimeline(document, track, false);
    const { ctx, texts, calls } = makeMockCtx(true);

    drawHighway(ctx, {
      timeline,
      currentTime: 0.2,
      width: 960,
      height: 280,
      loopA: 0,
      loopB: 1,
      grades: {
        "0:0": "hit",
        "0:960": "missed",
        "0:1920": "early",
      },
      waitingAt: { bar: 0, position: 960 },
    });

    expect(calls).toContain("clearRect");
    expect(calls).toContain("roundRect");
    expect(calls).toContain("quadraticCurveTo");
    // Section labels
    expect(texts).toContain("Intro");
    expect(texts).toContain("Chorus");
    // Chord names
    expect(texts).toContain("E5");
    expect(texts).toContain("G");
    // Fret labels & dead/ghost notes
    expect(texts).toContain("0");
    expect(texts).toContain("2");
    expect(texts).toContain("5");
    expect(texts).toContain("X");
    expect(texts).toContain("(7)");
    // Technique badges
    expect(texts.some((t) => t.includes("PM"))).toBe(true);
    expect(texts.some((t) => t.includes("H"))).toBe(true);
    expect(texts.some((t) => t.includes("/"))).toBe(true);
    expect(texts.some((t) => t.includes("⤴"))).toBe(true);
  });

  it("falls back cleanly when roundRect is not on the canvas context", () => {
    const { document, track } = makeScore();
    const timeline = buildHighwayTimeline(document, track, false);
    const { ctx, calls } = makeMockCtx(false);

    drawHighway(ctx, {
      timeline,
      currentTime: 0,
      width: 800,
      height: 240,
    });

    expect(calls).toContain("closePath");
    expect(calls).not.toContain("roundRect");
  });
});
