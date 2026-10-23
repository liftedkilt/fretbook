import * as alphaTab from "@coderline/alphatab";
import { describe, expect, it } from "vitest";

import { scoreToDocument } from "./alphatab/importScore";
import { scoreToAlphaTex, trackToAlphaTex } from "./alphatex";
import { notation } from "./durations";
import type { Beat, ScoreDocument } from "./types";

function bass(
  beats: Beat[][],
  signatures: [number, number][] = beats.map(() => [4, 4]),
): ScoreDocument {
  return {
    version: 1,
    bpm: 120,
    bars: signatures.map((signature) => ({ signature })),
    sync: { video_id: null, points: [], anchors: {} },
    tracks: [
      {
        id: "bass",
        name: "Bass",
        instrument: "bass-guitar",
        capo: 0,
        tuning_midi: [43, 38, 33, 28],
        preferred: true,
        bars: beats.map((bar) => ({ voices: [{ beats: bar }] })),
      },
    ],
  };
}

function load(document: ScoreDocument, trackId = "bass"): alphaTab.model.Score {
  return alphaTab.importer.ScoreLoader.loadAlphaTex(
    trackToAlphaTex(document, trackId, "Fixture", "Ada"),
  );
}

function fretted(
  id: string,
  name: string,
  instrument: string,
  tuning: number[],
  beats: Beat[][],
  capo = 0,
): ScoreDocument {
  return {
    version: 1,
    bpm: 120,
    bars: beats.map(() => ({ signature: [4, 4] })),
    sync: { video_id: null, points: [], anchors: {} },
    tracks: [
      {
        id,
        name,
        instrument,
        capo,
        tuning_midi: tuning,
        preferred: true,
        bars: beats.map((bar) => ({ voices: [{ beats: bar }] })),
      },
    ],
  };
}

function played(score: alphaTab.model.Score, bar = 0, voice = 0) {
  return score.tracks[0].staves[0].bars[bar].voices[voice].beats.filter((beat) => !beat.isRest);
}

describe("notation", () => {
  it("finds exact plain, dotted, and tuplet values", () => {
    expect(notation(960)).toMatchObject({ token: 4, dots: 0, tuplet: null });
    expect(notation(1440)).toMatchObject({ token: 4, dots: 1 });
    expect(notation(320)).toMatchObject({ token: 8, tuplet: 3 });
    expect(notation(192)).toMatchObject({ token: 16, tuplet: 5 });
    expect(notation(640, 3)).toMatchObject({ token: 4, tuplet: 3 });
  });
});

describe("trackToAlphaTex", () => {
  it("numbers the highest string as alphaTex string 1 and parses in alphaTab", () => {
    const tex = trackToAlphaTex(
      bass([
        [
          { position: 0, duration: 960, notes: [{ string: 0, fret: 3 }] },
          { position: 960, duration: 480, notes: [{ string: 3, fret: 0, dead: true }] },
        ],
      ]),
      "bass",
      "Fixture",
      "Ada",
    );
    expect(tex).toContain("\\tuning (G2 D2 A1 E1)");
    expect(tex).toContain("3.1.4");
    expect(tex).toContain("0.4 { x }.8");

    const score = alphaTab.importer.ScoreLoader.loadAlphaTex(tex);
    const staff = score.tracks[0].staves[0];
    expect(staff.tuning).toEqual([43, 38, 33, 28]);
    expect(staff.showTablature).toBe(true);
    expect(score.tempo).toBe(120);
    const beats = played(score);
    expect(beats[0].notes[0]).toMatchObject({ fret: 3, string: 4 });
    expect(beats[0].playbackDuration).toBe(960);
    expect(beats[1].notes[0]).toMatchObject({ fret: 0, string: 1, isDead: true });
    expect(beats[1].playbackDuration).toBe(480);
  });

  it("renders techniques with alphaTab's meaning", () => {
    const score = load(
      bass([
        [
          { position: 0, duration: 480, notes: [{ string: 0, fret: 3, slide: "shift" }] },
          { position: 480, duration: 480, notes: [{ string: 0, fret: 5, slide: "legato" }] },
          { position: 960, duration: 480, notes: [{ string: 0, fret: 7, hammer: true }] },
          {
            position: 1440,
            duration: 480,
            notes: [{ string: 0, fret: 9, bend: 2, vibrato: true }],
          },
          {
            position: 1920,
            duration: 480,
            notes: [{ string: 1, fret: 12, harmonic: "natural", let_ring: true }],
          },
          {
            position: 2400,
            duration: 480,
            notes: [{ string: 2, fret: 2, palm_mute: true, staccato: true, ghost: true }],
          },
          { position: 2880, duration: 480, notes: [{ string: 2, fret: 2 }] },
          { position: 3360, duration: 480, notes: [{ string: 2, fret: 2, tie: true }] },
        ],
      ]),
    );
    const notes = played(score).map((beat) => beat.notes[0]);
    const { SlideOutType, HarmonicType, VibratoType } = alphaTab.model;
    expect(notes[0].slideOutType).toBe(SlideOutType.Shift);
    expect(notes[1].slideOutType).toBe(SlideOutType.Legato);
    expect(notes[2].isHammerPullOrigin).toBe(true);
    expect(notes[3].bendPoints?.map((point) => point.value)).toEqual([0, 4]);
    expect(notes[3].vibrato).not.toBe(VibratoType.None);
    expect(notes[4].harmonicType).toBe(HarmonicType.Natural);
    expect(notes[4].isLetRing).toBe(true);
    expect([notes[5].isPalmMute, notes[5].isStaccato, notes[5].isGhost]).toEqual([
      true,
      true,
      true,
    ]);
    expect(notes[7].isTieDestination).toBe(true);
  });

  it("keeps grace notes, tuplets, rests, tempo changes, sections, and second voices", () => {
    const document = bass(
      [
        [
          { position: 0, duration: 240, grace: "on_beat", notes: [{ string: 0, fret: 1 }] },
          { position: 0, duration: 320, tuplet: 3, notes: [{ string: 3, fret: 0 }] },
          { position: 320, duration: 320, tuplet: 3, notes: [{ string: 3, fret: 2 }] },
          { position: 640, duration: 320, tuplet: 3, notes: [{ string: 3, fret: 3 }] },
          { position: 1920, duration: 960, notes: [{ string: 2, fret: 0 }] },
        ],
        [{ position: 0, duration: 2880, notes: [{ string: 1, fret: 5 }] }],
      ],
      [
        [4, 4],
        [3, 4],
      ],
    );
    document.bars[1].tempo = 90;
    document.bars[0].section = "Intro";
    document.tracks[0].bars[0].voices.push({
      beats: [{ position: 0, duration: 3840, notes: [{ string: 0, fret: 7 }] }],
    });
    const score = load(document);
    const beats = played(score);
    expect(beats[0].graceType).toBe(alphaTab.model.GraceType.OnBeat);
    // Notated durations: in playback an on-beat grace borrows its time from the next note.
    expect(beats.slice(1, 4).map((beat) => [beat.displayDuration, beat.tupletNumerator])).toEqual([
      [320, 3],
      [320, 3],
      [320, 3],
    ]);
    // The gap after the triplets is filled with rests, so the last note lands on beat 3.
    expect(beats[4].playbackStart).toBe(1920);
    expect(score.masterBars[1].timeSignatureNumerator).toBe(3);
    expect(score.masterBars[1].tempoAutomations.map((mark) => mark.value)).toEqual([90]);
    expect(score.masterBars[0].section?.text).toBe("Intro");
    const second = played(score, 0, 1);
    expect(second[0].notes[0]).toMatchObject({ fret: 7, string: 4 });
  });

  it("round-trips through alphaTab's model back to the same document", () => {
    const document = bass([
      [
        { position: 0, duration: 1440, notes: [{ string: 0, fret: 3, hammer: true }] },
        { position: 1440, duration: 480, notes: [{ string: 0, fret: 5 }] },
        {
          position: 1920,
          duration: 1920,
          notes: [
            { string: 1, fret: 0 },
            { string: 3, fret: 2 },
          ],
        },
      ],
    ]);
    const back = scoreToDocument(load(document)).document;
    const beats = back.tracks[0].bars[0].voices[0].beats;
    expect(back.tracks[0].tuning_midi).toEqual([43, 38, 33, 28]);
    expect(
      beats.map((beat) => [
        beat.position,
        beat.duration,
        beat.notes.map((note) => [note.string, note.fret]),
      ]),
    ).toEqual([
      [0, 1440, [[0, 3]]],
      [1440, 480, [[0, 5]]],
      [
        1920,
        1920,
        [
          [1, 0],
          [3, 2],
        ],
      ],
    ]);
    expect(beats[0].notes[0].hammer).toBe(true);
  });

  it("renders 6-string standard, drop D, capo, and 7-string the way bass is rendered", () => {
    const standard = fretted(
      "gtr",
      "Guitar",
      "guitar",
      [64, 59, 55, 50, 45, 40],
      [
        [
          { position: 0, duration: 960, notes: [{ string: 0, fret: 0 }] },
          { position: 960, duration: 960, notes: [{ string: 5, fret: 3 }] },
        ],
      ],
    );
    const tex = trackToAlphaTex(standard, "gtr", "Fixture", "Ada");
    expect(tex).toContain("\\tuning (E4 B3 G3 D3 A2 E2)");
    expect(tex).toContain("\\instrument (27)");
    expect(tex).not.toContain("\\capo");
    const score = load(standard, "gtr");
    const staff = score.tracks[0].staves[0];
    expect(staff.tuning).toEqual([64, 59, 55, 50, 45, 40]);
    expect(staff.capo).toBe(0);
    expect(score.tracks[0].playbackInfo.program).toBe(27);
    const beats = played(score);
    // alphaTab numbers strings from the lowest, so the top line is string 6.
    expect(beats[0].notes[0]).toMatchObject({ fret: 0, string: 6 });
    expect(beats[0].notes[0].realValue).toBe(64);
    expect(beats[0].playbackStart).toBe(0);
    expect(beats[0].playbackDuration).toBe(960);
    expect(beats[1].notes[0]).toMatchObject({ fret: 3, string: 1 });
    expect(beats[1].notes[0].realValue).toBe(43);
    expect(beats[1].playbackStart).toBe(960);
    expect(beats[1].playbackDuration).toBe(960);

    const drop = fretted(
      "gtr",
      "Guitar",
      "guitar",
      [64, 59, 55, 50, 45, 38],
      [[{ position: 0, duration: 1920, notes: [{ string: 5, fret: 0 }] }]],
    );
    const dropped = played(load(drop, "gtr"));
    expect(load(drop, "gtr").tracks[0].staves[0].tuning[5]).toBe(38);
    expect(dropped[0].notes[0].realValue).toBe(38);
    expect(dropped[0].playbackDuration).toBe(1920);

    const capo = fretted(
      "gtr",
      "Acoustic",
      "acoustic-guitar",
      [64, 59, 55, 50, 45, 40],
      [[{ position: 0, duration: 3840, notes: [{ string: 0, fret: 0 }] }]],
      2,
    );
    const capoTex = trackToAlphaTex(capo, "gtr", "Fixture", "Ada");
    expect(capoTex).toContain("\\capo (2)");
    expect(capoTex).toContain("\\instrument (25)");
    const capoScore = load(capo, "gtr");
    expect(capoScore.tracks[0].staves[0].capo).toBe(2);
    expect(capoScore.tracks[0].playbackInfo.program).toBe(25);
    expect(played(capoScore)[0].notes[0].realValue).toBe(66);

    const seven = fretted(
      "gtr",
      "Seven",
      "guitar",
      [64, 59, 55, 50, 45, 40, 35],
      [[{ position: 0, duration: 960, notes: [{ string: 6, fret: 1 }] }]],
    );
    const sevenScore = load(seven, "gtr");
    expect(sevenScore.tracks[0].staves[0].tuning).toEqual([64, 59, 55, 50, 45, 40, 35]);
    const low = played(sevenScore)[0].notes[0];
    expect(low).toMatchObject({ fret: 1, string: 1 });
    expect(low.realValue).toBe(36);
    expect(played(sevenScore)[0].playbackDuration).toBe(960);
  });
});

describe("scoreToAlphaTex", () => {
  it("writes every track once and keeps bar metadata on the first track only", () => {
    const quarter: Beat = { position: 0, duration: 960, notes: [{ string: 0, fret: 1 }] };
    const base = bass(
      [[quarter], [quarter]],
      [
        [4, 4],
        [3, 4],
      ],
    );
    base.bars[1].tempo = 90;
    base.tracks.push({ ...base.tracks[0], id: "second", name: "Second", preferred: false });
    const tex = scoreToAlphaTex(base, "Fixture", "Ada");
    expect(tex.match(/\\track/g)).toHaveLength(2);
    expect(tex.match(/\\ts \(3 4\)/g)).toHaveLength(1);
    expect(tex.match(/\\tempo \(90\)/g)).toHaveLength(1);
    const score = alphaTab.importer.ScoreLoader.loadAlphaTex(tex);
    expect(score.tracks.map((item) => item.name)).toEqual(["Bass", "Second"]);
    expect(score.masterBars).toHaveLength(2);
    expect(score.masterBars[1].timeSignatureNumerator).toBe(3);
    expect(score.tracks[1].staves[0].bars).toHaveLength(2);
  });
});
