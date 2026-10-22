import { describe, expect, it } from "vitest";

import { parse, parseLyrics, transposeChord } from "./chordpro";

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
    const sheet = parse("{title: Song}\n{st: Someone}\n{c: Intro}\n[G]Hi\n\n{soc}\n[C]La\n{eoc}\n{sot}\ne|--3--|\n{eot}\n");
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
