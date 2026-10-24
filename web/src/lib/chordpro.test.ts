import { describe, expect, it } from "vitest";

import { parse, parseDefine, parseLyrics, transposeChord } from "./chordpro";

describe("chordpro", () => {
  it("splits a lyric line into chord segments", () => {
    expect(parseLyrics("[Em7]Today is go[G]nna be")).toEqual([
      { chord: "Em7", text: "Today is go" },
      { chord: "G", text: "nna be" },
    ]);
    expect(parseLyrics("Lead in [C]here")).toEqual([
      { chord: null, text: "Lead in " },
      { chord: "C", text: "here" },
    ]);
    expect(parseLyrics("[C] [D]")).toEqual([
      { chord: "C", text: " " },
      { chord: "D", text: "" },
    ]);
  });

  it("reads metadata, comments, and sections", () => {
    const sheet = parse(
      "{title: Song}\n{st: Someone}\n{c: Intro}\n[G]Hi\n\n{soc}\n[C]La\n{eoc}\n{sot}\ne|--3--|\n{eot}\n",
    );
    expect(sheet.meta).toMatchObject({ title: "Song", artist: "Someone" });
    expect(sheet.blocks.map((block) => block.kind)).toEqual(["", "chorus", "tab"]);
    expect(sheet.blocks[0].lines[0]).toEqual({ kind: "comment", text: "Intro" });
    expect(sheet.blocks[2].lines[0]).toEqual({ kind: "tab", text: "e|--3--|" });
  });

  it("leaves a bare chorus marker for the view to name", () => {
    const sheet = parse("{chorus}\n{chorus: Special}\n");
    const labels = sheet.blocks.flatMap((block) =>
      block.lines.flatMap((line) => (line.kind === "section" ? [line.label] : [])),
    );
    expect(labels).toEqual(["", "Special"]);
  });

  it("transposes chords and slash basses", () => {
    expect(transposeChord("G", 2)).toBe("A");
    expect(transposeChord("Em7", -2)).toBe("Dm7");
    expect(transposeChord("D/F#", 1)).toBe("D#/G");
    expect(transposeChord("Bb", 2)).toBe("C");
    expect(transposeChord("Bb", 1)).toBe("B");
    expect(transposeChord("Eb", 1)).toBe("E");
    expect(transposeChord("N.C.", 3)).toBe("N.C.");
  });
});

describe("{define:}", () => {
  it("reads base-fret and frets, lowest string first", () => {
    expect(parseDefine("Am base-fret 1 frets x 0 2 2 1 0")).toEqual({
      name: "Am",
      baseFret: 1,
      frets: [null, 0, 2, 2, 1, 0],
    });
  });

  it("counts frets from the base fret and ignores fingers", () => {
    expect(parseDefine("Bm base-fret 2 frets x 1 3 3 2 1 fingers x 1 3 4 2 1")).toEqual({
      name: "Bm",
      baseFret: 2,
      frets: [null, 2, 4, 4, 3, 2],
    });
  });

  it("reads the older form, and - as a mute", () => {
    expect(parseDefine("G 1 3 2 0 0 0 3")?.frets).toEqual([3, 2, 0, 0, 0, 3]);
    expect(parseDefine("C frets - 3 2 0 1 0")?.frets).toEqual([null, 3, 2, 0, 1, 0]);
    expect(parseDefine("C base-fret 1 frets x 3 2 0 1 0 display C")?.frets).toHaveLength(6);
  });

  it("refuses anything that is not a fingering", () => {
    for (const value of [
      "",
      "Am",
      "Am copy Em",
      "H base-fret 1 frets 0 0 0 0",
      "Am base-fret 0 frets 0 0 0 0",
      "Am base-fret 1 frets 0 0",
      "Am base-fret 1 frets 0 0 0 q",
      "Am 40 0 0 0 0",
    ]) {
      expect(parseDefine(value)).toBeNull();
    }
  });

  it("is collected by parse, the first definition winning, and is not shown", () => {
    const sheet = parse(
      "{define: Am base-fret 1 frets x 0 2 2 1 0}\n{define: Am base-fret 1 frets 0 0 0 0 0 0}\n{define: junk}\n[Am]Hi",
    );
    expect(Object.keys(sheet.defines)).toEqual(["Am"]);
    expect(sheet.defines.Am.frets).toEqual([null, 0, 2, 2, 1, 0]);
    expect(sheet.blocks.flatMap((block) => block.lines)).toHaveLength(1);
  });
});
