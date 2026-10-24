# Roadmap

What Fretbook should do next, in rough priority order. Items marked **essential** close gaps that people will hit early when they run Fretbook on their own server. Items marked **nice to have** make it a better practice tool.

Open an issue before starting anything here, so work isn't duplicated.

## Being built now

These are already being worked on. Coordinate with them before touching the same areas.

| Work | Tracking |
| --- | --- |
| UI redesign | In progress |
| Importing tabs from YouTube lesson videos (design and spike: [docs/design/youtube-tab-import.md](docs/design/youtube-tab-import.md)) | [#6](https://github.com/liftedkilt/fretbook/issues/6) |

## Essential

### Synth alongside a recording

Practice controls (metronome, count-in, mixer, pitch-preserving slowdown) are done, but while a recording plays the built-in synth is silent: alphaTab's external-media mode produces no synth sound. Play the synth next to the recording so the mixer can balance the two and mute or solo tracks over a recording.

## Nice to have

### Practice

- **Automatic sync**: estimate the bar marks from the audio (beat tracking) so tapping `T` becomes fixing marks instead of placing them all.
- **Stem separation**: isolate or remove the bass or guitar in the recording (for example with Demucs). It needs a GPU, so it can run as a kind in the job worker (`python -m fretbook.worker`, `Dockerfile.worker`).

### Listening to you play

Features that use the microphone to hear the instrument, in the order to build them. They all run in the browser and share one piece of pitch detection, which is built (`web/src/lib/listen/`) and now drives the tuner and wait mode. Browsers only allow the microphone on HTTPS pages (or `localhost`), so the README has to tell self-hosters to put Fretbook behind HTTPS to use them.


### Organising

- Sharing, once multi-user lands: a read-only link to a song, and shared libraries for a band.

### Importing and editing

- More file formats, such as Power Tab (`.ptb`).

### Playing live

- Offline use as an installable web app, so a setlist works with no network.
- Turning pages and starting playback hands-free with a Bluetooth page-turner pedal.

### Other

- More languages. See [CONTRIBUTING.md](CONTRIBUTING.md#adding-a-locale).
