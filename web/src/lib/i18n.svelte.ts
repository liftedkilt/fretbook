import en from "../locales/en.json";
import ptBR from "../locales/pt-BR.json";
import { pickLocale, pluralCategory } from "./locale";
import type { Keyed } from "./types";

/*
 * Catalogs are nested JSON. A string value may use `{name}` placeholders; an
 * object value with `one` / `other` (any Intl.PluralRules category) is picked
 * by the `count` variable. Server errors and warnings arrive as `Keyed`
 * messages and are looked up under `errors`, falling back to their English
 * text.
 *
 * Add a locale by copying `en.json` to `web/src/locales/<tag>.json`, importing
 * it here, and adding it to `catalogs` and `locales`. The browser language is
 * the default until the header switcher stores a choice. `catalog.test.ts`
 * fails if any locale is missing a key the UI uses.
 */

type Catalog = Record<string, unknown>;

const catalogs: Record<string, Catalog> = {
  en: en as Catalog,
  "pt-BR": ptBR as Catalog,
};

/** Switcher options. `labelKey` is the language's own name in every catalog. */
export const locales: { id: string; labelKey: string }[] = [
  { id: "en", labelKey: "language.en" },
  { id: "pt-BR", labelKey: "language.ptBR" },
];

const STORAGE_KEY = "fretbook.locale";

function storedLocale(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function browserLocales(): string[] {
  if (typeof navigator === "undefined") return [];
  const list = navigator.languages?.length ? [...navigator.languages] : [];
  if (navigator.language) list.push(navigator.language);
  return list.filter(Boolean);
}

function readLocale(): string {
  const available = Object.keys(catalogs);
  const stored = storedLocale();
  if (stored) {
    const match = pickLocale(stored, available);
    if (match) return match;
  }
  for (const tag of browserLocales()) {
    const match = pickLocale(tag, available);
    if (match) return match;
  }
  return available.includes("en") ? "en" : available[0];
}

let locale = $state(readLocale());

function lookup(catalog: Catalog, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (node && typeof node === "object" && part in node)
      return (node as Record<string, unknown>)[part];
    return undefined;
  }, catalog);
}

function resolve(key: string, vars?: Record<string, string | number>): string | undefined {
  const catalog = catalogs[locale] ?? en;
  let value = lookup(catalog, key) ?? lookup(en, key);
  if (value && typeof value === "object") {
    const forms = value as Record<string, string>;
    const count = Number(vars?.count ?? 0);
    value = forms[pluralCategory(locale, count)] ?? forms.other;
  }
  if (typeof value !== "string") return undefined;
  let text = value;
  for (const [name, item] of Object.entries(vars ?? {}))
    text = text.replaceAll(`{${name}}`, String(item));
  return text;
}

function applyLang(): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
  const title = resolve("app.title");
  if (title) document.title = title;
}
applyLang();

/** Translate `key`. Missing keys come back unchanged so a new locale can be diffed. */
export function t(key: string, vars?: Record<string, string | number>): string {
  return resolve(key, vars) ?? key;
}

export function tOr(key: string, fallback: string, vars?: Record<string, string | number>): string {
  return (key && resolve(key, vars)) || fallback;
}

/** A server error or warning in the reader's language. */
export function keyed(message: Partial<Keyed> & { message?: string }): string {
  return tOr(
    message.key ? `errors.${message.key}` : "",
    message.message || t("error.generic"),
    message.params,
  );
}

/** Remember `next` (an exact catalog id, or a tag `pickLocale` can match). */
export function setLocale(next: string): void {
  const match = pickLocale(next, Object.keys(catalogs));
  if (!match) return;
  locale = match;
  applyLang();
  try {
    localStorage.setItem(STORAGE_KEY, match);
  } catch {
    /* storage may be unavailable */
  }
}

export function currentLocale(): string {
  return locale;
}
