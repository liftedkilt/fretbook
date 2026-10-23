// Writes the audio the fake microphone plays in the wait mode end-to-end test: the notes of
// tests/fixtures/e2e/practice-riff.musicxml, one every 0.7 s, on a synthesized bass.
//   cd web && npx vite-node scripts/make-wait-fixture.ts
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderNotes } from "../src/lib/listen/harness/synth";
import { encodeWav } from "../src/lib/listen/harness/wav";

const sampleRate = 22050;
// E1 G1 A1 G1 | E1 B1 | A1 | E1
const riff = [28, 31, 33, 31, 28, 35, 33, 28];
const spacing = 0.7;
const notes = riff.map((midi, index) => ({ midi, start: 0.2 + index * spacing, duration: 0.5 }));
const samples = renderNotes(notes, 0.2 + riff.length * spacing, {
  sampleRate,
  instrument: "bass",
  seed: 7,
});
const out = fileURLToPath(
  new URL("../../tests/fixtures/e2e/practice-riff-played.wav", import.meta.url),
);
writeFileSync(out, encodeWav(samples, sampleRate));
console.log(out, samples.length / sampleRate, "s");
