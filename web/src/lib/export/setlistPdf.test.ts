// @ts-nocheck -- Vitest reads the music font with Node APIs. The app tsconfig only types the browser.
import { readFileSync } from "node:fs";

import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import type { SongDetail } from "../types";
import { renderSetlistPdf, type SetlistPdfEntry } from "./setlistPdf";

const bravura = new Uint8Array(
  readFileSync(
    new URL("../../../node_modules/@coderline/alphatab/dist/font/Bravura.otf", import.meta.url),
  ),
);

const labels = { contents: "Contents", transpose: (n: number) => `Transpose ${n}` };
const capoLabel = (fret: number) => `Capo ${fret}`;

function chords(title: string, lines = 2): SetlistPdfEntry["song"] {
  return {
    id: title,
    title,
    artist: "Ada",
    content_kind: "chords",
    chordpro: Array.from({ length: lines }, (_, i) => `[C]Line ${i} of ${title}`).join("\n"),
    document: null,
  } as SongDetail;
}

function tab(title: string): SongDetail {
  const beats = [0, 960, 1920, 2880].map((position, string) => ({
    position,
    duration: 960,
    notes: [{ string: string % 4, fret: position / 960 + 1 }],
  }));
  return {
    id: title,
    title,
    artist: "Bo",
    content_kind: "tab",
    chordpro: null,
    document: {
      version: 1,
      bpm: 100,
      bars: [{ signature: [4, 4] }],
      sync: { video_id: null, points: [], anchors: {} },
      tracks: [
        {
          id: "bass",
          name: "Bass",
          instrument: "Bass",
          capo: 2,
          tuning_midi: [43, 38, 33, 28],
          preferred: true,
          bars: [{ voices: [{ beats }] }],
        },
      ],
    },
  } as SongDetail;
}

describe("renderSetlistPdf", () => {
  it("puts a contents page in front of every song, in order", async () => {
    const entries = [
      { song: chords("Alpha"), note: "capo 3", transpose: 2 },
      { song: chords("Bravo", 60), note: "", transpose: 0 },
      { song: chords("Alpha"), note: "skip solo", transpose: 0 },
    ];
    const result = await renderSetlistPdf({ name: "Friday", entries, labels, capoLabel });
    const loaded = await PDFDocument.load(result.bytes);
    expect(loaded.getPageCount()).toBe(result.pageCount);
    expect(loaded.getTitle()).toBe("Friday");
    // One contents page, one page each for the short songs, several for the long one.
    expect(result.pageCount).toBeGreaterThanOrEqual(5);
  });

  it("starts the contents on page 1 and the first song after it", async () => {
    const one = await renderSetlistPdf({
      name: "Solo",
      entries: [{ song: chords("Only"), note: "", transpose: 0 }],
      labels,
      capoLabel,
    });
    expect(one.pageCount).toBe(2);
  });

  it("adds a second contents page when the list is long", async () => {
    const entries = Array.from({ length: 70 }, (_, i) => ({
      song: chords(`Song ${i}`, 1),
      note: "a note",
      transpose: 1,
    }));
    const result = await renderSetlistPdf({ name: "Long", entries, labels, capoLabel });
    expect(result.pageCount).toBeGreaterThan(71);
  });

  it("renders a tab beside a chord sheet and needs the music font for it", async () => {
    const entries = [
      { song: tab("Riff"), note: "", transpose: 0 },
      { song: chords("Song"), note: "", transpose: 0 },
    ];
    const result = await renderSetlistPdf({ name: "Mixed", entries, bravura, labels, capoLabel });
    expect(result.pageCount).toBe(3);
    await expect(renderSetlistPdf({ name: "Mixed", entries, labels, capoLabel })).rejects.toThrow();
  });

  it("makes a contents-only file for an empty setlist", async () => {
    const result = await renderSetlistPdf({ name: "Empty", entries: [], labels, capoLabel });
    expect(result.pageCount).toBe(1);
  });
});
