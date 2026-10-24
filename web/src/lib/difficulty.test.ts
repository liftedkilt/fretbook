import { describe, expect, it } from "vitest";
import {
  FACTOR_NAME_KEYS,
  factorText,
  levelBand,
  levelOf,
  levelQuery,
  mainFactors,
} from "./difficulty";
import type { DifficultyFactor } from "./types";

const factor = (key: DifficultyFactor["key"], value: number, measure = 0): DifficultyFactor => ({
  key,
  value,
  measure,
});

describe("levels", () => {
  it("rounds to a whole level from 1 to 10", () => {
    expect(levelOf(4.4)).toBe(4);
    expect(levelOf(4.5)).toBe(5);
    expect(levelOf(0.2)).toBe(1);
    expect(levelOf(12)).toBe(10);
  });

  it("puts levels in bands that match the library filter", () => {
    expect([1, 3.4, 3.6, 6.4, 6.5, 10].map(levelBand)).toEqual([
      "easy",
      "easy",
      "medium",
      "medium",
      "hard",
      "hard",
    ]);
  });

  it("turns a level choice into query parameters", () => {
    expect(levelQuery("all")).toEqual({});
    expect(levelQuery("easy")).toEqual({ difficulty_min: 1, difficulty_max: 3 });
    expect(levelQuery("hard")).toEqual({ difficulty_min: 7, difficulty_max: 10 });
  });
});

describe("explanations", () => {
  it("lists the biggest contributors first and drops the ones at zero", () => {
    const factors = [
      factor("density", 0.2),
      factor("shifts", 0),
      factor("stretch", 0.9),
      factor("techniques", 0.5),
      factor("rhythm", 0.1),
    ];
    expect(mainFactors(factors).map((item) => item.key)).toEqual([
      "stretch",
      "techniques",
      "density",
    ]);
    expect(mainFactors(factors, 1)).toHaveLength(1);
    expect(mainFactors([factor("chords", 0)])).toEqual([]);
  });

  it("names every factor", () => {
    expect(Object.keys(FACTOR_NAME_KEYS)).toHaveLength(10);
    for (const [key, name] of Object.entries(FACTOR_NAME_KEYS))
      expect(name).toBe(`difficulty.name.${key}`);
  });

  it("words each measurement with its own unit", () => {
    expect(factorText(factor("density", 0.4, 5.25))).toEqual({
      key: "difficulty.factor.density",
      params: { value: "5.3" },
    });
    expect(factorText(factor("shifts", 0.4, 2)).params.value).toBe("2");
    expect(factorText(factor("vocabulary", 0.4, 7)).params.value).toBe("7");
    expect(factorText(factor("changes", 0.4, 1.75)).params.value).toBe("1.8");
    expect(factorText(factor("stretch", 0.4, 6)).params.value).toBe("6");
    expect(factorText(factor("techniques", 0.4, 0.236)).params.value).toBe("24");
    expect(factorText(factor("chords", 0.4, 17.6)).params.value).toBe("18");
    expect(factorText(factor("rhythm", 0.4, 0.5)).params.value).toBe("50");
  });
});
