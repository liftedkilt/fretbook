// Writes the synthesized WAV fixtures and their ground truth for the pitch-detection harness.
//   cd web && npx vite-node scripts/make-listen-fixtures.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { FIXTURES, FIXTURE_SAMPLE_RATE, renderScenario } from "../src/lib/listen/harness/scenarios";
import { encodeWav } from "../src/lib/listen/harness/wav";

const dir = fileURLToPath(new URL("../src/lib/listen/fixtures/", import.meta.url));
mkdirSync(dir, { recursive: true });
for (const fixture of FIXTURES) {
  const wav = encodeWav(renderScenario(fixture, FIXTURE_SAMPLE_RATE, 11), FIXTURE_SAMPLE_RATE);
  writeFileSync(`${dir}${fixture.name}.wav`, wav);
  const truth = {
    instrument: fixture.instrument,
    sampleRate: FIXTURE_SAMPLE_RATE,
    notes: fixture.notes,
  };
  writeFileSync(`${dir}${fixture.name}.json`, JSON.stringify(truth, null, 1) + "\n");
  console.log(fixture.name, wav.length, "bytes");
}
