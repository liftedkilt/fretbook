# Practice controls

How the song page's metronome, count-in, mixer, slow-down, saved loops, and speed trainer work, and how to check them by hand.

## How it works

- **Synth playback** (a song without a recording): alphaTab plays every track of the score. The mixer sets each track's volume, mute and solo, and the synth's master volume. The metronome is alphaTab's own, so it follows tempo and time-signature changes in the score.
- **Recording playback**: the `<audio>` element sets the pace and alphaTab's external-media mode makes no sound of its own. The metronome is a Web Audio click scheduled from the bar starts (`songStarts`, which includes your sync marks), so it stays on the recording's beat. To hear the score's tracks next to the recording, the mixer's **Balance** slider (recording only ← → synth only, both at full volume in the middle) brings in a second, hidden alphaTab player that plays every track at the written tempo and follows the recording: it is sped up or slowed down bar by bar to match your sync marks, and jumps back to the recording's position when it drifts more than 0.12 s (`web/src/lib/alphatab/synthFollow.ts`). The synth is only built once the balance leaves "recording only". Track mute, solo and volume apply to this synth, so you can mute your own instrument and play it yourself over the rest. Its own metronome stays off; the page's clicks keep time.
- **Count-in**: one or two empty bars are clicked in at the tempo and time signature of the bar playback starts on, scaled by the playback speed. With "Before each loop pass" on, a recording pauses at the loop start, counts in, then plays on.
- **Slowing down**: the speed control sets `playbackRate`, and `preservesPitch` is switched on for the audio element (`webkitPreservesPitch` / `mozPreservesPitch` too where a browser still uses them). The synth slows by changing its tempo, which never changes pitch. No time-stretch library is needed.
- **Saved loops**:
  - An A/B range can be set from playback or specified directly in the Practice dock drawer (`LoopPanel`).
  - Loops can be saved with names (e.g. "Solo", "Bridge riff").
  - Quick-jump buttons appear in the song page header for fast loop navigation.
  - Direct linking is supported via the `?loop=<id>` query parameter.
- **Speed trainer**:
  - Configurable with Start %, Target %, Step %, and Passes per step.
  - Automatically increases tempo upon finishing the configured number of passes until the target speed is reached.
  - Counts in between loop passes (and on initial start) to allow preparing for the next repetition.
  - Records the highest speed achieved per loop on the loop's settings and dispatches a `fretbook:practice-log-record` window event for integration with the practice log.
- Settings are stored in `localStorage` per song (`fretbook.practice.<song id>`): per browser, not per account.

## Manual check: slowed audio keeps its pitch

`preservesPitch` is asserted automatically in Chromium (`web/e2e/practice.spec.ts`). Browsers do not expose whether the sound really kept its pitch, so check Firefox and Safari by ear:

1. Open a song with a recording of a sustained note or a tuner-friendly tone (the `click-track.wav` fixture has no pitch; use any song with a held note).
2. Open the song in the browser, play it at 1×, and note the pitch (or hold a tuner app up to the speaker).
3. Press `[` until the speed shows 0.5×. The notes should last twice as long but sound the same pitch, not an octave lower.
4. Press `]` back to 1× and 1.5×: the pitch must not rise.

Record the browser and version when you report a problem.

## Manual check: metronome and count-in

1. Press `M`: clicks sound on every beat, higher on beat 1, in time with the cursor (synth) or the recording.
2. Press `C` until "2 bars" is selected, then Space: two bars of clicks, then the music.
3. Open a song with a tempo or time-signature change: the click changes with it.

## Manual check: saved loops and speed trainer

1. Open the Practice drawer (or loop controls) and set Loop A to bar 1 and Loop B to bar 4.
2. Enter "Intro Riff" in the name field and click "Save loop".
3. Verify that an "Intro Riff" pill appears in the song page hero header and in the saved loops list in the Practice drawer.
4. Enable "Speed trainer", set start speed to 60%, target speed to 100%, step to 10%, and passes to 2.
5. Press Play / Space: verify that playback begins at 60% with count-in clicks, repeats at 60% for pass 2, then automatically ramps to 70% with count-in for pass 3, continuing up to 100%.
6. Stop playback and check that the highest speed achieved is saved with the loop badge.
