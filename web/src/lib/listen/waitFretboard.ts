import type { FretNote } from "../fretboard";
import type { WaitStep } from "./wait";

/** How the expected note is drawn: waiting for it, waiting past the hint delay, or just played. */
export type WaitTone = "wait" | "hint" | "hit";

export interface WaitFocus {
  notes: FretNote[];
  tone: WaitTone;
}

/**
 * The fretboard marks for wait mode. Only a single note has a position to show: a chord step
 * carries the first string and fret of the chord, and a dead note has no pitch, so both leave
 * the fretboard empty. `step` is the step being waited on, or the one just hit while `phase` is
 * "hit".
 */
export function waitFocus(
  step: WaitStep | null,
  phase: "idle" | "waiting" | "hit" | "done",
  hint: boolean,
): WaitFocus | null {
  if (!step || step.kind !== "note") return null;
  if (phase === "hit") return { notes: [{ string: step.string, fret: step.fret }], tone: "hit" };
  if (phase !== "waiting") return null;
  return {
    notes: [{ string: step.string, fret: step.fret }],
    tone: hint ? "hint" : "wait",
  };
}
