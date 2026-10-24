# Real recordings for the auto-sync evaluation

`scripts/autosync_eval.py` prints a `real:` row for each recording listed in `manifest.json`, next to the synthetic
rows. The set is empty until someone with a recording they have the right to share adds one: the agent that built the
evaluation had no original or public-domain recording and could not check bar marks by ear.

## What qualifies

- **Licence.** Your own take, or CC0, CC-BY, CC-BY-SA or public-domain audio. The `licence` field is one of
  `original` (made for this repository, released under CC0), `CC0-1.0`, `CC-BY-4.0`, `CC-BY-SA-4.0`, `public-domain`.
  Note the `source` (a URL, or who played it and how). No copyrighted songs.
- **Size.** A short excerpt, 3 MB at most (an Ogg Vorbis or Opus file of 20 to 60 s is plenty). WAV and anything
  `ffmpeg` decodes work.
- **Score.** A Fretbook JSON score of what is played (a tab export or a bare document), next to the audio. Write the
  tab yourself or use the CC0 corpus riff in `tests/fixtures/corpus/json/`.
- **Marks.** `bar_starts` are the seconds at which each played bar starts, from `start_bar` on, plus the end of the last
  bar. Make them by tapping in the editor and exporting the sync, then check every one by ear (a click overlay from
  the auto-sync preview helps) and say how in `checked_by`.

## Entry

```json
{
  "recordings": [
    {
      "id": "my-riff-take-1",
      "audio": "my-riff-take-1.ogg",
      "score": "my-riff.tab.json",
      "title": "Bass riff, played with a pick, 96 BPM",
      "source": "Recorded by <name> for this repository",
      "licence": "original",
      "checked_by": "by ear, against a click overlay",
      "bar_starts": [0.52, 3.01, 5.5, 8.02, 10.5],
      "start_bar": 0,
      "start_seconds": null,
      "notes": "Optional: count-in, swing, rubato, anything that makes it hard."
    }
  ]
}
```

`tests/test_autosync_evalset.py` validates the manifest (licence, sizes, increasing marks, files present) and runs
every listed recording with a loose threshold, so a bad entry fails CI. Add the table row to the "Evaluation set" in
`docs/ARCHITECTURE.md` when you add one, and use the rows to judge whether a better downbeat cue (chord changes, the
score's bass notes) or a wider rubato tracker is worth building.
