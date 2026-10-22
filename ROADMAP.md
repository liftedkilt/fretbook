# Roadmap

What Fretbook should do next, in rough priority order. Items marked **essential** close gaps that people will hit early when they run Fretbook on their own server. Items marked **nice to have** make it a better practice tool.

Open an issue before starting anything here, so work isn't duplicated.

## Being built now

These are already being worked on. Coordinate with them before touching the same areas.

| Work | Tracking |
| --- | --- |
| UI redesign | In progress |
| PDF export of tabs and sheet music | [#3](https://github.com/liftedkilt/fretbook/issues/3) |
| Multi-user sign-in with OIDC (Pocket ID) | [#5](https://github.com/liftedkilt/fretbook/issues/5), [PR #10](https://github.com/liftedkilt/fretbook/pull/10) |
| Importing tabs from YouTube lesson videos (design and spike: [docs/design/youtube-tab-import.md](docs/design/youtube-tab-import.md)) | [#6](https://github.com/liftedkilt/fretbook/issues/6) |

## Essential

### Backup and restore

Everything lives in one SQLite file and a media folder, so a lost volume loses the whole library. Add:
- a full export: one archive with every song as Fretbook JSON and its audio
- a matching import that restores it into an empty or existing library
- a `python -m fretbook backup` command that takes a consistent SQLite snapshot (the online backup API, not a file copy) for cron or a container sidecar

Once [#5](https://github.com/liftedkilt/fretbook/issues/5) lands, export and import work per user, and an admin can back up everything.

### Published, versioned Docker image

Today users build the image themselves. Publish tagged images to GHCR from CI on each release, with a changelog. That makes upgrades a `docker compose pull`, and gives migrations a version to refer to.

### Keeping yt-dlp working

YouTube changes often and yt-dlp breaks with it, which silently stops audio downloads. Make an outdated yt-dlp easy to spot and fix: show its version on `/api/meta`, explain failures in the import result, and either ship frequent image updates or let the container update yt-dlp at start.

### Repeats and playback order

Repeats are stored in the score but not rendered, so the bar index is also the playback order. Real songs depend on repeats, voltas, D.S. and D.C. Render them, expand them into a playback order, and make sync marks follow the played order rather than the written bar index.

### Library search and sorting

The library only filters by instrument. Once it holds more than a screenful of songs it needs search by title and artist, and sorting by title, artist, date added and last opened. Check this against the UI redesign first, since it may already cover it.

### Practice controls

The basics of a play-along tool:
- a metronome and a count-in before playback starts
- mute, solo and volume for each track, and for the audio against the synth
- make sure slowing the audio down keeps its pitch, in every browser we support

### Failed imports

When an import job fails (including one given up on after two server restarts), let the user retry it from the library instead of pasting the link or choosing the file again.

## Nice to have

### Practice

- **Speed trainer**: loop a section, and raise the speed a step after each pass up to a target.
- **Automatic sync**: estimate the bar marks from the audio (beat tracking) so tapping `T` becomes fixing marks instead of placing them all.
- **Stem separation**: isolate or remove the bass or guitar in the recording (for example with Demucs). It needs a GPU, so it could share the worker planned for [#6](https://github.com/liftedkilt/fretbook/issues/6).
- **Fretboard view**: show the notes being played on a fretboard diagram, which helps with reading tab.
- **Practice log**: time spent and the highest speed reached per song or loop.

### Listening to you play

Features that use the microphone to hear the instrument, in the order to build them. They all run in the browser and share one piece of pitch detection. Browsers only allow the microphone on HTTPS pages (or `localhost`), so the README has to tell self-hosters to put Fretbook behind HTTPS to use them.

- **Pitch detection**: microphone input with echo cancellation, noise suppression and auto gain turned off, since they damage instrument sound. Detection runs in an `AudioWorklet` (for example with an MPM or YIN library such as `pitchy`), and an onset detector tells a repeated note from a held one. Low bass notes are the hard case: low E is 41 Hz and a 5-string's low B is 31 Hz, so each reading needs 50–70 ms of audio and octave errors are common. Start with a short test on recorded bass and guitar to measure accuracy before building on it.
- **Tuner**: tune to the song's tuning, string by string.
- **Wait mode**: the cursor waits on each beat until you play the right note, then moves on, as Yousician does. The expected notes come from the score (string tuning + fret + capo), so the app only checks for the note it expects, which is far more reliable than working out what was played. Tied notes are skipped, dead notes accept any attack, and the right note in another octave counts. It plays with the built-in synth or in silence, because stopping a recording at every missed note doesn't work. Start with single notes, which covers bass and most riffs.
- **Chords in wait mode**: compare the sound's overall pitch content against the chord's expected notes instead of transcribing every string. It is less reliable than single notes, so make it lenient and let the player skip a beat.
- **Scored play-along**: play along with the recording without stopping, and get each note marked hit, early, late or missed, with a score at the end and in the practice log. It needs a calibration step that measures the input and output latency, and headphones so the microphone doesn't hear the recording.

### Organising

- Setlists, with an ordered play-through for rehearsal or a gig.
- Tags and favourites.
- Sharing, once multi-user lands: a read-only link to a song, and shared libraries for a band.

### Importing and editing

- Paste plain ASCII tab (the `e|---3---|` style) and convert it to a score.
- More file formats, such as Power Tab (`.ptb`) and MIDI.
- Retune or transpose a tab, for example from standard to drop D, or from 4-string to 5-string bass.
- Chord diagrams on chord sheets, for guitar and ukulele.

### Playing live

- Offline use as an installable web app, so a setlist works with no network.
- Turning pages and starting playback hands-free with a Bluetooth page-turner pedal.

### Other

- Personal API tokens, so scripts and other tools can use the API.
- More languages. See [CONTRIBUTING.md](CONTRIBUTING.md#adding-a-locale).
