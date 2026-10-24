import type * as alphaTab from "@coderline/alphatab";

/**
 * Gap alphaTab leaves under each effect band (tempo, section, let ring, …).
 *
 * The library default is 2px. A tab-only staff draws the song tempo, the
 * section name, and let-ring on that one staff, and the rendered text is
 * taller than the band height alphaTab reserves, so the labels overlap.
 * 10px clears a 14px tempo or section and the 12px let-ring line.
 */
export const effectBandPaddingBottom = 10;

export function separateEffectBands(settings: alphaTab.Settings): void {
  settings.display.effectBandPaddingBottom = effectBandPaddingBottom;
}
