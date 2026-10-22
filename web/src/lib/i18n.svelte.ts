import en from "../locales/en.json";
import type { Keyed } from "./types";

/*
 * Catalogs are nested JSON. A string value may use `{name}` placeholders; an
 * object value with `one` / `other` (any Intl.PluralRules category) is picked
 * by the `count` variable. Server errors and warnings arrive as `Keyed`
 * messages and are looked up under `errors`, falling back to their English
 * text. Add a locale by dropping in another JSON file and registering it in
 * `catalogs`; `tests/test_api.py` checks the English catalog has every key the
 * server sends.
 */

type Catalog = Record<string, unknown>;

const catalogs: Record<string, Catalog> = { en };

function readLocale(): string {
  let stored: string | null = null;
  try {
    stored = typeof localStorage === "undefined" ? null : localStorage.getItem("fretbook.locale");
  } catch {
    stored = null;
  }
  const requested = (stored || (typeof navigator === "undefined" ? "en" : navigator.language) || "en")
    .toLowerCase()
    .split("-")[0];
  return catalogs[requested] ? requested : "en";
}

let locale = $state(readLocale());

function applyLang(): void {
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}
applyLang();

function lookup(catalog: Catalog, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (node && typeof node === "object" && part in node) return (node as Record<string, unknown>)[part];
    return undefined;
  }, catalog);
}

function resolve(key: string, vars?: Record<string, string | number>): string | undefined {
  const catalog = catalogs[locale] ?? en;
  let value = lookup(catalog, key) ?? lookup(en, key);
  if (value && typeof value === "object") {
    const forms = value as Record<string, string>;
    const count = Number(vars?.count ?? 0);
    value = forms[new Intl.PluralRules(locale).select(count)] ?? forms.other;
  }
  if (typeof value !== "string") return undefined;
  let text = value;
  for (const [name, item] of Object.entries(vars ?? {})) text = text.replaceAll(`{${name}}`, String(item));
  return text;
}

/** Translate `key`. Missing keys come back unchanged so a new locale can be diffed. */
export function t(key: string, vars?: Record<string, string | number>): string {
  return resolve(key, vars) ?? key;
}

export function tOr(key: string, fallback: string, vars?: Record<string, string | number>): string {
  return (key && resolve(key, vars)) || fallback;
}

/** A server error or warning in the reader's language. */
export function keyed(message: Partial<Keyed> & { message?: string }): string {
  return tOr(message.key ? `errors.${message.key}` : "", message.message || t("error.generic"), message.params);
}

/** Issue #2 adds catalogs and a switcher. The choice is already remembered. */
export function setLocale(next: string): void {
  if (!catalogs[next]) return;
  locale = next;
  applyLang();
  try {
    localStorage.setItem("fretbook.locale", next);
  } catch {
    /* storage may be unavailable */
  }
}

export function currentLocale(): string {
  return locale;
}
