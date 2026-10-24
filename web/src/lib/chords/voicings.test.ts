import { describe, expect, it } from "vitest";

import { parse } from "../chordpro";
import { CHORD_INSTRUMENTS } from "./instruments";
import { parseChord } from "./theory";
import {
  defineVoicing,
  generateVoicings,
  physicalTuning,
  voicingKey,
  voicingsFor,
} from "./voicings";

const guitar = physicalTuning([64, 59, 55, 50, 45, 40]);
const ukulele = physicalTuning([69, 64, 60, 67]);

function keys(tuning: number[], chord: string, rootInBass = true): string[] {
  return generateVoicings(tuning, chord, { rootInBass }).map((voicing) =>
    voicingKey(voicing.frets),
  );
}

describe("generateVoicings", () => {
  it("finds the open shapes first", () => {
    expect(keys(guitar, "C")[0]).toBe("x.3.2.0.1.0");
    expect(keys(guitar, "G")[0]).toBe("3.2.0.0.0.3");
    expect(keys(guitar, "Am")[0]).toBe("x.0.2.2.1.0");
    expect(keys(guitar, "Em7")[0]).toBe("0.2.0.0.0.0");
    expect(keys(guitar, "G7")[0]).toBe("3.2.0.0.0.1");
  });

  it("finds a barre for F and draws it", () => {
    const [best] = generateVoicings(guitar, "F");
    expect(voicingKey(best.frets)).toBe("1.3.3.2.1.1");
    expect(best.barre).toEqual({ fret: 1, from: 0, to: 5 });
    expect(best.baseFret).toBe(1);
  });

  it("windows high shapes at their lowest fret", () => {
    const high = generateVoicings(guitar, "F").find((voicing) => voicing.baseFret > 1)!;
    expect(high.baseFret).toBe(Math.min(...high.frets.filter((fret): fret is number => !!fret)));
  });

  it("puts the slash bass in the bass", () => {
    const [best] = generateVoicings(guitar, "D/F#");
    expect(voicingKey(best.frets)).toBe("2.0.0.2.3.2");
  });

  it("covers ukulele with its reentrant tuning", () => {
    expect(keys(ukulele, "C", false)[0]).toBe("0.0.0.3");
    expect(keys(ukulele, "G", false)).toContain("0.2.3.2");
    expect(keys(ukulele, "Am", false)[0]).toBe("2.0.0.0");
    expect(generateVoicings(ukulele, "G", { rootInBass: false })[0].barre).toBeNull();
  });

  it("covers bass", () => {
    const bass = CHORD_INSTRUMENTS.find((item) => item.id === "bass4")!.tunings[0].strings;
    expect(keys(bass, "C")[0]).toBe("x.3.2.0");
  });

  it("only sounds chord tones, all essential ones, with a playable hand", () => {
    const names = [
      "C",
      "Am",
      "F",
      "Bm",
      "Cmaj7",
      "G7",
      "Dsus4",
      "Bdim",
      "E7#9",
      "Gm9",
      "A5",
      "D/F#",
    ];
    for (const instrument of CHORD_INSTRUMENTS) {
      for (const tuning of instrument.tunings) {
        for (const name of names) {
          const chord = parseChord(name)!;
          const allowed = new Set([...chord.required, ...chord.optional]);
          for (const voicing of generateVoicings(tuning.strings, name, {
            rootInBass: instrument.rootInBass,
          })) {
            const pitches = voicing.frets.flatMap((fret, index) =>
              fret === null ? [] : [(tuning.strings[index] + fret) % 12],
            );
            expect(pitches.length).toBeGreaterThanOrEqual(3);
            for (const pitch of pitches) expect(allowed.has(pitch)).toBe(true);
            for (const pitch of chord.required) expect(pitches).toContain(pitch);
            const fretted = voicing.frets.filter((fret): fret is number => !!fret);
            if (fretted.length) expect(Math.max(...fretted) - Math.min(...fretted)).toBeLessThan(4);
          }
        }
      }
    }
  });

  it("keeps a few shapes per position and returns at most the limit", () => {
    expect(generateVoicings(guitar, "A", { limit: 3 })).toHaveLength(3);
    expect(generateVoicings(guitar, "A").length).toBeLessThanOrEqual(6);
  });

  it("returns nothing for what is not a chord or a tuning", () => {
    expect(generateVoicings(guitar, "N.C.")).toEqual([]);
    expect(generateVoicings([40, 45], "C")).toEqual([]);
  });

  it("memoizes", () => {
    expect(generateVoicings(guitar, "Dm")).toBe(generateVoicings(guitar, "Dm"));
  });
});

describe("define", () => {
  const { defines } = parse("{define: Am7 base-fret 1 frets x 0 2 0 1 0}\n[Am7]x");

  it("becomes a voicing for a matching string count only", () => {
    expect(defineVoicing(defines.Am7, 6)?.source).toBe("define");
    expect(defineVoicing(defines.Am7, 4)).toBeNull();
  });

  it("is offered first, once", () => {
    const list = voicingsFor("Am7", guitar, defines);
    expect(voicingKey(list[0].frets)).toBe("x.0.2.0.1.0");
    expect(list[0].source).toBe("define");
    expect(list.filter((voicing) => voicingKey(voicing.frets) === "x.0.2.0.1.0")).toHaveLength(1);
    expect(list.length).toBeGreaterThan(1);
  });

  it("is ignored for another instrument or another name", () => {
    expect(voicingsFor("Am7", ukulele, defines)[0].source).toBe("generated");
    expect(voicingsFor("Am", guitar, defines)[0].source).toBe("generated");
  });
});
