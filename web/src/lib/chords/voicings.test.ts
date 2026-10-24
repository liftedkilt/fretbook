import { describe, expect, it } from "vitest";

import { parse } from "../chordpro";
import { CHORD_INSTRUMENTS } from "./instruments";
import { parseChord } from "./theory";
import {
  defineVoicing,
  generateVoicings,
  moveDefine,
  movedDefines,
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

describe("extended chords", () => {
  it("finds shapes for elevenths, thirteenths and alterations on guitar", () => {
    for (const name of ["C11", "Am11", "G13", "Dm13", "Fmaj13", "G7b5", "C7#11", "Cmaj7#11"]) {
      const list = generateVoicings(guitar, name);
      expect(list.length, name).toBeGreaterThan(0);
      const chord = parseChord(name)!;
      for (const voicing of list) {
        const pitches = new Set(
          voicing.frets.flatMap((fret, i) => (fret === null ? [] : [(guitar[i] + fret) % 12])),
        );
        for (const pitch of chord.required)
          expect(pitches.has(pitch), `${name} ${voicingKey(voicing.frets)}`).toBe(true);
      }
    }
  });
});

describe("finger numbers", () => {
  it("puts the index finger on the barre and counts up the rest", () => {
    const f = generateVoicings(guitar, "F").find((v) => voicingKey(v.frets) === "1.3.3.2.1.1");
    expect(f?.fingers).toEqual([1, 3, 4, 2, 1, 1]);
  });

  it("numbers an open chord from the lowest fret", () => {
    const c = generateVoicings(guitar, "C").find((v) => voicingKey(v.frets) === "x.3.2.0.1.0");
    expect(c?.fingers).toEqual([null, 3, 2, null, 1, null]);
  });

  it("never needs more than four fingers", () => {
    for (const name of ["C", "F", "Bm7", "G13", "Dm11", "A7#9"]) {
      for (const voicing of generateVoicings(guitar, name)) {
        const used = new Set(voicing.fingers!.filter((n) => n !== null));
        expect(used.size, name).toBeLessThanOrEqual(4);
        voicing.frets.forEach((fret, i) =>
          expect(voicing.fingers![i] === null, `${name} ${i}`).toBe(!fret),
        );
      }
    }
  });

  it("takes a define's own fingers, and has none when it gives none", () => {
    const withFingers = parse(
      "{define: Bm base-fret 2 frets x 1 3 3 2 1 fingers x 1 3 4 2 1}\n[Bm]x",
    );
    expect(defineVoicing(withFingers.defines.Bm, 6)?.fingers).toEqual([null, 1, 3, 4, 2, 1]);
    const without = parse("{define: Am7 base-fret 1 frets x 0 2 0 1 0}\n[Am7]x");
    expect(defineVoicing(without.defines.Am7, 6)?.fingers).toBeUndefined();
  });
});

describe("moving defines", () => {
  const { defines } = parse(
    "{define: Bm base-fret 2 frets x 1 3 3 2 1}\n{define: Am7 base-fret 1 frets x 0 2 0 1 0}\n[Bm]x",
  );

  it("slides a shape with no open strings up the neck", () => {
    const moved = moveDefine(defines.Bm, 2)!;
    expect(moved.frets).toEqual([null, 4, 6, 6, 5, 4]);
  });

  it("takes the nearest position, down if need be", () => {
    expect(moveDefine(defines.Bm, 11)!.frets).toEqual([null, 1, 3, 3, 2, 1]);
    expect(moveDefine(defines.Bm, -1)!.frets).toEqual([null, 1, 3, 3, 2, 1]);
    // Down would run off the nut, so it goes up.
    expect(moveDefine(defines.Bm, -3)!.frets).toEqual([null, 2 + 9, 4 + 9, 4 + 9, 3 + 9, 2 + 9]);
  });

  it("leaves a shape with open strings where it is", () => {
    expect(moveDefine(defines.Am7, 2)).toBeNull();
    expect(moveDefine(defines.Am7, 12)).toBe(defines.Am7);
  });

  it("is offered under the transposed name", () => {
    const shown = movedDefines(defines, 2, false);
    expect(Object.keys(shown)).toEqual(["C#m"]);
    const list = voicingsFor("C#m", guitar, shown);
    expect(list[0].source).toBe("define");
    expect(list[0].frets).toEqual([null, 4, 6, 6, 5, 4]);
    expect(voicingsFor("Dm", guitar, shown)[0].source).toBe("generated");
  });

  it("matches the same chord spelled another way", () => {
    const shown = movedDefines(defines, 11, true);
    expect(Object.keys(shown)).toEqual(["Bbm"]);
    expect(voicingsFor("A#m", guitar, shown)[0].source).toBe("define");
    expect(voicingsFor("Cm", guitar, shown)[0].source).toBe("generated");
  });
});
