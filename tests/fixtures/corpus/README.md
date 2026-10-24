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
| `chordpro/*.cho` | ChordPro with long and short directive forms | Hand-written |
| `ugtext/*.txt` | Ultimate Guitar style chords-over-lyrics, with and without a header | Hand-written |
| `asciitab/*.tab`, `asciitab/*.txt` | ASCII tab in twelve styles: labelled and unlabelled rows, bass, drop D, 5-string bass written low string first, 7-string, multi-digit frets, technique marks, repeat signs, sections with chord lines and lyrics, `PM` rows, wrapped systems, sixteenth runs, and a `.txt` with a tab among prose | Hand-written |
| `midi/riff.mid` | The riff as a format-0 MIDI file (imports to the same notes as the MusicXML riff) | Written byte by byte |
| `midi/triplets.mid` | Eighth triplets, a quintuplet and a swung pair next to straight notes | `python tests/fixtures/corpus/generate_midi.py` (original phrase) |
| `midi/sustain.mid` | A held bass and a held chord under moving melodies, imported as a second voice | `python tests/fixtures/corpus/generate_midi.py` (original phrase) |
| `json/*.json` | Fretbook JSON: tab export, chord export, bare document, malformed | Produced by the MusicXML and ChordPro importers |
| `golden/*.json` | Expected result of importing each file above | `pytest tests/test_import_corpus.py --update-golden` |
| `golden-web/*.json` | Expected result of importing each Guitar Pro file in the browser | `UPDATE_GOLDEN=1 npm test --prefix web` |

Not covered yet, because there is no way to generate an original file or no importer exists: Guitar Pro 6 (`.gpx`),
and a server importer for `.mxl`. Those fixtures are snapshotted as "no importer" so the snapshot
changes when support lands.

To add a file, put it in the matching folder and run both update commands; review the new snapshot in the diff.
