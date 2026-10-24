# Playing and syncing

![The song page](../assets/screenshots/song-page.png)

## Playing a tab

Open a song. **Space** plays, the arrow keys move a bar, and `?` lists every shortcut. Without a recording, alphaTab's
synth plays the tab. Standard notation and tab are drawn by [alphaTab](https://alphatab.net).

Switch between **Tab**, **Highway** and **Split** on any tab song page; Fretbook remembers it per user.

- **Highway.** Notes travel along coloured string lanes toward a hit line, with fret numbers, sustain tails, technique
  glyphs (hammer-on/pull-off, slides, bends, palm mute, vibrato, harmonics), chord blocks with names, bar and beat
  lines, and upcoming section labels.
- **Fretboard.** In the Sync & audio panel, switch on **Show the fretboard under the score**. An SVG neck for the
  track's own strings, tuning and capo lights the notes sounding now and fades the next three. Label the dots with note
  names, intervals (from a root you pick) or fret numbers, and mirror it for left-handed players.

## Playing along with a recording

Add audio on the song page (upload an mp3, or let the Songsterr import download the audio of the video it syncs to).
The score then follows the recording.

### Syncing

A recording and a score only line up if you tell Fretbook where each bar starts.

1. Open the Sync & audio panel and start the recording.
2. Press **T** at the start of each bar, against the audio. Those are the *sync marks*.
3. Use Loop A/B, speed and the nudge buttons to line up a stretch that drifts.

#### Auto-sync

Instead of tapping every bar, press **Auto-sync** in the Sync marks group of the Sync & audio panel (it needs a tab with
audio). The server listens for the beat in the recording, matches it to the score's bars (time signatures, repeats
and tempo changes included) and proposes a mark for every bar. Nothing is saved yet:

- The sheet tells you how many marks it found, how confident it is, and which bars are worth checking.
- **Preview with click** plays the recording with a click on every beat and a higher click on the first beat of each bar,
  from the bar you choose (it starts at the first bar worth checking). If the clicks sit on the music, the marks are right.
- **Accept marks** saves them, replacing any marks you had. **Discard** leaves the song as it was.

After accepting, fix a bar that is off the usual way: play to it, press **T**, or use the nudge and clear buttons.

Auto-sync works best on a recording with a clear, steady pulse and a bass or kick that lands on the first beat of
the bar. It assumes the recording follows the score's bar structure (the same bars, repeats and order) and that the
first strong sound is the first bar; an intro or count-in that the tab does not have throws the marks off, so
trim the audio or fix the first marks and the rest by hand. A recording that speeds up and slows down a lot, or has a long rubato passage, will come out with low-confidence
marks there. Reading formats other than WAV needs `ffmpeg`, which the Docker image includes.

Songsterr imports that carry sync data already have marks. Importing the same song again keeps yours. The metronome
and count-in follow the marks.

If the song changed elsewhere since you opened it (for example sync marks tapped in another tab), saving merges your
edits on top. Real conflicts ask you to reload.

### Stems: play along without the bass

If your server runs the [job worker](../self-hosting/worker.md), a song with a recording shows **Stems** in the
practice panel. **Separate stems** splits the recording into bass, guitar, drums, piano, vocals and the rest (it
takes a few minutes). Then tick **Play with stems**: each part gets **Mute**, **Solo** and a volume, remembered per
song in this browser. Mute the bass to play it yourself, or solo the guitar to hear exactly what it plays. Sync
marks, loops, the metronome and slow-down work as before.

## Editing

The editor changes bars, which every track shares, so time signatures, tempo changes, sections, and inserting or
deleting a bar apply to the whole song, and sync marks move with their bars.

## Setlists

Named, ordered lists of songs for a rehearsal or a gig. Reorder by dragging or with the keyboard, add a note per song
(key, capo, "skip solo") and a transpose per chord sheet, then **Play through** to step from song to song (Alt with
← or →). **Export PDF** makes one file with a contents page followed by every song. A song can be in many setlists, and
setlists are part of the library backup.

To add a song without opening the setlist, press **Add to setlist** on the song page or on its library card, then pick a
setlist or type a name to start a new one. The song goes to the end of the running order.

## Hands-free

A Bluetooth page-turner pedal sends ordinary keys, so no pairing software is needed beyond the pedal's own. By default
**Page Down** and **Page Up** scroll a page forward and back in the tab player and on chord sheets. Open **Settings →
Page-turner pedal** to give any of Page Down, Page Up, the up and down arrows, or the left and right arrows one of
these jobs: next or previous page, play or pause (auto-scroll on a chord sheet), loop on or off (the bar being played,
or clear the loop), or the next or previous song while playing through a setlist. **Keep** leaves a key to its normal
job (the left and right arrows step a bar in the tab player). The choice is stored in the browser, per device.

On a chord sheet, **Auto-scroll** moves the page so the end arrives as the song ends. The length comes from a
`{duration: 3:45}` directive, else from `{tempo: 120}` and the number of lines (two 4/4 bars a line), else a typical
song length of 3½ minutes. The ± buttons scale the speed from 0.5× to 2×.

**Stage mode** (the monitor button) draws chord sheets in large print and the tab larger, and hides the song header and
panels so only the music and the transport are left.

## Language

English and Brazilian Portuguese. The header switcher remembers the choice. With none saved, the browser language is
used (`pt` and `pt-PT` select `pt-BR`).
