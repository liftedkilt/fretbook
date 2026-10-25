# Import fixture corpus

Small files that every importer is tested on (`tests/test_import_corpus.py` on the server,
`web/src/lib/alphatab/importScore.test.ts` for Guitar Pro in alphaTab). Everything here was written for this
repository and is released under **CC0**. None of it is a copyrighted song; the melodies are a two-bar bass riff and a
few bars of techniques invented for the tests, and the lyrics are placeholder text.

| Path | What it is | How it was made |
| --- | --- | --- |
| `musicxml/riff.partwise.musicxml` | Two-bar bass riff, `score-partwise`, tab data | Hand-written |
| `musicxml/riff.mxl` | The same riff as a compressed `.mxl` container | Zipped from the file above |
| `musicxml/riff.timewise.musicxml` | `score-timewise` variant | Hand-written |
| `musicxml/guitar.techniques.musicxml` | Guitar part: repeats, section, two voices, grace note, triplet, hammer-on | Hand-written |
| `musicxml/mixed.nontab.musicxml` | Piano part without string/fret data | Hand-written |
| `gp/riff.gp3`, `.gp4`, `.gp5` | The riff in Guitar Pro 3, 4 and 5 | `gp/../generate_gp.py` (PyGuitarPro) |
| `gp/riff.gp` | The riff in Guitar Pro 7/8 | `web/scripts/generate-gp7.mjs` (alphaTab's exporter) |
| `gp/riff.gpx` | The riff in Guitar Pro 6 | `python tests/fixtures/corpus/generate_gpx.py`: wraps `riff.gp`'s `score.gpif` in a GPX container (see below) |
| `musescore/riff.mscx`, `.mscz` | The riff as MuseScore XML and compressed `.mscz` container | Hand-written |
| `abc/riff.abc` | The riff in ABC notation | Hand-written |
| `tuxguitar/riff.tg` | The riff as a TuxGuitar 2.0 archive | Hand-written |
| `powertab/riff.ptb` | The riff as a Power Tab binary file | Hand-written |
| `chordpro/*.cho` | ChordPro with long and short directive forms | Hand-written |
| `ugtext/*.txt` | Ultimate Guitar style chords-over-lyrics, with and without a header | Hand-written |
| `asciitab/*.tab`, `asciitab/*.txt` | ASCII tab in sixteen styles: labelled and unlabelled rows, bass, drop D, 5-string bass written low string first, 7-string, multi-digit frets, technique marks, repeat signs, sections with chord lines and lyrics, `PM` rows, a bass and a guitar tab in one file (two tracks), wrapped systems, sixteenth runs, and a `.txt` with a tab among prose | Hand-written |
| `midi/riff.mid` | The riff as a format-0 MIDI file (imports to the same notes as the MusicXML riff) | Written byte by byte |
| `midi/triplets.mid` | Eighth triplets, a quintuplet and a swung pair next to straight notes | `python tests/fixtures/corpus/generate_midi.py` (original phrase) |
| `midi/sustain.mid` | A held bass and a held chord under moving melodies, imported as a second voice | `python tests/fixtures/corpus/generate_midi.py` (original phrase) |
| `json/*.json` | Fretbook JSON: tab export, chord export, bare document, malformed | Produced by the MusicXML and ChordPro importers |
| `golden/*.json` | Expected result of importing each file above | `pytest tests/test_import_corpus.py --update-golden` |
| `golden-web/*.json` | Expected result of importing each Guitar Pro file in the browser | `UPDATE_GOLDEN=1 npm test --prefix web` |

Not covered yet, because there is no way to generate an original file or no importer exists: a server importer for `.mxl`. That fixture is snapshotted as "no importer" so the snapshot
changes when support lands.

`riff.gpx` was not saved from Guitar Pro 6, which nobody here can run, and neither PyGuitarPro nor alphaTab can write
`.gpx`. The generator packs the riff's GPIF XML (from `riff.gp`, version string changed to 6.1.0) into a real BCFZ/BCFS
container using literal runs only, so it exercises the container reader but not GP6-specific XML or back-reference
compression. Replace it with a file saved from Guitar Pro 6 if one becomes available.

To add a file, put it in the matching folder and run both update commands; review the new snapshot in the diff.
