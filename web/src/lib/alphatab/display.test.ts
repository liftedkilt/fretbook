import * as alphaTab from "@coderline/alphatab";
import { describe, expect, it } from "vitest";

import { effectBandPaddingBottom, hideScoreHeader, separateEffectBands } from "./display";

describe("separateEffectBands", () => {
  it("opens a gap between the tempo, section, and let-ring labels", () => {
    const settings = new alphaTab.Settings();
    expect(settings.display.effectBandPaddingBottom).toBe(2);
    separateEffectBands(settings);
    expect(settings.display.effectBandPaddingBottom).toBe(effectBandPaddingBottom);
    expect(settings.display.effectBandPaddingBottom).toBeGreaterThan(2);
  });
});

describe("hideScoreHeader", () => {
  it("turns off the title, artist and tuning header but keeps the music", () => {
    const settings = new alphaTab.Settings();
    hideScoreHeader(settings, alphaTab);
    const shown = (element: alphaTab.NotationElement) => settings.notation.elements.get(element);
    expect(shown(alphaTab.NotationElement.ScoreTitle)).toBe(false);
    expect(shown(alphaTab.NotationElement.ScoreArtist)).toBe(false);
    expect(shown(alphaTab.NotationElement.GuitarTuning)).toBe(false);
    expect(shown(alphaTab.NotationElement.TrackNames)).not.toBe(false);
  });
});
