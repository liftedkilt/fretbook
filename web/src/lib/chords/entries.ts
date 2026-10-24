import type { ChordDefine } from "../chordpro";
import { chosenVoicing } from "./choice";
import { voicingsFor, type Voicing } from "./voicings";

export interface ChordEntry {
  name: string;
  voicings: Voicing[];
  /** Which of `voicings` is showing. */
  index: number;
  /** `null` when no shape could be worked out for this tuning. */
  voicing: Voicing | null;
}

/** The strip's content: each chord with its voicings and the one picked (remembered, else the best). */
export function buildEntries(
  names: string[],
  tuning: number[],
  rootInBass: boolean,
  defines: Record<string, ChordDefine>,
  remembered: Record<string, string>,
): ChordEntry[] {
  return names.map((name) => {
    const voicings = voicingsFor(name, tuning, defines, { rootInBass });
    const chosen = chosenVoicing(voicings, remembered[name]);
    return { name, voicings, index: chosen?.index ?? 0, voicing: chosen?.voicing ?? null };
  });
}
