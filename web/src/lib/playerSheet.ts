/*
 * The player's side sheet: which tab was open last, how a speed reads,
 * and where section names sit on the scrubber.
 */

export const SHEET_TABS = ["practice", "audio", "sync", "view"] as const;
export type SheetTab = (typeof SHEET_TABS)[number];

const KEY = "fretbook.playerSheetTab";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function isSheetTab(value: string | null): value is SheetTab {
  return value !== null && (SHEET_TABS as readonly string[]).includes(value);
}

/** The last tab this player had open, or Practice when nothing is stored. */
export function loadSheetTab(userId?: string): SheetTab {
  const store = storage();
  if (!store) return "practice";
  try {
    const perUser = userId ? store.getItem(`${KEY}.${userId}`) : null;
    const raw = perUser ?? store.getItem(KEY);
    return isSheetTab(raw) ? raw : "practice";
  } catch {
    return "practice";
  }
}

export function saveSheetTab(tab: SheetTab, userId?: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(KEY, tab);
    if (userId) store.setItem(`${KEY}.${userId}`, tab);
  } catch {
    /* storage may be unavailable */
  }
}

/** A playback rate as the dock shows it, such as `0.75×`. */
export function formatRate(rate: number): string {
  return `${rate}×`;
}

export interface SectionMark {
  /** Index in the played-bar order, matching the scrubber. */
  index: number;
  label: string;
}

/** Section names drawn on the scrubber, one mark where a section starts. */
export function sectionMarks(
  bars: readonly { section?: string | null }[],
  order: readonly number[],
): SectionMark[] {
  const marks: SectionMark[] = [];
  for (let index = 0; index < order.length; index += 1) {
    const label = bars[order[index]]?.section?.trim();
    if (label) marks.push({ index, label });
  }
  return marks;
}
