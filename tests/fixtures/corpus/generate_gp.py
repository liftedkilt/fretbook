"""Regenerate the Guitar Pro 3/4/5 fixtures. Needs `pip install pyguitarpro` (not a project dependency).

    python tests/fixtures/corpus/generate_gp.py

The riff is original (CC0): two 4/4 bars on a four-string bass, E A D G tuning.
GP7 (`.gp`) is written by alphaTab: `node web/scripts/generate-gp7.mjs`.
"""

from pathlib import Path

import guitarpro as gp

OUT = Path(__file__).parent / "gp"

# (string 1 = highest, fret) per quarter note; None is a rest.
BARS = [[(4, 0), (4, 0), (4, 3), (3, 0)], [(3, 2), (3, 2), (2, 0), None]]
TUNING = [(1, 43), (2, 38), (3, 33), (4, 28)]  # G2 D2 A1 E1, highest first


def build(version: tuple[int, int, int]) -> gp.Song:
    song = gp.Song()
    song.title, song.artist, song.tempo = "Corpus Riff", "Fretbook Fixtures", 100
    track = song.tracks[0]
    track.name = "Bass"
    track.strings = [gp.GuitarString(n, v) for n, v in TUNING]
    track.channel.instrument = 33
    track.measures = []
    song.measureHeaders = []
    for index, notes in enumerate(BARS):
        header = gp.MeasureHeader(number=index + 1, start=gp.Duration.quarterTime * 4 * index)
        header.timeSignature = gp.TimeSignature(4, gp.Duration(4))
        song.measureHeaders.append(header)
        measure = gp.Measure(track, header)
        voice = measure.voices[0]
        voice.beats = []
        for step, item in enumerate(notes):
            beat = gp.Beat(voice, start=header.start + step * gp.Duration.quarterTime)
            beat.duration = gp.Duration(4)
            if item is None:
                beat.status = gp.BeatStatus.rest
            else:
                beat.status = gp.BeatStatus.normal
                beat.notes.append(gp.Note(beat, value=item[1], string=item[0], type=gp.NoteType.normal))
                beat.notes[0].velocity = 95
            voice.beats.append(beat)
        track.measures.append(measure)
    return song


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for name, version in {"riff.gp3": (3, 0, 0), "riff.gp4": (4, 0, 0), "riff.gp5": (5, 1, 0)}.items():
        gp.write(build(version), str(OUT / name), version=version)
        print("wrote", name)
