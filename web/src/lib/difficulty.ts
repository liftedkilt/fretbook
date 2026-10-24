import type { DifficultyFactor, DifficultyFactorKey, LibraryLevel } from "./types";

/** The library's level filter: the 1 to 10 range each choice keeps, as `difficulty_min` and `difficulty_max`. */
export const LEVEL_RANGES: Record<Exclude<LibraryLevel, "all">, { min: number; max: number }> = {
  easy: { min: 1, max: 3 },
  medium: { min: 4, max: 6 },
  hard: { min: 7, max: 10 },
};

/** The query parameters for a level choice; none for "all". */
export function levelQuery(level: LibraryLevel): {
  difficulty_min?: number;
  difficulty_max?: number;
} {
  if (level === "all") return {};
  const { min, max } = LEVEL_RANGES[level];
  return { difficulty_min: min, difficulty_max: max };
}

/** The whole-number level shown to the player, 1 to 10. */
export function levelOf(difficulty: number): number {
  return Math.max(1, Math.min(10, Math.round(difficulty)));
}

/** The band a level falls in, for colour and words. */
export function levelBand(difficulty: number): Exclude<LibraryLevel, "all"> {
  const level = levelOf(difficulty);
  return level <= LEVEL_RANGES.easy.max
    ? "easy"
    : level <= LEVEL_RANGES.medium.max
      ? "medium"
      : "hard";
}

/** The factors that raise a track's level most, biggest first, leaving out ones that add nothing. */
export function mainFactors(factors: DifficultyFactor[], count = 3): DifficultyFactor[] {
  return factors
    .filter((factor) => factor.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, count);
}

/** The locale key that names each factor. */
export const FACTOR_NAME_KEYS: Record<DifficultyFactorKey, string> = {
  density: "difficulty.name.density",
  shifts: "difficulty.name.shifts",
  stretch: "difficulty.name.stretch",
  techniques: "difficulty.name.techniques",
  chords: "difficulty.name.chords",
  rhythm: "difficulty.name.rhythm",
  vocabulary: "difficulty.name.vocabulary",
  barres: "difficulty.name.barres",
  extensions: "difficulty.name.extensions",
  changes: "difficulty.name.changes",
};

/** The locale key and parameters that word a factor's measurement, e.g. "5.2 notes per second". */
export function factorText(factor: DifficultyFactor): {
  key: string;
  params: Record<string, string>;
} {
  const key: DifficultyFactorKey = factor.key;
  const number = (digits: number) => factor.measure.toFixed(digits).replace(/\.0+$/, "");
  const params: Record<DifficultyFactorKey, string> = {
    density: number(1),
    shifts: number(1),
    stretch: number(0),
    techniques: String(Math.round(factor.measure * 100)),
    chords: number(0),
    rhythm: String(Math.round(factor.measure * 100)),
    vocabulary: number(0),
    barres: number(0),
    extensions: number(0),
    changes: number(1),
  };
  return { key: `difficulty.factor.${key}`, params: { value: params[key] } };
}
