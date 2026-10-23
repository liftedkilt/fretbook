# Pitch-detection fixtures

Synthesized bass and guitar riffs (an additive plucked-string model, see `../harness/synth.ts`) with a little background noise, so there is no copyrighted material. Each `.json` file lists the true notes (`midi`, `start` and `duration` in seconds, `legato` for hammer-ons and pull-offs). Regenerate both with:

```sh
cd web && npx vite-node scripts/make-listen-fixtures.ts
```

Real recordings are welcome: add a 16-bit PCM mono `.wav` and a `.json` next to it in the same shape, and list the name in `../harness/accuracy.test.ts`.
