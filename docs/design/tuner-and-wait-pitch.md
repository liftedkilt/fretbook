# Tuner and wait-mode pitch

Review only. This note explains why the tuner feels fragile next to a phone tuner, why wait mode misses notes the tuner would already be showing, and what to change. It does not change the detector.

The live path stays the browser engine in `web/src/lib/listen/`. A survey of off-the-shelf pitch libraries is in [Build vs buy](#build-vs-buy). None of them is the right first step. Fretbook is MIT-licensed; several otherwise attractive libraries are GPL or AGPL, and the permissive ones implement the same autocorrelation family we already ship, without wait mode's expected-note, attack, and chord rules.

Follow-up issues are listed at the end. Chord-overtone false passes are already [#386](https://github.com/liftedkilt/fretbook/issues/386) (PR [#400](https://github.com/liftedkilt/fretbook/pull/400)). Do not refile that.

## Current architecture

```
getUserMedia (echo cancellation, noise suppression, auto gain off)
  → AudioContext (latencyHint: "interactive")
  → AudioWorklet "fretbook-pitch"          processor.ts
       PitchEngine                         engine.ts
         spectral-flux onset               onset.ts   (~10 ms hop, ~43 ms frame at 48 kHz)
         McLeod pitch (MPM)                mpm.ts     one FFT autocorrelation per reading
         chroma, only when asked           chroma.ts  ~171 ms window, every 50 ms
  → PitchEvent { time, frequency, clarity, midi, cents, onset, onsetTime }
```

`startListening` (`input.ts`) is the only microphone entry. The worklet is a separate bundle (`processor?worker&url`). `PitchEngine` itself has no browser APIs, which is what the Vitest harness drives.

Callers, and what they turn on:

| Caller | Expected note | Chroma | Latency calibration | What it does with a `PitchEvent` |
| --- | --- | --- | --- | --- |
| Tuner (`Tuner.svelte`) | locked string, or the settled string in auto mode (`ExpectedNotePrior`, `strictOctave` off) | off | no | `PitchSmoother`, then nearest open string or chromatic note. Ignores `midi`, `cents`, and `onset`. Recomputes cents from `frequency` so the A4 slider needs no restart. |
| Wait mode (`WaitRun` → `WaitMatcher`) | `setExpectedMidi(midis[0])` on a single note; `null` on a chord or a dead note. `strictOctave` when "any octave" is off | on for chord steps only | no | Needs a fresh onset, then a matching pitch inside the settle window. |
| Scored play (`ScoredRun` → `Scorer`) | never | off | yes, but only the `default:default` localStorage pair | Maps `onsetTime` onto the song clock. Any one note of a chord. |
| Chord-sheet wait | same as wait mode | on | no | Same `WaitRun`. |
| Ear-training chords (`ChordAnswerMatcher`) | no | on | no | Own copy of the 80 ms early gate and a 1.2 s settle. |
| Fretboard trainer | no | off | no | `StableNote`: three identical MIDI readings in a row. |
| Rhythm trainer, calibration wizard | no | off | rhythm trainer uses `default:default` | Onset times only. |

### Shared detector settings

These are the constructor defaults. The tuner, wait mode, and scored play do not override them. `minFrequency` is accepted by `startListening` and never passed.

| Knob | Value | Where |
| --- | --- | --- |
| Lowest period searched | 25 Hz (was 28 Hz before [#403](https://github.com/liftedkilt/fretbook/issues/403)) | `PitchEngine` / `MpmDetector`. `maxLag = ceil(sampleRate / 25)`. |
| Analysis window | long: next power of two that holds 2.1 periods of that floor; short: 2048 samples, tried first (see below) | `windowSizeFor`. At 48 kHz that is 4096 samples, **85.3 ms**. At 44.1 kHz the same 4096 samples are 92.9 ms. |
| MPM peak rule | first NSDF peak at least `cutoff` (0.90) times the highest peak | `mpm.ts`. McLeod's Tartini UI used 0.93. A lower cutoff lets a harmonic qualify, and the first qualifying peak is the higher one. |
| Expected-note pull | a peak within 40 cents of the target may win if its NSDF height is at least half the strongest | Only when a caller has set an expected MIDI note. |
| Clarity gate | 0.70 to publish a pitch; 0.90 for the internal legato tracker | `engine.ts`. Both gates are shared. Wait mode does not add a third. |
| Silence | RMS below 0.003 (about −50 dBFS) publishes no pitch | No hysteresis, no high-pass, no input gain. |
| Pitch hop | 20 ms, aligned to the onset hop | |
| Onset | spectral flux, sensitivity 1.6, floor 1, refractory 60 ms, frame must be 12% louder than three hops earlier | `onset.ts`. A hammer-on can also synthesise an onset after three steady readings at clarity ≥ 0.9 on a **new pitch class**. An octave jump does not count (treated as a harmonic flip). The same note again never takes this path. |
| Onset timestamp | backdated by one hop plus a quarter of the onset frame | About 21 ms at 48 kHz. Scored play treats this timestamp as the attack. |
| Chroma | 8192 samples (171 ms at 48 kHz), energy from 90 Hz up, folded to 12 pitch classes | Fundamentals of the low bass strings are below 90 Hz on purpose; their harmonics are what get counted. |

`PitchSmoother` (`tuner.ts`) is **not** in the worklet. It is a 5-reading median on log frequency (about 100 ms at the 20 ms hop), a restart when the pitch jumps by more than 80 cents, and a 0.4 s hold through dropouts. `TuneTracker` then requires the chosen string to stay inside **±3 cents for 1 second**. The needle draws a ±1.5 cent dead zone, but the hold uses the raw cents, so the screen can read "0" while the hold has already reset. The needle clamps at ±50 cents.

Wait-mode defaults (`DEFAULT_WAIT_OPTIONS`):

| Knob | Value |
| --- | --- |
| Octave | any octave |
| Cents | ±40 |
| Settle after the attack | 0.3 s |
| Early grace | 0.08 s before `WaitMatcher.wait()` |
| Chord score | ≥ 0.6, checked until 1.2 s after the strum, and only on windows that start after the strum |

`since` is the time of the last pitch event the matcher has seen, not `AudioContext.currentTime` at the moment the cursor pauses. `playedBeatChanged` in `TabPlayer.svelte` is what calls `WaitRun.reach`.

### How a phone tuner usually behaves

This is the usual shape of a clip-on or phone tuner (autocorrelation family, not a product measurement). It is the yardstick for the gaps below.

- The detector is YIN, MPM, or another autocorrelation. A raw FFT peak is the approach they grew out of, because a weak bass fundamental and a strong second harmonic then read an octave high. We are already in the right family.
- The window is long only while the candidate period is long. A guitar E4 does not need an 85 ms buffer.
- A high-pass (often somewhere near 20–40 Hz, higher in guitar-only modes) sits in front of the autocorrelation so rumble and DC do not flatten the NSDF.
- Level gating has hysteresis: a note is allowed to decay without the reading flickering off.
- The display median or exponential smooth is long once a note is locked, and the green zone is several cents wide (commonly on the order of ±5 to ±10), with the hold surviving a single outlier.
- Selecting a string restricts the search to that pitch and its near harmonics. The detector is not asked to be chromatic and then snapped to a string afterwards.
- A tuner does not wait for an onset. It tracks whatever is ringing. Attack detection belongs to a practice mode, and even there a missed transient can fall back to "the pitch became steady".
- AGC, noise suppression, and echo cancellation stay off, same as `audioConstraints`. Phone apps then turn the preamp up, or track a noise floor. We turn the processing off and leave the gate at a fixed −50 dBFS.

## Why it feels fragile

William's report matches the split in the table above. The tuner and wait mode hear the same worklet, then throw away different halves of the result.

### Confirmed from the code and the tests

**The tuner never tells MPM which string it is showing.** `Tuner.svelte` does not call `setExpectedMidi`. Locking a string only changes `centsFromString` on the main thread. `mpm.test.ts` ("prefers the expected note when the second harmonic dominates") is the case the tuner hits on a low string: fundamental amplitude 0.12, second harmonic amplitude 1. The test asserts the guided reading and does not assert the unguided one. Wait mode does send the expected note, and only for a single pitched step, and only `midis[0]` when several pitches would do.

**The window is one size, chosen for a 28 Hz floor.** That floor is just sharp of a 5-string drop A (MIDI 21, 27.5 Hz, in `INSTRUMENTS` / `PRESETS`). A period longer than `maxLag` cannot be chosen, so that open string comes back an octave up if it comes back at all. Low B (MIDI 23, 30.9 Hz) gets about 2.6 periods in the 85 ms window, which is the minimum MPM asked for, not a comfortable one, and the bass synth in `harness/synth.ts` deliberately weakens the fundamental below MIDI 40. Guitar E4 (329 Hz) gets about 28 periods in the same window, so the attack, the previous note, and the steady state are averaged together and the first clean reading cannot arrive before the window has slid (~85 ms, plus the 20 ms hop).

**Status after [#403](https://github.com/liftedkilt/fretbook/issues/403): the above is the problem as found; the engine now has two windows.** The search floor is 25 Hz, so MIDI 21 fits with margin. `PitchEngine` first runs MPM on the newest 2048 samples (~43 ms at 48 kHz) and accepts a clear reading of 75 Hz or more (when an expected note is set, only if it is also 75 Hz or more). A low, unclear or unreadable candidate falls through to the 4096-sample window, so only low strings pay its latency (the YIN `minFreq` idea). Cost: guitar pitches run one small FFT; low ones run two. Risk: a low note whose short window reads an octave high would be accepted; the harness bass cases (B0 to G3, with and without the expected note) show 0 octave errors, and the cutoff stays 0.90. The onset backdate formula is unchanged. On the synthesized harness drop A already read 27.4 Hz with the old floor (parabolic interpolation just reached it) and guitar steady-lock latency is 20 ms (one hop) both before and after, because synthetic notes have silent gaps; the smear benefit needs real recordings with ringing previous notes to show.

**Wait mode requires an onset. The tuner does not.** `WaitMatcher.push` returns false until an onset lands at or after `since - earlySeconds` (80 ms). A note that is already ringing does not count, including the same pitch on the next beat (`wait.test.ts`). The tuner's smoother holds the last frequency for 0.4 s and never looks at `onset`. So a soft repluck that fails `louderThanBefore` (needs +12% hop energy) or lands inside the 60 ms refractory gap moves the tuner needle and does not advance wait mode. The legato fallback cannot save a repeated note: it ignores both octave flips and the same pitch class.

**The 80 ms early gate is not the calibration.** Scored play subtracts `latencySeconds` inside `ScoredRun.toSong`. Wait mode does not read calibration at all. `TabPlayer` and the rhythm trainer call `getLocalCalibration("default", "default")` even when the calibration sheet stored a specific output/input pair (`fretbook.calibration.<output>:<input>`). An onset is also stamped ~21 ms earlier than the frame that confirmed it. A note played as the beat arrives, or a beat callback that lands late, is reported as "too early" and dropped. The practice guide already says the player must wait for the cursor to stop. That rule is load-bearing and easy to miss, and 80 ms is a short allowance for the callback and the backdate on top of it.

**Clarity is not the extra wait-mode gate.** Hypothesis rejected. Both paths see pitches that cleared 0.70. The 0.90 figure is only the engine's private legato tracker. What wait mode adds is the onset, the early cutoff, and a 0.3 s deadline after that onset. The tuner hides the same nulls and octave jumps with the median and the dropout hold.

**The in-tune rule is much tighter than the detector's jitter budget.** ±3 cents for a full second, reset on any single out-of-band reading, on top of a median only ~100 ms long. A plucked string's pitch wanders by more than that in the first part of the note. The harness allows a median error under 8 cents and still calls the detector healthy (`accuracy.test.ts`). A phone tuner paints a wide green zone and then sticks.

**A4 is tuner-local and starts at 440 every time.** `let a4 = $state(440)` is not stored. Wait and scored omit `a4`, so the engine uses `DEFAULT_A4`. 432 Hz is about −32 cents against 440, inside the ±40 cent wait tolerance only when the string is dead on 432. The tuner display follows the slider because it recomputes cents itself. Wait mode trusts `event.cents`.

**There is no high-pass and no gain.** Rumble and a DC offset go straight into the NSDF. With auto gain forced off (correct for cents; AGC pumps the level and moves the pitch), a quiet bass through a laptop mic sits on the 0.003 gate and drops out. The tuner holds those dropouts for 0.4 s. Wait mode, inside a 0.3 s settle window, treats them as "no pitch" and then says it heard nothing.

**Bleed.** Wait mode mutes the chosen track and, unless "silent backing" is on, plays the others through the speakers. The mic onsets those notes. A wrong onset arms the matcher; the player's real attack can fall inside that settle window or inside the 60 ms refractory gap. Scored play has `bleedSuspected` for a recording. Wait mode has the silent-backing switch defaulting off, and no warning. The tuner reference tone is a second `AudioContext` into the speakers while the mic session is open, and pitch events are still applied.

**The tests cannot see this.** `accuracy.test.ts` states that the thresholds guard the synth, not a real instrument. The synth's low bass still has a partial fundamental (0.35 times a rising harmonic slope) plus white noise at 0.002–0.004. The accuracy run does not pass an expected note, except one test that does and expects a perfect score. End-to-end wait and scored tests play a rendered WAV through Chromium's fake microphone (`web/e2e/wait-mode.spec.ts`, `scored-play.spec.ts`). `tuner.spec.ts` checks the headstock layout. All of that can stay green while a real low E through a laptop mic hunts.

### Still a hypothesis (mechanism is in the code, no real-mic measurement in this review)

- The 0.3 s settle window is short when the 85 ms buffer is still full of the previous note and the new bass fundamental is weak. A reading that arrives after 0.3 s discards the attack; the player has to pluck again. Plausible, not timed on a recording.
- Browser builds sometimes ignore `echoCancellation: false` / `noiseSuppression: false` / `autoGainControl: false`. We set them and do not verify the applied `getSettings()`. If a browser leaves AGC on, the level pumps and the cents hunt. Worth a one-line debug readout later, not a DSP rewrite.
- MPM cutoff 0.90 versus Tartini's 0.93 changes which harmonic wins when no expected note is set. Adjust it in the same change as the window, and only with a harness number, not by ear.

## Failure modes a player actually feels

| What they do | What they see | Why |
| --- | --- | --- |
| Pluck a low E or low B into the tuner | Needle pegs, jumps an octave, or lands on the wrong string and will not go green | Weak fundamental, 28 Hz lag limit, no string target, ±3 cent hold. Drop A is outside the lag limit, so the second harmonic can look like the A string an octave up. |
| Hold a string that is basically in tune | "Hold steady" forever, or the checkmark never sticks | One reading outside ±3 cents resets a 1 s hold. Display dead zone hides the cents that caused it. |
| Play the note as the wait cursor arrives | "Too early", cursor stays | 80 ms grace, ~21 ms onset backdate, beat callback after the audio beat. Documented, still the common case. |
| Pluck the same note again, softly, while it rings | Tuner moves; wait mode sits | No flux onset, legato path ignores the same pitch class. |
| Hammer-on that never reaches clarity 0.9 | Wait mode sits until a harder pluck | Legato onset needs three readings at ≥ 0.9 and a new pitch class. |
| Strum a chord, or play over the backing | Wrong chord advances, or the right chord never does | Chroma overtones: [#386](https://github.com/liftedkilt/fretbook/issues/386). Backing onsets arm the matcher. Chroma also waits ~171 ms for a clean window. |
| Tune to 432, then turn on wait mode | In-tune strings count as flat, sometimes past ±40 cents | A4 is not shared and is not saved. |
| Play with the speakers on | Random hits, or a step that eats the real note | No wait-mode bleed warning. Reference tone is heard as the instrument. |
| Score a take after calibrating a named device | Grades sit early or late | Playback reads `default:default` only. |

Single-note wait and chord wait diverge on purpose. A chord step ignores monophonic `PitchEvent`s and scores chroma. Scored play does the opposite: `buildScoredSteps` passes `chords: false`, so any one pitch class of the chord counts, and chroma stays off. A chroma fix for [#386](https://github.com/liftedkilt/fretbook/issues/386) must not be copied into the scorer.

## Build vs buy

Surveyed October 2026 from each project's docs, license file, and published package size. Nothing below was vendored or benchmarked inside Fretbook. "Worklet" means the library can run inside `AudioWorkletGlobalScope` (no DOM, no `AudioNode` graph) once the app bundles it.

| Candidate | License | Size and cost | Bass / low end | Latency | Worklet | Wait mode (expected note, attack, chords) | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Our MPM** (`mpm.ts`) | MIT (this repo) | A few hundred lines, one FFT, buffers allocated once | Floor 28 Hz, fixed 85 ms window. Expected-note peak pick and `strictOctave` already tested | 20 ms hop after the window fills | Yes, today | Expected note yes; onset and chroma are the neighbouring files | Keep. Harden the window, the gate, and the callers. |
| [pitchy](https://www.npmjs.com/package/pitchy) 4.1.0 | MIT | ~32 KB plus `fft.js`. Last release Jan 2024. Aimed at real-time tuners | Same MPM paper we implemented. No expected-frequency argument | Full-window, real-time JS | Pure JS, so a worklet bundle can import it | No onset, no chroma, no string prior | Lateral move. We would delete behaviour `mpm.test.ts` already locks. |
| [pitchfinder](https://www.npmjs.com/package/pitchfinder) 2.3.4 | **GPL-3.0** | Small JS. YIN, McLeod, AMDF, dynamic wavelet. McLeod default buffer 1024 (about 23 ms at 44.1 kHz, too short for bass) and cutoff 0.93 | McLeod is reported as the better low-note option in their README | JS, caller supplies the buffer | Bundleable | No | **Reject.** GPL against an MIT app. |
| [aubio](https://aubio.org/) / [aubiojs](https://github.com/qiuxiang/aubiojs) | **aubio is GPL-3.0**. The JS wrapper repo is marked MIT and the bindings still carry aubio's GPL header | WASM build of YIN, yinfft, Schmitt, comb, plus an onset object | Mature C, real-time, several pitch methods | Hop and buffer are caller-chosen | WASM in a worklet is possible and fussy | Onset yes. No expected-note bias, no chord score | **Reject.** GPL, and onset policy would still be ours. |
| [Essentia.js](https://github.com/MTG/essentia.js) 0.1.3 | **AGPL-3.0** (commercial licence from UPF otherwise) | `essentia-wasm.es.js` is about 2.6 MB plus a ~2 MB `.wasm` | `PitchYin`, `PitchYinProbabilistic` (pYIN), Melodia. pYIN is the robust monophonic tracker | Heavy for a phone. Sync build is documented for AudioWorklet | Yes, the sync build | pYIN voicing is a good idea. No Fretbook matcher, no string prior | **Reject.** AGPL and the payload. |
| [Meyda](https://www.npmjs.com/package/meyda) 5.6.3 | MIT | Feature extractor (RMS, spectral flux, chroma, MFCC). No f0 | Chroma is a spectral fold, not harmonic-aware | `createMeydaAnalyzer` is an `AudioNode` callback (ScriptProcessor heritage). `extract()` is a pure function | `extract()` can be called from a worklet; the analyzer cannot | Would not fix overtone chords ([#386](https://github.com/liftedkilt/fretbook/issues/386)) or the tuner | Skip. We already compute flux and chroma in the worklet. |
| CREPE tiny ([marl/crepe](https://github.com/marl/crepe), MIT weights) | MIT | ~1.9 MB, ~486k parameters. Needs ONNX Runtime or TFJS, not just the file | Trained at 16 kHz, bins from C1 (32.7 Hz) to B7. Low B is on the edge; drop A is below it. The authors warn the tiny model makes more octave errors | 1024 samples is 64 ms at 16 kHz, then inference. A 2026 LiteRT WASM sweep reported about 188 ms p50 on an M4 Max desktop; WebGPU was ~6 ms on that same machine. A phone on WASM does not hold a 20 ms hop | Worker, not the audio thread | No attack gate, no expected note, no chords | **Reject for the live path.** Power, latency, and the bass floor. |
| [ml5.js](https://github.com/ml5js/ml5-library) `pitchDetection` | Library MIT; model is CREPE | Pulls TFJS and the CREPE graph | Same as CREPE | Callback on the main thread | No | No | Reject. Teaching wrapper. |
| [Tone.js](https://tonejs.github.io/) `UserMedia` | MIT | Large framework. Meter and FFT only; no pitch tracker | n/a | n/a | It is an `AudioNode` graph | n/a | Reject as a tuner core. Our constraints already match what `UserMedia` sets. |
| [@spotify/basic-pitch](https://www.npmjs.com/package/@spotify/basic-pitch) 1.0.1 | Apache-2.0 | Small model (<17k parameters in Spotify's description). Fretbook already runs the ONNX model **on the server** for transcription | Polyphonic note transcription, not a cents readout | The authors say post-processing wants the whole file; practical latency is on the order of the chunk (they discussed ~2 s), not a tuner hop | No | Chords, eventually. Not an onset clock for scoring | Keep it where it is (`fretbook/audio/transcription.py`). Do not put it in the worklet. |
| [pitchlite](https://github.com/sevagh/pitchlite) | MIT | WASM + KissFFT. The web demo accumulates 4096 samples and then resets | MPM | Demo is not a sliding hop | Example worklet only | No | Skip. Not a package, and the demo throws away the overlap we need. |
| [@audio/pitch](https://github.com/audiojs/pitch) (YIN, McLeod, pYIN, streaming `notes()`) | MIT text **plus** a non-standard "Krishnized License" line. GitHub classifies the repo as Other | Small JS. Repo opened April 2026, on the order of a couple of stars. pYIN is described as ~10× YIN | YIN takes `minFreq` / `maxFreq` and can use a longer comparison for low notes. pYIN's default floor in the README is 50 Hz, which still misses a bass E (41 Hz) | YIN is O(N²) over the window. Fine at 2048, painful at 8192 on a phone if run every hop | Pure JS; the app would still write the worklet | Candidate list could feed an octave choice. No chord chroma, no match for our onset timestamps | **Not a p0 adoption.** Too new, license line is ambiguous, and it does not replace wait mode. Revisit only as an in-harness experiment after the window work, not as a dependency. |
| App repos (for example browser YIN tuners such as badlogic/tuner) | Unclear from a README that says MIT while the tree is easy to misread | Applications, not libraries. Published ranges such as 40–800 Hz miss low B and drop A | YIN in a worklet is a pattern, not a component | Their worklet | No expected-note API to reuse | Do not depend on them. The pattern (YIN or MPM inside the worklet, smooth on the main thread) is what we already have. |

Native tuner cores (AudioKit on Apple platforms, Oboe samples on Android) are out of scope. The tuner, wait mode, and scored play run in the browser on a self-hosted page.

### Recommendation

**Stay custom and harden `web/src/lib/listen/`.** Do not wrap Essentia, aubio, CREPE, basic-pitch, Meyda, or Tone for this path.

The fragility is not "we picked an obscure algorithm". MPM is the algorithm behind Tartini and behind pitchy. The gaps are the fixed window, the missing string prior on the tuner, the silence gate, and wait mode's onset rule. Those live in our callers and our defaults. A library swap deletes the expected-note and `strictOctave` tests and still leaves `WaitMatcher`, `Scorer`, and `PitchSmoother` to write.

Copy these ideas, as code we own:

- A longer comparison only while the candidate period is long (YIN implementations do this with `minFreq`).
- A high-pass in front of the autocorrelation.
- Several NSDF peaks plus a prior toward the expected note. That is already `DetectOptions.expectedFrequency`. Use it from the tuner.
- A wide, sticky in-tune zone on the display. That stays in `tuner.ts` and must not move into `PitchEngine`.

No adoption issue is filed. An agent should not spend a PR proving pitchy against the harness until the window and the string prior have landed. If a later measurement says unguided MPM still octave-flips when the prior is on, that is a bug in our peak picker, not a reason to take a GPL dependency.

## What to change, in order

Priorities are for the follow-up issues. Each one should stay a single PR. Shared files are `engine.ts`, `mpm.ts`, `onset.ts`, and `TabPlayer.svelte`; rebase rather than widening a PR.

### p0

1. **Pitch-dependent window and a floor that includes drop A** ([#403](https://github.com/liftedkilt/fretbook/issues/403)). Search down to about 25 Hz so MIDI 21 fits with margin. Keep a short window once the candidate is a guitar pitch, and a long one only for a low candidate. Revisit cutoff 0.90 only if the harness shows the unguided low string still locking an octave high. Do not change the onset backdate formula in this PR.
2. **Tell MPM the string the tuner is showing** ([#404](https://github.com/liftedkilt/fretbook/issues/404)). Locked string: `setExpectedMidi(that midi)` and leave `strictOctave` false so a weak fundamental may be pulled down. Auto mode: bias only after the smoother has a stable nearest string, and clear it when the reading jumps by more than the new-note threshold (80 cents), so a wrong guess cannot stick. Wait mode already sets the expected note; do not change that contract here. Scored play should gain the same hint in a follow-through, with `strictOctave` when "any octave" is off, plus the existing octave-up regression (`mpm.test.ts`).
3. **Wait mode should accept a note the tuner would already trust, and still reject a note that was already ringing** ([#405](https://github.com/liftedkilt/fretbook/issues/405)). Keep the "fresh attack" rule for a pitch that has been steady since before `wait()`. Add a fallback: after the cursor has stopped, N consistent readings of the expected pitch class (the same idea as `StableNote`'s three-in-a-row) count even when flux missed the pluck. Stamp `since` from the session clock when the cursor pauses, and widen the early grace by the calibrated output latency instead of a fixed 80 ms. A clearly wrong pitch should disarm before the full 0.3 s so a backing attack does not eat the real one. Do not import `PitchSmoother` into the worklet.

### p1

4. **High-pass and a hysteresis gate** ([#406](https://github.com/liftedkilt/fretbook/issues/406)) in `PitchEngine`, ahead of MPM. Something like a one-pole high-pass near 25 Hz, an open threshold and a lower keep threshold. Auto gain stays off. Start after [#403](https://github.com/liftedkilt/fretbook/issues/403), because both edit `analyse()`. Onset times of clean, loud attacks on the current fixtures should move by only a few milliseconds.
5. **Tuner display policy** ([#407](https://github.com/liftedkilt/fretbook/issues/407)). Widen the green zone from ±3 cents into the ±5 to ±8 range (pick one, document it, test it). Drive the hold from the smoothed cents, and let a single outlier outside the zone fail only after the median leaves. No new engine behaviour.
6. **One A4 and the calibration the player actually stored** ([#408](https://github.com/liftedkilt/fretbook/issues/408)). Persist the tuner A4 and pass it into `startListening` for the tuner, wait mode, and scored play. Read `getLocalCalibration` for the selected devices, and fall back to `default:default`. Use that offset in wait mode only as extra early grace. Scored play already subtracts it; point it at the same key. Do not retune `hitWindow`.
7. **Bleed** ([#409](https://github.com/liftedkilt/fretbook/issues/409)). While the reference tone is playing, drop tuner pitch events. In wait mode, reuse the scored-play headphones warning when onsets arrive that do not match the step, and leave silent-backing as the switch that already exists (`practice.wait.silent`, default off). Do not auto-mute the band; that is a product default and stays as it is.
8. **Softer repluck onset** ([#410](https://github.com/liftedkilt/fretbook/issues/410)), for scored play and the rhythm trainer, which cannot use the wait-mode fallback. The +12% energy rule and the 60 ms gap miss a second pluck on a loud open string. Improve recall without shifting clean onset timestamps enough to invalidate a stored calibration. Measure that on `fixtures/bass-riff` and `guitar-riff`.
9. **Harness scenarios the current thresholds do not lock** ([#411](https://github.com/liftedkilt/fretbook/issues/411)): unguided weak fundamental (the `mpm.test.ts` tone, asserted, not only the guided path), a soft repeated pluck, and a quiet second voice under the note (bleed). Synthetic only. Do not lower the existing 95% / 0-octave bars to make a new case pass.

### p2

- Chord chroma and overtones stay on [#386](https://github.com/liftedkilt/fretbook/issues/386).
- A YIN-vs-MPM harness run, only if [#403](https://github.com/liftedkilt/fretbook/issues/403) and [#404](https://github.com/liftedkilt/fretbook/issues/404) land and low strings still flip with the prior enabled. In-repo, no new dependency, until that number says otherwise.
- Verify applied `getUserMedia` constraints in the listen panel when a browser ignores them. Diagnostic only.

## Sharing the work without breaking scored play

Scored play is the sensitive caller. It grades attacks on a clock:

```
songNow − (micNow − onsetTime + calibratedLatency) × playbackRate
```

Hit window 100 ms, early/late out to 300 ms (`DEFAULT_SCORE_OPTIONS`). A constant bias is what calibration removes. A change to the backdate in `PitchEngine.analyse` moves every grade and makes stored offsets wrong.

| Change | Tuner | Wait mode | Scored play | Rule |
| --- | --- | --- | --- | --- |
| Pitch-dependent window, high-pass, silence hysteresis | Shared, this is the robustness | Shared | Shared, as long as clean onset times stay put | Land with a fixture diff of onset times, not only pitch hits. |
| `setExpectedMidi` from the tuner | Yes | Already on | Add it with the same `strictOctave` rule as wait mode | An octave-up note must not fold down when strict. Test already in `mpm.test.ts`. |
| `PitchSmoother`, green zone, hold | Yes | No | No | Smoothing delays the display on purpose. The scorer needs the raw event. |
| Wait fallback when flux misses | No | Yes | No | Scored play must keep requiring an onset, or "early/late" becomes "whenever the pitch was true". |
| Early grace and `since` | No | Yes | No | Do not widen `hitWindow` in the same PR. |
| Chroma / harmonic suppression | Off | Chord steps | Off (`chords: false`) | [#386](https://github.com/liftedkilt/fretbook/issues/386) only. |
| A4 | Display and, after p1.6, the engine | Engine cents | Engine cents | One stored value. |
| Reference-tone mute, bleed warning | Tone mute | Warning | Warning already exists | Do not change `GRADE_CREDIT`. |

`ChordAnswerMatcher` has its own `earlySeconds` of 0.08. Leave it alone in the wait-mode PR so ear training does not move with the cursor grace.

## Already done

Do not reopen these. The behaviour above is what they shipped.

| Issue | What landed |
| --- | --- |
| [#65](https://github.com/liftedkilt/fretbook/issues/65) | Worklet MPM + onset, harness, fixtures |
| [#66](https://github.com/liftedkilt/fretbook/issues/66), [#159](https://github.com/liftedkilt/fretbook/issues/159) | Tuner, then the median smoother and the headstock. The ±3 cent hold is the part that still feels finicky |
| [#67](https://github.com/liftedkilt/fretbook/issues/67) | Calibration wizard. Wait mode never reads it; playback reads only `default:default` |
| [#68](https://github.com/liftedkilt/fretbook/issues/68), [#148](https://github.com/liftedkilt/fretbook/issues/148) | Wait mode, then removing a 0.8 s pause settle. The 0.3 s pitch settle is separate |
| [#69](https://github.com/liftedkilt/fretbook/issues/69) | Chord steps and chroma |
| [#336](https://github.com/liftedkilt/fretbook/issues/336) | `strictOctave`, so "any octave off" rejects a higher octave instead of folding it down |
| [#144](https://github.com/liftedkilt/fretbook/issues/144), [#206](https://github.com/liftedkilt/fretbook/issues/206) | Device and channel picker |
| [#386](https://github.com/liftedkilt/fretbook/issues/386) | Open. Lone plucked root still satisfies a chord via the 3rd harmonic |

## Follow-up issues

No library-adoption issue. The recommendation above is to stay on our MPM and harden it.

| Priority | Issue | One line |
| --- | --- | --- |
| p0 | [#403](https://github.com/liftedkilt/fretbook/issues/403) | Pitch-dependent window and a floor that includes drop A |
| p0 | [#404](https://github.com/liftedkilt/fretbook/issues/404) | Tuner tells MPM which string is selected |
| p0 | [#405](https://github.com/liftedkilt/fretbook/issues/405) | Wait mode accepts a steady expected pitch after the cursor stops, and still rejects a ringing note |
| p1 | [#406](https://github.com/liftedkilt/fretbook/issues/406) | High-pass and silence hysteresis. Start after [#403](https://github.com/liftedkilt/fretbook/issues/403); both edit `analyse()` |
| p1 | [#407](https://github.com/liftedkilt/fretbook/issues/407) | Wider, stickier in-tune hold |
| p1 | [#408](https://github.com/liftedkilt/fretbook/issues/408) | One A4, and the calibration pair the player stored |
| p1 | [#409](https://github.com/liftedkilt/fretbook/issues/409) | Reference tone and backing-track bleed |
| p1 | [#410](https://github.com/liftedkilt/fretbook/issues/410) | Soft repeated notes produce an onset, clean onset times stay put |
| p1 | [#411](https://github.com/liftedkilt/fretbook/issues/411) | Scenarios for a weak fundamental, a soft repluck, and bleed |
