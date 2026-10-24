import { describe, expect, it } from "vitest";

import { parse } from "../chordpro";
import { buildEntries } from "./entries";
import { DIAGRAM_ROWS, describeFrets, diagramGeometry } from "./layout";
import { CHORD_INSTRUMENTS, resolveSetup } from "./instruments";
import { capoOf, chordsUsed } from "./used";
import { generateVoicings, physicalTuning } from "./voicings";

const SHEET = "{capo: 2}\n[C]Hello [G]world [N.C.]\n[Am]Bye [C]moon [x2]";

describe("chordsUsed", () => {
  it("lists each drawable chord once, in order, transposed", () => {
    const sheet = parse(SHEET);
    expect(chordsUsed(sheet, 0, false)).toEqual(["C", "G", "Am"]);
    expect(chordsUsed(sheet, 2, false)).toEqual(["D", "A", "Bm"]);
    expect(chordsUsed(sheet, 1, true)).toEqual(["Db", "Ab", "Bbm"]);
  });

  it("reads the capo", () => {
    expect(capoOf(parse(SHEET))).toBe(2);
    expect(capoOf(parse("[C]x"))).toBe(0);
    expect(capoOf(parse("{capo: 99}\n[C]x"))).toBe(0);
    expect(capoOf(parse("{capo: two}\n[C]x"))).toBe(0);
  });
});

describe("buildEntries", () => {
  const tuning = physicalTuning([64, 59, 55, 50, 45, 40]);

  it("picks the remembered voicing or the first", () => {
    const [second] = generateVoicings(tuning, "C").slice(1);
    const key = second.frets.map((fret) => fret ?? "x").join(".");
    const [c, g] = buildEntries(["C", "G"], tuning, true, {}, { C: key });
    expect(c.index).toBe(1);
    expect(c.voicing?.frets).toEqual(second.frets);
    expect(g.index).toBe(0);
  });

  it("has no voicing for an impossible chord", () => {
    const [entry] = buildEntries(["C"], [40, 45], true, {}, {});
    expect(entry).toMatchObject({ voicing: null, voicings: [], index: 0 });
  });
});

describe("diagramGeometry", () => {
  it("lists dots, opens and mutes, with the barre taken out of the dots", () => {
    const [f] = generateVoicings(physicalTuning([64, 59, 55, 50, 45, 40]), "F");
    const geometry = diagramGeometry(f, 6);
    expect(geometry.rows).toBe(DIAGRAM_ROWS);
    expect(geometry.barre).toMatchObject({ row: 0, from: 0, to: 5 });
    expect(geometry.dots.map((dot) => dot.string)).toEqual([1, 2, 3]);
    const [c] = generateVoicings(physicalTuning([64, 59, 55, 50, 45, 40]), "C");
    const open = diagramGeometry(c, 6);
    expect(open.muted).toEqual([0]);
    expect(open.open).toEqual([3, 5]);
    expect(open.barre).toBeNull();
    expect(describeFrets(c)).toBe("x 3 2 0 1 0");
  });
});

describe("instruments", () => {
  it("lists guitar, ukulele and bass with real tunings only", () => {
    expect(CHORD_INSTRUMENTS.map((item) => item.id)).toEqual(["guitar6", "bass4", "ukulele"]);
    for (const instrument of CHORD_INSTRUMENTS) {
      for (const tuning of instrument.tunings) expect(tuning.strings.length).toBeGreaterThan(3);
    }
    expect(CHORD_INSTRUMENTS[0].tunings[0].strings).toEqual([40, 45, 50, 55, 59, 64]);
  });

  it("falls back to guitar in standard", () => {
    expect(resolveSetup("nope", "nope")).toMatchObject({
      instrument: { id: "guitar6" },
      tuning: { id: "standard" },
    });
    expect(resolveSetup("ukulele", "")).toMatchObject({
      instrument: { id: "ukulele" },
      tuning: { id: "standard" },
    });
    expect(resolveSetup("ukulele", "lowG").tuning.id).toBe("lowG");
  });
});
