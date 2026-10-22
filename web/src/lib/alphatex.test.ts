import * as alphaTab from "@coderline/alphatab";
import { describe, expect, it } from "vitest";

import { trackToAlphaTex } from "./alphatex";
import type { ScoreDocument } from "./types";

function document(): ScoreDocument {
  return {
    version: 1,
    bpm: 120,
    tempos: [{ bpm: 120, measure: 0 }],
    sync: { video_id: null, points: [], anchors: {} },
    tracks: [
      {
        id: "bass",
        name: "Bass",
        instrument: "bass-guitar",
        capo: 0,
        tuning_midi: [43, 38, 33, 28],
        preferred: true,
        measures: [
          {
            signature: [4, 4],
            extras: {},
            voices: [
              {
                beats: [
                  {
                    position: 0,
                    duration: 1,
                    rest: false,
                    extras: {},
                    notes: [{ string: 0, fret: 3, dead: false, tie: false, extras: {} }],
                  },
                  {
                    position: 1,
                    duration: 0.5,
                    rest: false,
                    extras: {},
                    notes: [{ string: 3, fret: 0, dead: true, tie: false, extras: {} }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("trackToAlphaTex", () => {
  it("numbers the highest string as alphaTex string 1 and parses in alphaTab", () => {
    const tex = trackToAlphaTex(document(), "bass", "Fixture", "Ada");
    expect(tex).toContain("\\tuning (G2 D2 A1 E1)");
    expect(tex).toContain("3.1.4");
    expect(tex).toContain("0.4 { x }.8");
    expect(tex).not.toContain("\\sync");

    const score = alphaTab.importer.ScoreLoader.loadAlphaTex(tex);
    const staff = score.tracks[0].staves[0];
    expect(score.tracks).toHaveLength(1);
    expect(staff.tuning).toEqual([43, 38, 33, 28]);
    expect(staff.showTablature).toBe(true);
    expect(staff.showStandardNotation).toBe(true);
    expect(score.masterBars[0].timeSignatureNumerator).toBe(4);
    expect(score.tempo).toBe(120);

    const beats = staff.bars[0].voices[0].beats;
    const played = beats.filter((beat) => !beat.isRest);
    expect(played[0].notes[0].fret).toBe(3);
    expect(played[0].notes[0].string).toBe(4);
    expect(played[0].playbackDuration).toBe(960);
    expect(played[1].notes[0].fret).toBe(0);
    expect(played[1].notes[0].string).toBe(1);
    expect(played[1].notes[0].isDead).toBe(true);
    expect(played[1].playbackDuration).toBe(480);
  });

  it("keeps an on-beat grace from advancing the next note, on six strings", () => {
    const source = document();
    const track = source.tracks[0];
    track.tuning_midi = [64, 59, 55, 50, 45, 40];
    track.instrument = "guitar";
    track.measures[0].signature = [6, 8];
    track.measures[0].voices[0].beats = [
      {
        position: 0,
        duration: 0.25,
        rest: false,
        extras: { graceNote: "onBeat" },
        notes: [{ string: 0, fret: 1, dead: false, tie: false, extras: {} }],
      },
      {
        position: 0,
        duration: 1.5,
        rest: false,
        extras: {},
        notes: [{ string: 5, fret: 0, dead: false, tie: false, extras: {} }],
      },
    ];
    const score = alphaTab.importer.ScoreLoader.loadAlphaTex(
      trackToAlphaTex(source, "bass", "Six", "Ada"),
    );
    const beats = score.tracks[0].staves[0].bars[0].voices[0].beats.filter((beat) => !beat.isRest);
    expect(score.tracks[0].staves[0].tuning).toEqual([64, 59, 55, 50, 45, 40]);
    expect(beats[0].graceType).toBe(alphaTab.model.GraceType.OnBeat);
    expect(beats[0].notes[0].string).toBe(6);
    expect(beats[0].displayStart).toBe(0);
    expect(beats[0].playbackDuration).toBe(120);
    expect(beats[1].notes[0].string).toBe(1);
    expect(beats[1].notes[0].fret).toBe(0);
    expect(beats[1].displayStart).toBe(0);
    expect(beats[1].playbackStart).toBe(120);
    expect(beats[1].playbackDuration).toBe(1320);
  });
});
