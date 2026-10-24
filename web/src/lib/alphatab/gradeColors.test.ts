import * as alphaTab from "@coderline/alphatab";
import { describe, expect, it } from "vitest";

import { GRADE_COLORS, colourScoreGrades } from "./gradeColors";

function load() {
  const settings = new alphaTab.Settings();
  const importer = new alphaTab.importer.AlphaTexImporter();
  importer.init(
    alphaTab.io.ByteBuffer.fromBuffer(
      new TextEncoder().encode("\\tempo 100 . 3.3.4 5.3.4 | 0.3.2 2.3.2 3.3.2"),
    ),
    settings,
  );
  return importer.readScore().tracks[0];
}

const head = alphaTab.model.NoteSubElement.StandardNotationNoteHead;
const colourOf = (track: alphaTab.model.Track, bar: number, beat: number) =>
  track.staves[0].bars[bar].voices[0].beats[beat].notes[0].style?.colors.get(head)?.rgba;

describe("colourScoreGrades", () => {
  it("colours the notes whose beat has a grade and leaves the rest alone", () => {
    const track = load();
    const beats = track.staves[0].bars[0].voices[0].beats;
    const changed = colourScoreGrades(
      track,
      { [`0:${beats[0].displayStart}`]: "hit", [`0:${beats[1].displayStart}`]: "missed" },
      [0, 1],
    );
    expect(changed).toBe(true);
    expect(colourOf(track, 0, 0)).toBe(alphaTab.model.Color.fromJson(GRADE_COLORS.hit)?.rgba);
    expect(colourOf(track, 0, 1)).toBe(alphaTab.model.Color.fromJson(GRADE_COLORS.missed)?.rgba);
    expect(colourOf(track, 1, 0)).toBeUndefined();
  });

  it("maps played bars through repeats to written bars, the latest pass winning", () => {
    const track = load();
    const at = track.staves[0].bars[0].voices[0].beats[0].displayStart;
    colourScoreGrades(track, { [`0:${at}`]: "missed", [`1:${at}`]: "hit" }, [0, 0]);
    expect(colourOf(track, 0, 0)).toBe(alphaTab.model.Color.fromJson(GRADE_COLORS.hit)?.rgba);
  });

  it("clears the colours when the grades go away, and reports no change when idle", () => {
    const track = load();
    const at = track.staves[0].bars[0].voices[0].beats[0].displayStart;
    expect(colourScoreGrades(track, {}, [0, 1])).toBe(false);
    colourScoreGrades(track, { [`0:${at}`]: "late" }, [0, 1]);
    expect(colourScoreGrades(track, { [`0:${at}`]: "late" }, [0, 1])).toBe(false);
    expect(colourScoreGrades(track, {}, [0, 1])).toBe(true);
    expect(colourOf(track, 0, 0)).toBeUndefined();
  });
});
