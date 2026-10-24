import * as alphaTab from "@coderline/alphatab";
import { describe, expect, it } from "vitest";

import { effectBandPaddingBottom, separateEffectBands } from "./display";

describe("separateEffectBands", () => {
  it("opens a gap between the tempo, section, and let-ring labels", () => {
    const settings = new alphaTab.Settings();
    expect(settings.display.effectBandPaddingBottom).toBe(2);
    separateEffectBands(settings);
    expect(settings.display.effectBandPaddingBottom).toBe(effectBandPaddingBottom);
    expect(settings.display.effectBandPaddingBottom).toBeGreaterThan(2);
  });
});
