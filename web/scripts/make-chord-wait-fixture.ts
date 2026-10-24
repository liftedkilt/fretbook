// Writes the audio the fake microphone plays in the chord wait mode end-to-end test: a strummed C
// major chord, then a strummed G major chord, on a synthesized guitar.
//   cd web && npx vite-node scripts/make-chord-wait-fixture.ts
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderStrum } from "../src/lib/listen/harness/synth";
import { encodeWav } from "../src/lib/listen/harness/wav";

const sampleRate = 44100;
const seconds = 4.4;
const C = [48, 52, 55, 60, 64];
const G = [43, 47, 50, 55, 59, 67];
const strums = [
  { midis: C, start: 0.3 },
  { midis: G, start: 2.3 },
];
const samples = new Float32Array(Math.ceil(seconds * sampleRate));
for (const { midis, start } of strums) {
  const strum = renderStrum(midis, start, seconds, {
    sampleRate,
    instrument: "guitar",
    duration: 1.5,
  });
  for (let i = 0; i < samples.length; i++) samples[i] += strum[i];
}
const out = fileURLToPath(new URL("../../tests/fixtures/e2e/chords-played.wav", import.meta.url));
writeFileSync(out, encodeWav(samples, sampleRate));
console.log(out, samples.length / sampleRate, "s");
