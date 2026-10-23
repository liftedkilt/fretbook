import type { PitchEvent } from "./engine";

/** What the AudioWorklet posts to the main thread. */
export type WorkletMessage =
  { type: "pitch"; event: PitchEvent } | { type: "level"; rms: number; peak: number };

/** What the main thread posts to the AudioWorklet. */
export type WorkletCommand =
  { type: "expected"; midi: number | null } | { type: "channel"; index: number };

export interface WorkletOptions {
  a4?: number;
  minFrequency?: number;
  channel?: number;
}
