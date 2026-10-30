import type { ChromaEvent } from "./chroma";
import type { PitchEvent } from "./engine";

/** What the AudioWorklet posts to the main thread. */
export type WorkletMessage =
  | { type: "pitch"; event: PitchEvent }
  | { type: "chroma"; event: ChromaEvent }
  | { type: "level"; rms: number; peak: number };

/** What the main thread posts to the AudioWorklet. */
export type WorkletCommand =
  | { type: "expected"; midi: number | null; strictOctave?: boolean }
  | { type: "channel"; index: number }
  | { type: "chroma"; on: boolean };

export interface WorkletOptions {
  a4?: number;
  minFrequency?: number;
  channel?: number;
}
