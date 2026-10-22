import en from "../locales/en.json";

type Catalog = typeof en;

const catalogs: Record<string, Catalog> = { en };

function readLocale(): string {
  if (typeof localStorage === "undefined") return "en";
  const stored = localStorage.getItem("fretbook.locale");
  const requested = (stored || (typeof navigator === "undefined" ? "en" : navigator.language) || "en")
    .toLowerCase()
    .split("-")[0];
  return catalogs[requested] ? requested : "en";
}

let locale = $state(readLocale());

function lookup(catalog: Catalog, key: string): string | undefined {
  const value = key.split(".").reduce<unknown>((node, part) => {
    if (node && typeof node === "object" && part in node) {
      return (node as Record<string, unknown>)[part];
    }
    return undefined;
  }, catalog);
  return typeof value === "string" ? value : undefined;
}

/** Translate `key`. Missing keys come back unchanged so a new locale can be diffed. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const catalog = catalogs[locale] ?? en;
  let text = lookup(catalog, key) ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

export function tOr(key: string, fallback: string): string {
  if (!key) return fallback;
  const catalog = catalogs[locale] ?? en;
  return lookup(catalog, key) ?? fallback;
}

/** Issue #2 adds catalogs and a switcher. The choice is already remembered. */
export function setLocale(next: string): void {
  if (!catalogs[next]) return;
  locale = next;
  localStorage.setItem("fretbook.locale", next);
}

export function currentLocale(): string {
  return locale;
}
