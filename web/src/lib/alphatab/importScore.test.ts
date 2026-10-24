import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { documentFromGuitarPro } from "./importScore";
import type { ScoreDocument } from "../types";

// Golden test for the browser-side Guitar Pro path: bytes -> alphaTab -> Fretbook document.
// Regenerate the snapshots after an intended change with `UPDATE_GOLDEN=1 npm test`.

const corpus = fileURLToPath(new URL("../../../../tests/fixtures/corpus/", import.meta.url));
const FILES = ["riff.gp3", "riff.gp4", "riff.gp5", "riff.gp", "riff.gpx"];

function load(path: string): Uint8Array {
  return new Uint8Array(readFileSync(corpus + path));
}

function notes(document: ScoreDocument) {
  return document.tracks.map((track) => ({
    tuning: track.tuning_midi,
    bars: track.bars.map((bar) =>
      bar.voices.map((voice) =>
        voice.beats.map((beat) => [
          beat.position,
          beat.duration,
          beat.notes.map((note) => [note.string, note.fret]),
        ]),
      ),
    ),
  }));
}

describe("Guitar Pro corpus through alphaTab", () => {
  for (const file of FILES) {
    it(`${file} matches its snapshot`, async () => {
      const parsed = documentFromGuitarPro(load(`gp/${file}`), "bass");
      const actual = JSON.stringify(parsed, null, 2) + "\n";
      const snapshot = `${corpus}golden-web/gp__${file}.json`;
      if (process.env.UPDATE_GOLDEN) {
        const { mkdirSync, writeFileSync } = await import("node:fs");
        mkdirSync(`${corpus}golden-web`, { recursive: true });
        writeFileSync(snapshot, actual);
        return;
      }
      expect(actual).toBe(readFileSync(snapshot, "utf8"));
    });
  }

  it("reads the same notes from every Guitar Pro version", () => {
    const [first, ...rest] = FILES.map((file) =>
      notes(documentFromGuitarPro(load(`gp/${file}`)).document),
    );
    for (const other of rest) expect(other).toEqual(first);
  });

  it("reads the same notes as the MusicXML importer does for the same riff", () => {
    const xml = JSON.parse(
      readFileSync(`${corpus}golden/musicxml__riff.partwise.musicxml.json`, "utf8"),
    ).document as ScoreDocument;
    const gp = documentFromGuitarPro(load("gp/riff.gp5")).document;
    expect(notes(gp)).toEqual(notes(xml));
    expect(gp.bpm).toBe(xml.bpm);
  });
});
