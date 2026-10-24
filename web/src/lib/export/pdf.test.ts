// @ts-nocheck -- Vitest reads the music font and inflates PDF streams with Node APIs. The app tsconfig only types the browser.
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import type { Beat, ScoreDocument, Track } from "../types";
import { paginate } from "./layout";
import { contentHeight, renderChordSheetPdf, renderTrackPdf, type TrackPdf } from "./pdf";

const bravura = new Uint8Array(
  readFileSync(
    new URL("../../../node_modules/@coderline/alphatab/dist/font/Bravura.otf", import.meta.url),
  ),
);

function inflate(data: Uint8Array): Uint8Array {
  const trimmed =
    data[data.length - 1] === 10 || data[data.length - 1] === 13 ? data.subarray(0, -1) : data;
  try {
    return inflateSync(trimmed);
  } catch {
    return inflateSync(data);
  }
}

function latin1(data: Uint8Array): string {
  let text = "";
  for (const byte of data) text += String.fromCharCode(byte);
  return text;
}

function quarters(spec: (number | number[])[]): Beat[] {
  return spec.map((frets, index) => ({
    position: index * 960,
    duration: 960,
    notes: (Array.isArray(frets) ? frets : [frets])
      .filter((fret) => fret >= 0)
      .map((fret, string) => ({ string, fret })),
  }));
}

function song(tracks: Track[]): ScoreDocument {
  return {
    version: 1,
    bpm: 96,
    bars: tracks[0].bars.map(() => ({ signature: [4, 4] as [number, number] })),
    sync: { video_id: null, points: [], anchors: {} },
    tracks,
  };
}

function makeTrack(
  id: string,
  name: string,
  instrument: string,
  tuning: number[],
  bars: Beat[][],
): Track {
  return {
    id,
    name,
    instrument,
    capo: 0,
    tuning_midi: tuning,
    preferred: id === "bass",
    bars: bars.map((beats) => ({ voices: [{ beats }] })),
  };
}

/** Repeating bars, with a hammer, a slide, and a two-note chord in the first. */
function bars(count: number, strings: number): Beat[][] {
  const pattern = [12, 0, 3, 5];
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) {
      return [
        { position: 0, duration: 960, notes: [{ string: 0, fret: 3, hammer: true }] },
        { position: 960, duration: 960, notes: [{ string: 0, fret: 5, slide: "shift" }] },
        {
          position: 1920,
          duration: 960,
          notes: [
            { string: 0, fret: 12 },
            { string: Math.min(1, strings - 1), fret: 7 },
          ],
        },
        {
          position: 2880,
          duration: 960,
          notes: strings > 4 ? [{ string: strings - 1, fret: 0 }] : [],
        },
      ];
    }
    return quarters(pattern.map((fret) => (fret + index) % 13));
  });
}

/** Visible page text. pdf-lib stores it as hex strings of WinAnsi bytes. */
async function pdfText(bytes: Uint8Array): Promise<string> {
  const source = latin1(bytes);
  const parts = [source];
  let cursor = 0;
  while (cursor < source.length) {
    const marker = source.indexOf("stream", cursor);
    // "endstream" contains the letters "stream"; only a real stream keyword counts.
    if (marker < 0) break;
    if (source[marker - 1] === "d") {
      cursor = marker + 6;
      continue;
    }
    let start = marker + "stream".length;
    if (source[start] === "\r") start += 1;
    if (source[start] === "\n") start += 1;
    const end = source.indexOf("endstream", start);
    if (end < 0) break;
    const data = bytes.subarray(start, end);
    try {
      parts.push(latin1(inflate(data)));
    } catch {
      parts.push(latin1(data));
    }
    cursor = end + "endstream".length;
  }
  const markup = parts.join("\n");
  const visible: string[] = [];
  for (const match of markup.matchAll(/<([0-9A-Fa-f]{4,})>/g)) {
    const hex = match[1];
    if (hex.length % 2) continue;
    let text = "";
    for (let index = 0; index < hex.length; index += 2) {
      const code = Number.parseInt(hex.slice(index, index + 2), 16);
      text += code >= 32 && code < 127 ? String.fromCharCode(code) : "\n";
    }
    if (text.trim()) visible.push(text);
  }
  const curves = markup.match(/(?:^|\s)c(?:\s|$)/g)?.length ?? 0;
  return { text: visible.join("\n"), curves };
}

function assertPage(result: TrackPdf, plain: string, curves: number, title: string): void {
  expect(latin1(result.bytes.subarray(0, 5))).toBe("%PDF-");
  // Music is outlines, so the broken Bravura subset is not in the file.
  const raw = latin1(result.bytes);
  expect(raw).not.toContain("Bravura");
  expect(raw).not.toContain("/FontFile");
  expect(curves).toBeGreaterThan(100);
  expect(plain.split(title).length - 1).toBeGreaterThanOrEqual(result.pageCount);
  expect(result.pageCount).toBeGreaterThan(1);
  expect(result.systems.length).toBeGreaterThan(1);
  for (const system of result.systems) {
    const hits = result.pages.filter(
      (page) => system.y >= page.top - 2 && system.y + system.height <= page.bottom + 2,
    );
    expect(hits).toHaveLength(1);
  }
}

describe("paginate", () => {
  it("breaks between systems and scales one that is taller than the page", () => {
    const chunks = [0, 200, 400, 600].map((y) => ({ y, height: 200 }));
    const pages = paginate(chunks, chunks, 500);
    expect(pages.map((page) => [page.top, page.bottom])).toEqual([
      [0, 400],
      [400, 800],
    ]);
    expect(pages.every((page) => page.scale === 1)).toBe(true);

    const tall = paginate([{ y: 0, height: 1000 }], [{ y: 0, height: 1000 }], 250);
    expect(tall).toHaveLength(1);
    expect(tall[0].scale).toBeCloseTo(0.25);

    const withLabel = paginate(
      [
        { y: 0, height: 20 },
        { y: 20, height: 200 },
      ],
      [{ y: 20, height: 200 }],
      500,
    );
    expect(withLabel).toHaveLength(1);
    expect(withLabel[0].items).toHaveLength(2);
  });
});

describe("renderTrackPdf", () => {
  it("paginates a 4-string bass track with the song tuning in the header", async () => {
    const tuning = [43, 38, 33, 28];
    const document = song([makeTrack("bass", "Bass", "bass-guitar", tuning, bars(24, 4))]);
    const result = await renderTrackPdf({
      document,
      trackId: "bass",
      title: "Four String",
      artist: "Ada",
      bravura,
    });
    const decoded = await pdfText(result.bytes);
    const plain = decoded.text;
    const loaded = await PDFDocument.load(result.bytes);
    expect(loaded.getPageCount()).toBe(result.pageCount);
    expect(result.tuning).toEqual(tuning);
    expect(plain).toContain("Four String");
    expect(plain).toContain("Ada");
    expect(plain).toContain("Bass");
    expect(plain).toContain("G2 D2 A1 E1");
    expect(plain).toContain("12");
    assertPage(result, plain, decoded.curves, "Four String");
  });

  it("paginates a 5-string bass track using the low B from the song", async () => {
    const tuning = [43, 38, 33, 28, 23];
    const document = song([makeTrack("low-b", "Low B", "bass-guitar", tuning, bars(24, 5))]);
    const result = await renderTrackPdf({
      document,
      trackId: "low-b",
      title: "Five String",
      artist: "Bea",
      bravura,
    });
    const decoded = await pdfText(result.bytes);
    const plain = decoded.text;
    expect(result.tuning).toEqual(tuning);
    expect(result.tuning).toHaveLength(5);
    expect(plain).toContain("Five String");
    expect(plain).toContain("Low B");
    expect(plain).toContain("G2 D2 A1 E1 B0");
    assertPage(result, plain, decoded.curves, "Five String");
  });

  it("paginates a 6-string guitar track using that track's tuning", async () => {
    const bassTuning = [43, 38, 33, 28];
    const guitarTuning = [64, 59, 55, 50, 45, 40];
    const count = 24;
    const document = song([
      makeTrack("bass", "Bass", "bass-guitar", bassTuning, bars(count, 4)),
      makeTrack("guitar", "Guitar", "guitar", guitarTuning, bars(count, 6)),
    ]);
    const guitar = await renderTrackPdf({
      document,
      trackId: "guitar",
      title: "Six String",
      artist: "Cy",
      capoLabel: "Capo 2",
      bravura,
    });
    const bass = await renderTrackPdf({
      document,
      trackId: "bass",
      title: "Six String",
      artist: "Cy",
      bravura,
    });
    const guitarDecoded = await pdfText(guitar.bytes);
    const bassDecoded = await pdfText(bass.bytes);
    const guitarText = guitarDecoded.text;
    const bassText = bassDecoded.text;
    expect(guitar.tuning).toEqual(guitarTuning);
    expect(guitar.tuning).toHaveLength(6);
    expect(guitarText).toContain("E4 B3 G3 D3 A2 E2");
    expect(guitarText).toContain("Guitar");
    expect(guitarText).toContain("Capo 2");
    expect(guitarText).not.toContain("G2 D2 A1 E1");
    expect(bass.tuning).toEqual(bassTuning);
    expect(bassText).toContain("G2 D2 A1 E1");
    expect(bassText).not.toContain("E4 B3 G3 D3 A2 E2");
    assertPage(guitar, guitarText, guitarDecoded.curves, "Six String");
    assertPage(bass, bassText, bassDecoded.curves, "Six String");
  });
});

describe("renderChordSheetPdf", () => {
  it("paginates a transposed chord sheet with the title on every page", async () => {
    const body = Array.from(
      { length: 40 },
      (_, index) => `[F#m7]Line ${index} keeps its chord`,
    ).join("\n");
    const result = await renderChordSheetPdf({
      chordpro: `{comment: Intro}\n${body}`,
      title: "Campfire",
      artist: "Ada",
      transpose: 1,
    });
    const plain = (await pdfText(result.bytes)).text;
    const loaded = await PDFDocument.load(result.bytes);
    expect(loaded.getPageCount()).toBe(result.pageCount);
    expect(result.pageCount).toBeGreaterThan(1);
    expect(plain.split("Campfire").length - 1).toBeGreaterThanOrEqual(result.pageCount);
    expect(plain).toContain("Ada");
    expect(plain).toContain("Gm7");
    expect(plain).not.toContain("F#m7");
    expect(contentHeight()).toBeGreaterThan(600);
  });

  it("prints the chosen chord diagrams under the header", async () => {
    const frets = [null, 3, 2, 0, 1, 0];
    const diagrams = {
      strings: 6,
      capo: 2,
      chords: [
        { name: "C", voicing: { frets, baseFret: 1, barre: null, source: "generated" as const } },
        {
          name: "F",
          voicing: {
            frets: [1, 3, 3, 2, 1, 1],
            baseFret: 1,
            barre: { fret: 1, from: 0, to: 5 },
            source: "generated" as const,
          },
        },
        {
          name: "Bm",
          voicing: {
            frets: [null, 2, 4, 4, 3, 2],
            baseFret: 2,
            barre: { fret: 2, from: 1, to: 5 },
            source: "generated" as const,
          },
        },
        {
          name: "Am",
          voicing: {
            frets: [null, 0, 2, 2, 1, 0],
            baseFret: 1,
            barre: null,
            source: "generated" as const,
          },
        },
      ],
    };
    const input = { chordpro: "[C]Hello [F]world", title: "Diagrams", artist: "Ada" };
    const plain = await renderChordSheetPdf(input);
    const withDiagrams = await renderChordSheetPdf({ ...input, diagrams });
    const text = (await pdfText(withDiagrams.bytes)).text;
    expect(text).toContain("Capo 2");
    expect(text).toContain("Bm");
    expect(withDiagrams.bytes.length).toBeGreaterThan(plain.bytes.length);
    const none = await renderChordSheetPdf({ ...input, diagrams: { ...diagrams, chords: [] } });
    expect(none.bytes.length).toBe(plain.bytes.length);
    const many = await renderChordSheetPdf({
      ...input,
      diagrams: {
        ...diagrams,
        capo: 0,
        chords: Array.from({ length: 80 }, () => diagrams.chords[0]),
      },
    });
    expect(many.pageCount).toBeGreaterThan(1);
    expect((await pdfText(many.bytes)).text).not.toContain("Capo");
  });
});
