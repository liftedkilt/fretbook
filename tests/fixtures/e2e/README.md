# End-to-end fixtures

Small songs the Playwright suite in `web/e2e/` loads into a throwaway server. All of them were written for this repository and are released under CC0; none is a copyrighted song.

| File | What it is |
| --- | --- |
| `practice-riff.musicxml` | A four-bar bass tab in MusicXML, uploaded through the UI. |
| `sunny-chords.cho` | A ChordPro chord sheet with a verse and a chorus. |
| `synced-groove.json` | A Fretbook JSON export of a four-bar bass tab with published sync points (one second per bar). |
| `click-track.wav` | Four seconds of a quiet 220 Hz tone (8 kHz mono, 32 KB), uploaded as the audio for the synced song. |
| `practice-riff-played.wav` | The notes of `practice-riff.musicxml` played on a synthesized bass, 0.7 s apart (22 kHz mono, 250 KB). The fake microphone in `wait-mode.spec.ts` plays it. Regenerate with `cd web && npx vite-node scripts/make-wait-fixture.ts`. |
