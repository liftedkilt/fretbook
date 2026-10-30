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

/** Title block and tuning line alphaTab draws above the first system. */
const scoreHeaderElements = [
  "ScoreTitle",
  "ScoreSubTitle",
  "ScoreArtist",
  "ScoreAlbum",
  "ScoreWords",
  "ScoreMusic",
  "ScoreWordsAndMusic",
  "ScoreCopyright",
  "GuitarTuning",
] as const;

/**
 * Hides alphaTab's own title, artist and tuning header. The song header already shows them, and on
 * a phone the header pushes the first bar of music about 180px down the screen.
 */
export function hideScoreHeader(settings: alphaTab.Settings, alphaTabApi: typeof alphaTab): void {
  for (const name of scoreHeaderElements) {
    settings.notation.elements.set(alphaTabApi.NotationElement[name], false);
  }
}
