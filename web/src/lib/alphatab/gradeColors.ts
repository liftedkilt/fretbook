import * as alphaTab from "@coderline/alphatab";

import type { NoteGrade } from "../listen/scored";

/** Note-head colours for each scored grade, matching the highway gems. */
export const GRADE_COLORS: Record<NoteGrade, string> = {
  hit: "#22b573",
  early: "#d99426",
  late: "#d99426",
  wrong: "#8a4bd6",
  missed: "#d64550",
};

const SUB_ELEMENTS = [
  alphaTab.model.NoteSubElement.StandardNotationNoteHead,
  alphaTab.model.NoteSubElement.StandardNotationAccidentals,
  alphaTab.model.NoteSubElement.GuitarTabFretNumber,
  alphaTab.model.NoteSubElement.SlashNoteHead,
];

/** Keeps the colour objects of the notes this module painted, to tell them from user styles. */
const painted = new WeakMap<alphaTab.model.Note, string>();

/**
 * Colours every note of `track` by the grade of its beat, and clears the colour from notes that
 * have none. `grades` is keyed by `bar:position` with the bar as the played bar index, and
 * `played` maps played bars to written bars (repeats play a written bar more than once; the
 * latest pass wins). Returns true when any note changed, so the caller knows to redraw.
 */
export function colourScoreGrades(
  track: alphaTab.model.Track,
  grades: Readonly<Record<string, string>>,
  played: readonly number[],
): boolean {
  const byWritten = new Map<string, string>();
  for (const [key, grade] of Object.entries(grades)) {
    const [bar, position] = key.split(":");
    const written = played[Number(bar)];
    if (written === undefined || !(grade in GRADE_COLORS)) continue;
    byWritten.set(`${written}:${position}`, grade);
  }
  let changed = false;
  for (const staff of track.staves) {
    for (const bar of staff.bars) {
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          const grade = byWritten.get(`${bar.index}:${beat.displayStart}`);
          for (const note of beat.notes) {
            if (applyGrade(note, grade)) changed = true;
          }
        }
      }
    }
  }
  return changed;
}

function applyGrade(note: alphaTab.model.Note, grade: string | undefined): boolean {
  if (painted.get(note) === grade) return false;
  if (grade === undefined) {
    if (!painted.has(note)) return false;
    painted.delete(note);
    if (note.style) for (const element of SUB_ELEMENTS) note.style.colors.delete(element);
    return true;
  }
  const style = note.style ?? new alphaTab.model.NoteStyle();
  const color = alphaTab.model.Color.fromJson(GRADE_COLORS[grade as NoteGrade]);
  for (const element of SUB_ELEMENTS) style.colors.set(element, color);
  note.style = style;
  painted.set(note, grade);
  return true;
}
