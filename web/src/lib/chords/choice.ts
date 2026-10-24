import { voicingKey, type Voicing } from "./voicings";

/**
 * What the reader chose on a chord sheet, remembered per song in this browser
 * (like the practice settings): the instrument and tuning, and the voicing
 * picked for each chord. A voicing is stored by its frets, not its position in
 * the list, so a better ranking later does not move anyone's choice.
 */

export interface ChordChoice {
  instrument?: string;
  tuning?: string;
  /** Chord name (as shown) to voicing key. */
  voicings: Record<string, string>;
}

const PREFIX = "fretbook.chordChoice.";
const GLOBAL = "fretbook.chordSetup";

export function loadChoice(songId: string): ChordChoice {
  const empty: ChordChoice = { voicings: {} };
  try {
    const raw = JSON.parse(localStorage.getItem(PREFIX + songId) ?? "null");
    if (!raw || typeof raw !== "object") return empty;
    const voicings: Record<string, string> = {};
    for (const [name, key] of Object.entries(raw.voicings ?? {})) {
      if (typeof key === "string") voicings[name] = key;
    }
    return {
      instrument: typeof raw.instrument === "string" ? raw.instrument : undefined,
      tuning: typeof raw.tuning === "string" ? raw.tuning : undefined,
      voicings,
    };
  } catch {
    return empty;
  }
}

export function saveChoice(songId: string, choice: ChordChoice): void {
  try {
    localStorage.setItem(PREFIX + songId, JSON.stringify(choice));
  } catch {
    // Private mode or full storage: the choice just is not remembered.
  }
}

/** The instrument and tuning last used on the chord library page. */
export function loadSetup(): { instrument?: string; tuning?: string } {
  try {
    const raw = JSON.parse(localStorage.getItem(GLOBAL) ?? "null");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export function saveSetup(setup: { instrument: string; tuning: string }): void {
  try {
    localStorage.setItem(GLOBAL, JSON.stringify(setup));
  } catch {
    // Not remembered.
  }
}

/** The voicing a chord shows: the remembered one if it is still on offer, else the first. */
export function chosenVoicing(
  voicings: Voicing[],
  remembered: string | undefined,
): { voicing: Voicing; index: number } | null {
  if (!voicings.length) return null;
  const index = remembered
    ? voicings.findIndex((voicing) => voicingKey(voicing.frets) === remembered)
    : -1;
  return { voicing: voicings[Math.max(0, index)], index: Math.max(0, index) };
}
