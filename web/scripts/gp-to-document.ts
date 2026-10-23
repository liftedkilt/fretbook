// Reads a Guitar Pro file on the server: bytes -> alphaTab -> Fretbook document, the same
// conversion the browser does (src/lib/alphatab/convert.ts). The Python importer runs the bundled
// build of this file with Node and reads one JSON object from stdout.
//
//   npm run build:gp-cli && node dist-gp/gp-to-document.mjs <file> [bass|guitar]
//
// Success: {"title", "artist", "document"}. Failure: {"error": {"key", "message"}} and exit code 1.
import { readFileSync } from "node:fs";

import * as alphaTab from "@coderline/alphatab";

import { choosePreferred, scoreToDocument } from "../src/lib/alphatab/convert";

const NO_FRETTED = "This file has no fretted tracks.";

function fail(key: string, message: string): never {
  process.stdout.write(JSON.stringify({ error: { key, message } }));
  process.exit(1);
}

const [path, prefer] = process.argv.slice(2);
if (!path) fail("import.guitarProUnreadable", "usage: gp-to-document <file> [bass|guitar]");

try {
  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(
    new Uint8Array(readFileSync(path)),
  );
  const parsed = scoreToDocument(score, {
    // The server keeps no UI language; an empty title falls back to the file name in Python.
    untitled: "",
    untitledTrack: (number) => `Track ${number}`,
    noFrettedTracks: NO_FRETTED,
  });
  choosePreferred(parsed.document, prefer === "bass" || prefer === "guitar" ? prefer : null);
  process.stdout.write(JSON.stringify(parsed));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  fail(
    message === NO_FRETTED ? "import.guitarProNoFretted" : "import.guitarProUnreadable",
    message,
  );
}
