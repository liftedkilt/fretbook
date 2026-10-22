/**
 * Locale matching and plural categories, kept free of Svelte so tests can
 * call them directly. Catalogs are registered in `i18n.svelte.ts`.
 */

/** Match a BCP 47 tag to a catalog id: exact tag, then primary language (`pt` → `pt-BR`). */
export function pickLocale(requested: string, available: readonly string[]): string | null {
  const tag = requested.trim().replace(/_/g, "-");
  if (!tag) return null;
  const exact = available.find((item) => item.toLowerCase() === tag.toLowerCase());
  if (exact) return exact;
  const language = tag.split("-")[0]?.toLowerCase();
  if (!language) return null;
  return available.find((item) => item.toLowerCase().split("-")[0] === language) ?? null;
}

/**
 * Plural category for `count`. Brazilian Portuguese says "0 compassos", but
 * `Intl.PluralRules("pt-BR")` reports `one` for zero.
 */
export function pluralCategory(locale: string, count: number): Intl.LDMLPluralRule {
  const category = new Intl.PluralRules(locale).select(count);
  if (locale.toLowerCase() === "pt-br" && count === 0) return "other";
  return category;
}
