// Writes tests/fixtures/corpus/gp/riff.gp (Guitar Pro 7/8) from riff.gp5 with alphaTab's exporter.
//   node web/scripts/generate-gp7.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as alphaTab from "@coderline/alphatab";

const dir = fileURLToPath(new URL("../../tests/fixtures/corpus/gp/", import.meta.url));
const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(
  new Uint8Array(readFileSync(dir + "riff.gp5")),
);
const bytes = new alphaTab.exporter.Gp7Exporter().export(score, new alphaTab.Settings());
writeFileSync(dir + "riff.gp", bytes);
console.log("wrote riff.gp", bytes.length, "bytes");
